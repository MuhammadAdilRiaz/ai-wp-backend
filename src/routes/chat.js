const express      = require('express');
const supabase     = require('../lib/supabase');
const { requireAuth }           = require('../middleware/auth');
const { chatWithClaude }        = require('../services/claude');
const { chatWithGPT }           = require('../services/openai');
const { selectProvider }        = require('../services/modelRouter');
const { sendActionToWordPress, getWordPressContext } = require('../services/wordpress');
const router       = express.Router();

// Cost per chat message in credits
const CREDITS_PER_MESSAGE = 5;

router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/chat/message
// Body: { site_id, message, history }
// This is the main endpoint — user sends a message, Claude responds, WP gets updated
// ─────────────────────────────────────────────────────────────────────────────
router.post('/message', async (req, res) => {
    const { site_id, message, history = [] } = req.body;

    if (!message || !site_id) {
        return res.status(400).json({ error: 'message and site_id are required.' });
    }

    // ── 1. Check user has enough credits ─────────────────────────────────────
    const { data: profile } = await supabase
        .from('profiles')
        .select('credits, plan')
        .eq('id', req.user.id)
        .single();

    if (!profile || profile.credits < CREDITS_PER_MESSAGE) {
        return res.status(402).json({
            error:    'Not enough credits.',
            credits:  profile?.credits || 0,
            required: CREDITS_PER_MESSAGE,
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

    // ── 3. Get current WordPress site context for Claude ─────────────────────
    const wpContext = await getWordPressContext(site.site_url, site.site_token);

    // ── 4. Build conversation history for Claude ──────────────────────────────
    const messages = [
        ...history,
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

    const { parsed } = aiResult;
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

    // ── 7. Deduct credits ─────────────────────────────────────────────────────
    await supabase.rpc('deduct_credits', {
        p_user_id: req.user.id,
        p_amount:  CREDITS_PER_MESSAGE,
    });

    // Log the transaction
    await supabase.from('credit_transactions').insert({
        user_id:     req.user.id,
        amount:      -CREDITS_PER_MESSAGE,
        type:        'usage',
        description: `Chat message — ${actionsToRun.length} action(s)`,
        created_at:  new Date().toISOString(),
    });

    // ── 8. Save conversation to database ─────────────────────────────────────
    await supabase.from('conversations').insert([
        {
            user_id:  req.user.id,
            site_id:  site_id,
            role:     'user',
            content:  message,
            created_at: new Date().toISOString(),
        },
        {
            user_id:  req.user.id,
            site_id:  site_id,
            role:     'assistant',
            content:  parsed.message,
            metadata: { actions: actionsToRun, results: actionResults },
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
        credits_used:   CREDITS_PER_MESSAGE,
        credits_left:   updatedProfile?.credits || 0,
        provider,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/chat/history?site_id=xxx — load previous conversations
// ─────────────────────────────────────────────────────────────────────────────
router.get('/history', async (req, res) => {
    const { site_id } = req.query;
    if (!site_id) return res.status(400).json({ error: 'site_id is required.' });

    const { data } = await supabase
        .from('conversations')
        .select('role, content, metadata, created_at')
        .eq('user_id', req.user.id)
        .eq('site_id', site_id)
        .order('created_at', { ascending: true })
        .limit(100);

    res.json({ history: data || [] });
});

module.exports = router;