const express      = require('express');
const supabase     = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { toDisplay } = require('../lib/credits');
const { TRIAL, PAID_PLANS, annualPrice } = require('../lib/plans');
const router       = express.Router();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/credits — current balance + trial/plan status + history.
// Everything numeric returned here is in DISPLAY credits (10x real).
// No free daily refill anymore — there's no free tier, only the one-time
// trial grant (given at signup, see auth.js) and monthly plan renewals
// (handled by your billing webhook, not this route).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
    const { data: profile } = await supabase
        .from('profiles')
        .select('credits, plan, trial_ends_at, billing_cycle, billing_status')
        .eq('id', req.user.id)
        .single();

    const { data: history } = await supabase
        .from('credit_transactions')
        .select('amount, type, description, created_at')
        .eq('user_id', req.user.id)
        .order('created_at', { ascending: false })
        .limit(20);

    const trialExpired = profile?.plan === 'trial'
        && profile.trial_ends_at
        && new Date(profile.trial_ends_at) < new Date();

    res.json({
        credits:        toDisplay(profile?.credits || 0),
        plan:           profile?.plan || 'trial',
        billing_cycle:  profile?.billing_cycle || 'monthly',
        billing_status: profile?.billing_status || 'trialing',
        trial_ends_at:  profile?.trial_ends_at || null,
        trial_expired:  trialExpired,
        history: (history || []).map(h => ({ ...h, amount: toDisplay(h.amount) })),
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/credits/plans — the 3 fixed-price subscription plans, monthly and
// annual. This replaces the old one-off top-up "packages" concept — pricing
// is fixed by you (see src/lib/plans.js); credits per plan are sized to hold
// your target margin, not the other way round.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/plans', (req, res) => {
    const plans = Object.values(PAID_PLANS).map(p => ({
        id:      p.id,
        label:   p.label,
        monthly_price_usd: p.price_usd_monthly,
        annual_price_usd:  annualPrice(p.price_usd_monthly),
        annual_monthly_equivalent_usd: Number((annualPrice(p.price_usd_monthly) / 12).toFixed(2)),
        display_credits_monthly: p.display_credits_monthly,
    }));

    res.json({
        trial: { days: TRIAL.days, display_credits: TRIAL.display_credits },
        plans,
    });
});

module.exports = router;