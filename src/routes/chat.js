const express      = require('express');
const supabase     = require('../lib/supabase');
const { getSettings } = require('../lib/setting');
const { requireAuth }           = require('../middleware/auth');
const { chatWithClaude }        = require('../services/claude');
const { chatWithGPT }           = require('../services/openai');
const { selectProvider }        = require('../services/modelRouter');
const { sendActionToWordPress, getWordPressContext } = require('../services/wordpress');
const router       = express.Router();

// Minimum credits required just to send a message — real cost is calculated
// AFTER we know actual token usage from the AI response (see creditsFromCost)
const MIN_CREDITS_TO_START = 2;
const TRIAL_DAILY_MESSAGE_CAP = 15; // spreads the 30-credit trial allotment over the week, blunts scripted bursts

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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat/message
// Body: { site_id, message, history, session_id }
// This is the main endpoint — user sends a message, AI responds, WP gets updated
// ─────────────────────────────────────────────────────────────────────────────
router.post('/message', async (req, res) => {
    const { site_id, message, history = [], session_id, has_attachment = false } = req.body;

    if (!message || !site_id) {
        return res.status(400).json({ error: 'message and site_id are required.' });
    }

    // ── 1. Check user has at least the minimum credits to attempt a message ───
    // profile.credits is REAL credits (internal). Compare against the real floor.
    const { data: profile } = await supabase
        .from('profiles')
        .select('credits, plan, trial_ends_at')
        .eq('id', req.user.id)
        .single();

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

    // ── 4. Build conversation history — only send the last N messages ─────────
    // Keeps input tokens (and cost) bounded no matter how long the chat gets
    const MAX_HISTORY_MESSAGES = 12;
    const trimmedHistory = history.slice(-MAX_HISTORY_MESSAGES);

    const messages = [
        ...trimmedHistory,
        { role: 'user', content: message },
    ];

    // ── 5. Decide which AI provider to use, then ask it what to do ────────────
    const { provider, model } = await selectProvider(profile, { hasAttachment: !!has_attachment, message });

    let aiResult;
    try {
        aiResult = provider === 'claude'
            ? await chatWithClaude(messages, wpContext, model)   // model: 'sonnet' | 'opus'
            : await chatWithGPT(messages, wpContext);            // always 'luna' today
    } catch (err) {
        console.error(`${provider} (${model}) API error:`, err);
        return res.status(500).json({ error: 'AI is temporarily unavailable. Please try again.' });
    }

    const { parsed, usage } = aiResult;
    const actionsToRun = parsed.actions || [];
    const actionResults = [];

    // ── 6. Execute each action on the WordPress site ──────────────────────────
    for (const actionObj of actionsToRun) {
        const { action, ...params } = actionObj;
        const result = await sendActionToWordPress(site.site_url, site.site_token, action, params);
        actionResults.push({ action, ...result });

        // If an action fails, stop and report it
        if (!result.success) {
            console.error(`Action failed: ${action}`, result.error);
        }
    }

    // ── 7. Work out the real credit cost for THIS message, then deduct ────────
    // Charged from ACTUAL token usage × the model actually used, not a flat
    // per-action guess — a Claude heavy build and a Luna one-liner should not
    // cost the same number of credits.
    const estimatedCost   = estimateCost(provider, model, usage);
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
            content:    parsed.message,
            metadata:   { actions: actionsToRun, results: actionResults },
            created_at: new Date().toISOString(),
        },
    ]);

    // ── 9. Get updated credit balance ─────────────────────────────────────────
    const { data: updatedProfile } = await supabase
        .from('profiles')
        .select('credits')
        .eq('id', req.user.id)
        .single();

    // ── 10. Return everything to the frontend ─────────────────────────────────
    res.json({
        message:        parsed.message,
        actions:        actionsToRun,
        action_results: actionResults,
        credits_used:   toDisplay(creditsToCharge),
        credits_left:   toDisplay(updatedProfile?.credits || 0),
        provider,
        session_id: activeSessionId,
    });
});

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
// ─────────────────────────────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id is required.' });

    const { data } = await supabase
        .from('conversations')
        .select('role, content, metadata, created_at')
        .eq('user_id', req.user.id)
        .eq('session_id', session_id)
        .order('created_at', { ascending: true })
        .limit(200);

    res.json({ history: data || [] });
});

module.exports = router;