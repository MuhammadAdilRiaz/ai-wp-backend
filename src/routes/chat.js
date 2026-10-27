const express      = require('express');
const supabase     = require('../lib/supabase');
const { getSettings } = require('../lib/setting');
const { requireAuth }           = require('../middleware/auth');
const { chatWithClaude }        = require('../services/claude');
const { chatWithGPT }           = require('../services/openai');
const { selectProvider }        = require('../services/modelRouter');
const { getWordPressContext } = require('../services/wordpress');
const { executeWorkflow } = require('../services/builder/actionWorkflow');
const { formatCompletion } = require('../services/builder/completionReport');
const { preflight } = require('../services/builder/preflight');
const { isWebsiteBuildRequest } = require('../services/builder/taskRouting');
const { prepareCreativeBrief, createHeroAsset } = require('../services/builder/openaiAssets');
const { getPlan } = require('../lib/plans');
const { sendLowCreditEmail } = require('../lib/email');
const router       = express.Router();
const { normalizeImages, attachImagesToLastUserMessage } = require('../services/imageInput');

// Minimum credits required just to send a message — real cost is calculated
// AFTER we know actual token usage from the AI response (see creditsFromCost)
const MIN_CREDITS_TO_START = 2;
const TRIAL_DAILY_MESSAGE_CAP = 15; // spreads the 30-credit trial allotment over the week, blunts scripted bursts
const LOW_CREDIT_THRESHOLD = 0.20; // nudge email fires once a paid user drops to 20% of their monthly allotment

// Real $ cost per request, from actual token usage returned by the provider.
// This drives BOTH internal margin tracking AND what we charge the user —
// see creditsFromCost() below. Keep in sync with your provider dashboards.
const RATES = {
    claude: {
        sonnet: { input: 2 / 1_000_000, output: 10 / 1_000_000 }, // Claude Sonnet 5
        opus:   { input: 5 / 1_000_000, output: 25 / 1_000_000 }, // Claude Opus 5
    },
    chatgpt: {
        luna: { input: 0.20 / 1_000_000, output: 1.20 / 1_000_000 }, // GPT-5.6 Luna
    },
};

function estimateCost(provider, model, usage) {
    const rate = RATES[provider]?.[model];
    if (!rate || !usage) return 0;
    const cost = (usage.input_tokens || 0) * rate.input + (usage.output_tokens || 0) * rate.output;
    return Number(cost.toFixed(6));
}

// Convert a real $ cost into REAL backend credits. usd_per_real_credit is a
// SIZING unit ("$0.005 of raw cost = 1 real credit"), not a price — margin
// comes from how many credits each plan grants for its price, not from this
// number (see src/lib/plans.js, which is where the actual margin math lives).
// Always charge at least the floor, even on a $0 message, so a burst of
// trivial questions can't drain a user's monthly allotment for nothing.
async function creditsFromCost(costUsd) {
    const s = await getSettings();
    const usdPerRealCredit = s.usd_per_real_credit ?? 0.005;
    const floor = s.min_real_credits_per_message ?? 1;
    return Math.max(floor, Math.ceil(costUsd / usdPerRealCredit));
}

const { toDisplay } = require('../lib/credits');

router.use(requireAuth);

// Handle rejected async route promises without terminating the Render process.
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(err => {
    console.error('Chat endpoint failed:', err);
    if (!res.headersSent) res.status(500).json({ error: 'The request failed. No completion was confirmed; please check your site before retrying.' });
    else next(err);
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat/message
// Body: { site_id, message, history, session_id }
// This is the main endpoint — user sends a message, AI responds, WP gets updated
// ─────────────────────────────────────────────────────────────────────────────
router.post('/message', asyncHandler(async (req, res) => {
    const { site_id, message, history = [], session_id, has_attachment = false } = req.body;

    if (!message || !site_id) {
        return res.status(400).json({ error: 'message and site_id are required.' });
    }

    let referenceImages;
    try {
        referenceImages = normalizeImages(req.body);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    // ── 1. Check user has at least the minimum credits to attempt a message ───
    // profile.credits is REAL credits (internal). Compare against the real floor.
    const { data: profile } = await supabase
        .from('profiles')
        .select('credits, plan, trial_ends_at')
        .eq('id', req.user.id)
        .single();

    if (profile?.plan === 'cancelled') {
        return res.status(402).json({
            error:   'Your subscription has ended. Resubscribe to keep building.',
            upgrade: true,
        });
    }

    if (profile?.plan === 'trial' && profile.trial_ends_at && new Date(profile.trial_ends_at) < new Date()) {
        return res.status(402).json({
            error:   'Your trial has ended. Pick a plan to keep building.',
            upgrade: true,
        });
    }

    // Trial-only: cap messages per rolling 24h, separate from the lifetime
    // 30-credit cap. Slows down a scripted burst even on a legitimate trial
    // account — a real person testing the tool won't hit this.
    if (profile?.plan === 'trial') {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { count } = await supabase
            .from('credit_transactions')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', req.user.id)
            .eq('type', 'usage')
            .gte('created_at', since);

        if ((count || 0) >= TRIAL_DAILY_MESSAGE_CAP) {
            return res.status(429).json({
                error: `Trial is limited to ${TRIAL_DAILY_MESSAGE_CAP} messages per day. Come back tomorrow, or pick a plan.`,
                upgrade: true,
            });
        }
    }

    if (!profile || profile.credits < MIN_CREDITS_TO_START) {
        return res.status(402).json({
            error:    'Not enough credits.',
            credits:  toDisplay(profile?.credits || 0),
            required: toDisplay(MIN_CREDITS_TO_START),
            upgrade:  true, // frontend shows upgrade modal when this is true
        });
    }

    // ── 2. Load the connected WordPress site ─────────────────────────────────
    const { data: site, error: siteErr } = await supabase
        .from('sites')
        .select('*')
        .eq('id', site_id)
        .eq('user_id', req.user.id)
        .single();

    if (siteErr || !site) {
        return res.status(404).json({ error: 'Site not found or not connected.' });
    }

    // ── 2.5. Find or create the chat session (sidebar thread) ────────────────
    let activeSessionId = session_id;

    if (!activeSessionId) {
        // No session passed in → this is the first message of a new chat
        const { data: newSession, error: sessionErr } = await supabase
            .from('chat_sessions')
            .insert({
                user_id: req.user.id,
                site_id: site_id,
                title:   message.slice(0, 40), // first message becomes the sidebar title
            })
            .select()
            .single();

        if (sessionErr || !newSession) {
            return res.status(500).json({ error: 'Could not start a new chat session.' });
        }
        activeSessionId = newSession.id;
    } else {
        // Existing session → just bump last_message_at so it sorts to the top of the sidebar
        await supabase
            .from('chat_sessions')
            .update({ last_message_at: new Date().toISOString() })
            .eq('id', activeSessionId)
            .eq('user_id', req.user.id);
    }

    // ── 3. Get current WordPress site context for the AI ──────────────────────
    const wpContext = await getWordPressContext(site.site_url, site.site_token);

    // Fail closed before AI generation: never publish unstyled HTML when Elementor is absent.
    const buildIntent = isWebsiteBuildRequest(message);
    if (buildIntent) {
        const check = preflight(wpContext, message);
        if (!check.ready) {
            const reason = check.error || 'Required WordPress plugins are missing or inactive.';
            const suggestions = check.needs.map(x => ({ action:x.action, slug:x.slug, ...(x.plugin_file ? { plugin_file:x.plugin_file } : {}), reason:x.reason }));
            const reply = suggestions.length
                ? `Before building, please approve: ${suggestions.map(x => `${x.action.replace('_', ' ')} ${x.slug}`).join(', ')}. Nothing was published.`
                : `${reason} Nothing was published.`;
            return res.json({ message: reply, actions: [], action_results: [], approval_required: suggestions, credits_used: 0, credits_left: toDisplay(profile.credits), session_id: activeSessionId });
        }
    }

    // ── 4. Build conversation history — only send the last N messages ─────────
    // Keeps input tokens (and cost) bounded no matter how long the chat gets
    const MAX_HISTORY_MESSAGES = buildIntent ? 4 : 10;
    const trimmedHistory = (Array.isArray(history) ? history : [])
        .filter(m => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
        .slice(-MAX_HISTORY_MESSAGES)
        .map(m => ({role:m.role,content:m.content.slice(0, buildIntent ? 900 : 1800)}));

    const messages = [
        ...trimmedHistory,
        { role: 'user', content: message },
    ];

    // ── 5. Website development is Claude-only; OpenAI is the creative/asset specialist.
    // General non-build chats still use the unchanged subscription model router.
    const routing = buildIntent ? null : await selectProvider(profile, { hasAttachment: !!has_attachment || referenceImages.length > 0, message });
    const provider = buildIntent ? 'claude' : routing.provider;
    const model = buildIntent ? ((profile.plan === 'business' || profile.plan === 'agency') ? 'opus' : 'sonnet') : routing.model;
    let aiResult;
    let creative = null;
    let heroAsset = null;
    let creativeUsage = null;
    try {
        if (buildIntent) {
            // Fail BEFORE any WordPress write. No automatic GPT website-building fallback.
            if (!process.env.ANTHROPIC_API_KEY) return res.status(503).json({ error:'Claude API is required for website development. Configure ANTHROPIC_API_KEY in Render. No WordPress changes were made.' });
            creative = await prepareCreativeBrief({ request:message, wpContext, images:referenceImages });
            creativeUsage = creative.usage;
            try {
                heroAsset = await createHeroAsset(creative.brief);
            } catch (assetError) {
                console.error('OpenAI asset generation failed:', assetError.message);
                heroAsset = { status:'failed', reason:'Could not generate/upload hero image' };
            }
            const briefMessage = JSON.stringify({
                role:'creative_brief_from_openai',
                instruction:'You are the ONLY website layout/page/Elementor/action builder. Use this creative direction, content, and real media URL if available. Never invent a media URL; if missing, describe missing assets. Do not output raw CSS in plain create_page content.',
                creative_brief:creative.brief,
                generated_asset:heroAsset,
            });
            const claudeMessages = [
                ...messages.slice(0,-1),
                {role:'user',content:`${message}\n\n${briefMessage}`},
            ];
            const withImages = attachImagesToLastUserMessage(claudeMessages, referenceImages, 'claude');
            aiResult = await chatWithClaude(withImages, wpContext, model);
        } else {
            const withImages = attachImagesToLastUserMessage(messages, referenceImages, provider === 'claude' ? 'claude' : 'openai');
            aiResult = provider === 'claude'
                ? await chatWithClaude(withImages, wpContext, model)
                : await chatWithGPT(withImages, wpContext);
        }
    } catch (err) {
        console.error(`${provider} (${model}) API error:`, err);
        return res.status(502).json({ error: buildIntent ? 'Hybrid website creation failed before publishing. Check Anthropic and OpenAI API configuration and model access.' : 'AI is temporarily unavailable. Please try again.' });
    }

    const { parsed, usage } = aiResult;
    if (!parsed || typeof parsed !== 'object') return res.status(502).json({error:'Invalid AI response; nothing was published.'});
    const actionsToRun = Array.isArray(parsed.actions) ? parsed.actions : [];
    if (actionsToRun.some(a => a.action === 'create_page' && /<style|:root\s*\{|\.sw-/i.test(a.content || ''))) {
        return res.status(422).json({ error:'Unsafe page output: generated CSS/HTML was not a valid Elementor layout. Nothing was published. Please request an Elementor-native page.' });
    }
    // Execute ordered actions, validating Elementor structures and resolving references.
    const actionResults = await executeWorkflow(site, actionsToRun);
    const completionMessage = formatCompletion(parsed.message, actionResults, { buildIntent });

    // ── 7. Work out the real credit cost for THIS message, then deduct ────────
    // Charged from ACTUAL token usage × the model actually used, not a flat
    // per-action guess — a Claude heavy build and a Luna one-liner should not
    // cost the same number of credits.
    // OpenAI content-model rates are configurable; do not silently bill fictional fixed prices.
    const contentInRate = Number(process.env.ELIMENI_OPENAI_CONTENT_INPUT_USD_PER_M || 0);
    const contentOutRate = Number(process.env.ELIMENI_OPENAI_CONTENT_OUTPUT_USD_PER_M || 0);
    const contentCost = creativeUsage ? ((creativeUsage.input_tokens || 0) * contentInRate + (creativeUsage.output_tokens || 0) * contentOutRate) / 1_000_000 : 0;
    const estimatedCost = estimateCost(provider, model, usage) + contentCost;
    const creditsToCharge = await creditsFromCost(estimatedCost); // REAL credits

    await supabase.rpc('deduct_credits', {
        p_user_id: req.user.id,
        p_amount:  creditsToCharge,
        
    });

    // Log the transaction — metadata carries real token usage + cost so we can
    // review actual margins later instead of relying on estimates
    await supabase.from('credit_transactions').insert({
        user_id:     req.user.id,
        amount:      -creditsToCharge,
        type:        'usage',
        description: `Chat message — ${actionsToRun.length} action(s)`,
        metadata: {
            provider,
            model,
            input_tokens:  usage?.input_tokens  || 0,
            output_tokens: usage?.output_tokens || 0,
            estimated_cost: estimatedCost,
            session_id: activeSessionId,
            openai_content_tokens: creativeUsage || null,
            generated_asset_status: heroAsset?.status || null,
            usage_estimate_excludes_image_generation: true,
            openai_content_cost_usd: contentCost,
        },
        created_at:  new Date().toISOString(),
    });

    // ── 8. Save conversation to database ─────────────────────────────────────
    await supabase.from('conversations').insert([
        {
            user_id:    req.user.id,
            site_id:    site_id,
            session_id: activeSessionId,
            role:       'user',
            content:    message,
            created_at: new Date().toISOString(),
        },
        {
            user_id:    req.user.id,
            site_id:    site_id,
            session_id: activeSessionId,
            role:       'assistant',
            content:    completionMessage,
            metadata:   { actions: actionsToRun, results: actionResults },
            created_at: new Date().toISOString(),
        },
    ]);

    // ── 9. Get updated credit balance ─────────────────────────────────────────
    const { data: updatedProfile } = await supabase
        .from('profiles')
        .select('credits, plan, low_credit_notified')
        .eq('id', req.user.id)
        .single();

    // ── 9b. Low-credit upsell nudge — once per billing cycle, paid plans only ──
    // Trial users don't get this (they're not going to "upgrade mid-nudge",
    // they either convert or don't). low_credit_notified resets to false on
    // every renewal (see webhooks.js), so this fires again next cycle if
    // they're still running low.
    const planConfig = getPlan(updatedProfile?.plan);
    if (planConfig && updatedProfile && !updatedProfile.low_credit_notified) {
        const remainingPct = updatedProfile.credits / planConfig.real_credits_monthly;
        if (remainingPct <= LOW_CREDIT_THRESHOLD) {
            await sendLowCreditEmail(req.user.email, planConfig.label);
            await supabase.from('profiles').update({ low_credit_notified: true }).eq('id', req.user.id);
        }
    }

    // ── 10. Return everything to the frontend ─────────────────────────────────
    res.json({
        message:        completionMessage,
        actions:        actionsToRun,
        action_results: actionResults,
        credits_used:   toDisplay(creditsToCharge),
        credits_left:   toDisplay(updatedProfile?.credits || 0),
        provider,
        content_provider: buildIntent ? 'openai' : null,
        asset_status: heroAsset?.status || null,
        session_id: activeSessionId,
        build_status: buildIntent ? (actionResults.length && actionResults.every(r => r.success) ? 'completed' : 'needs_attention') : null,
        actions_completed: actionResults.filter(r => r.success).length,
        actions_failed: actionResults.filter(r => !r.success).length,
    });
 }));

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/sessions?site_id=xxx — list this user's past chats for the sidebar
// ─────────────────────────────────────────────────────────────────────────────
router.get('/sessions', async (req, res) => {
    const { site_id } = req.query;
    if (!site_id) return res.status(400).json({ error: 'site_id is required.' });

    const { data, error } = await supabase
        .from('chat_sessions')
        .select('id, title, created_at, last_message_at')
        .eq('user_id', req.user.id)
        .eq('site_id', site_id)
        .order('last_message_at', { ascending: false }); // most recent chat on top

    if (error) return res.status(500).json({ error: 'Failed to load chat sessions.' });

    res.json({ sessions: data || [] });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/history?session_id=xxx — load messages for ONE specific chat
//
// Also accepts ?site_id=xxx and resumes that site's most recent thread. The
// chat page only ever knew the site id, so it was sending ?site_id= to a route
// that demanded session_id — a 400 that the page's catch-all then turned into
// "please log in". That mismatch is why a signed-in user got bounced.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
    let { session_id, site_id } = req.query;

    if (!session_id && !site_id) {
        return res.status(400).json({ error: 'session_id or site_id is required.' });
    }

    if (!session_id) {
        const { data: latest } = await supabase
            .from('chat_sessions')
            .select('id')
            .eq('user_id', req.user.id)
            .eq('site_id', site_id)
            .order('last_message_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        // No thread yet for this site is a normal empty state, not an error.
        if (!latest) return res.json({ history: [], session_id: null });
        session_id = latest.id;
    }

    const { data } = await supabase
        .from('conversations')
        .select('role, content, metadata, created_at')
        .eq('user_id', req.user.id)
        .eq('session_id', session_id)
        .order('created_at', { ascending: true })
        .limit(200);

    res.json({ history: data || [], session_id });
});

module.exports = router;