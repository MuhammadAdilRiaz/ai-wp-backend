const express      = require('express');
const supabase     = require('../lib/supabase');
const { requireAuth }           = require('../middleware/auth');
const { chatWithClaude }        = require('../services/claude');
const { chatWithGPT }           = require('../services/openai');
const { selectProvider }        = require('../services/modelRouter');
const { sendActionToWordPress, getWordPressContext } = require('../services/wordpress');
const router       = express.Router();

// Minimum credits required just to send a message — real cost is calculated
// AFTER we know what actions the AI decided to run (see calculateCreditsForActions)
const MIN_CREDITS_TO_START = 2;

// How many credits a message costs, based on what it actually did
function calculateCreditsForActions(actionsToRun) {
    if (actionsToRun.length === 0) return 2;                                        // just a question, no site changes
    if (actionsToRun.some(a => a.action === 'create_elementor_page')) return 8;      // full page build — heaviest
    return 5;                                                                        // normal edit/update
}

// Rough $ cost per request, from real token usage — used only for our own
// internal logging/dashboard, never shown to the user or charged directly
const RATES = {
    claude:  { input: 2 / 1_000_000, output: 10 / 1_000_000 },   // Claude Sonnet 5
    chatgpt: { input: 2 / 1_000_000, output: 8 / 1_000_000 },    // GPT-4.1
};

function estimateCost(provider, usage) {
    const rate = RATES[provider];
    if (!rate || !usage) return 0;
    const cost = (usage.input_tokens || 0) * rate.input + (usage.output_tokens || 0) * rate.output;
    return Number(cost.toFixed(6));
}

router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat/message
// Body: { site_id, message, history, session_id }
// This is the main endpoint — user sends a message, AI responds, WP gets updated
// ─────────────────────────────────────────────────────────────────────────────
router.post('/message', async (req, res) => {
    const { site_id, message, history = [], session_id } = req.body;

    if (!message || !site_id) {
        return res.status(400).json({ error: 'message and site_id are required.' });
    }

    // ── 1. Check user has at least the minimum credits to attempt a message ───
    const { data: profile } = await supabase
        .from('profiles')
        .select('credits, plan')
        .eq('id', req.user.id)
        .single();

    if (!profile || profile.credits < MIN_CREDITS_TO_START) {
        return res.status(402).json({
            error:    'Not enough credits.',
            credits:  profile?.credits || 0,
            required: MIN_CREDITS_TO_START,
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
    const provider = selectProvider(profile);

    let aiResult;
    try {
        aiResult = provider === 'claude'
            ? await chatWithClaude(messages, wpContext)
            : await chatWithGPT(messages, wpContext);
    } catch (err) {
        console.error(`${provider} API error:`, err);
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
    const creditsToCharge = calculateCreditsForActions(actionsToRun);
    const estimatedCost   = estimateCost(provider, usage);

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
        credits_used:   creditsToCharge,
        credits_left:   updatedProfile?.credits || 0,
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