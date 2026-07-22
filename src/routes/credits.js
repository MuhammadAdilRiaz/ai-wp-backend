const express      = require('express');
const supabase     = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const router       = express.Router();

const FREE_REFILL_AMOUNT   = 10;
const FREE_REFILL_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// Helper: grant a free daily refill if the user is eligible.
// Eligible when: plan === 'free', credits <= 0, and 24h+ since last grant.
// Uses a conditional update so concurrent requests can't double-grant.
// ─────────────────────────────────────────────────────────────────────────────
async function maybeGrantFreeRefill(userId) {
    const { data: profile } = await supabase
        .from('profiles')
        .select('credits, plan, last_free_grant_at, created_at')
        .eq('id', userId)
        .single();

    if (!profile || profile.plan !== 'free' || profile.credits > 0) {
        return profile; // not eligible, nothing to do
    }

    const lastGrant = profile.last_free_grant_at
        ? new Date(profile.last_free_grant_at)
        : new Date(profile.created_at); // fall back to signup time

    const eligibleAt = new Date(lastGrant.getTime() + FREE_REFILL_INTERVAL_MS);
    const now = new Date();

    if (now < eligibleAt) {
        return profile; // still within cooldown
    }

    // Conditional update: only succeeds if last_free_grant_at hasn't changed
    // since we read it, preventing a race between simultaneous requests.
    const { data: updated, error } = await supabase
        .from('profiles')
        .update({
            credits: profile.credits + FREE_REFILL_AMOUNT,
            last_free_grant_at: now.toISOString(),
        })
        .eq('id', userId)
        .eq('credits', profile.credits) // optimistic lock
        .select('credits, plan, last_free_grant_at')
        .single();

    if (error || !updated) {
        // Lost the race or update failed — just return current state
        return profile;
    }

    await supabase.from('credit_transactions').insert({
        user_id: userId,
        amount: FREE_REFILL_AMOUNT,
        type: 'grant',
        description: 'Free 24h credit refill',
    });

    return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/credits — get current credit balance + transaction history
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
    let profile = await maybeGrantFreeRefill(req.user.id);

    if (!profile) {
        const { data } = await supabase
            .from('profiles')
            .select('credits, plan, last_free_grant_at')
            .eq('id', req.user.id)
            .single();
        profile = data;
    }

    const { data: history } = await supabase
        .from('credit_transactions')
        .select('amount, type, description, created_at')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(20);

    // Tell the frontend when the next free refill lands, for the modal copy
    let nextRefillAt = null;
    if (profile?.plan === 'free' && profile?.credits <= 0) {
        const base = profile.last_free_grant_at ? new Date(profile.last_free_grant_at) : new Date();
        nextRefillAt = new Date(base.getTime() + FREE_REFILL_INTERVAL_MS).toISOString();
    }

    res.json({
        credits:      profile?.credits || 0,
        plan:         profile?.plan || 'free',
        next_refill_at: nextRefillAt,
        history:      history || [],
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/credits/packages — list available top-up packages
// ─────────────────────────────────────────────────────────────────────────────
router.get('/packages', (req, res) => {
    res.json({
        packages: [
            { id: 'starter',  credits: 500,  price_usd: 9,  label: 'Starter',     popular: false },
            { id: 'pro',      credits: 1500, price_usd: 19, label: 'Pro',          popular: true  },
            { id: 'agency',   credits: 5000, price_usd: 49, label: 'Agency',       popular: false },
        ]
    });
});

module.exports = router;