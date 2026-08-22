// Prices are fixed by you — NOT derived from AI/infra cost. Credits per plan
// are what's derived, sized so the worst-case cost stays under your margin
// target even though Railway's usage-based cost isn't fixed. Recompute these
// with the pricing calculator whenever your Railway bill, user count, or
// Claude-usage mix moves meaningfully from the assumptions below.
//
// Assumptions baked into these numbers (update when you have real data):
//   $95/mo fixed opex (Vercel $30 + Supabase $50 + Railway base $5 + $10
//   team/dashboard usage buffer — the $10 is a placeholder, not measured)
//   ~50 paying users · 75% target margin · ~20% of messages need Claude
//   Railway usage cost ≈ $0.0003/message · usd_per_real_credit = $0.005
//
// At these prices, worst-case contribution margin already clears the entire
// $95 fixed opex on a single Pro or Business signup — Starter still needs 3
// users to clear fixed opex alone. Re-run the numbers if Starter ends up
// being your highest-volume tier.
//
// Annual billing: $4/month knocked off, billed upfront as one annual charge.
// Credit allotment refills monthly either way — annual just changes billing,
// not the monthly usage cap.

const ANNUAL_MONTHLY_DISCOUNT = 4;

const TRIAL = {
    id: 'trial',
    label: '1-week trial',
    days: 7,
    real_credits: 30,     // Luna-only during trial — this is pure customer acquisition cost (~$0.15/trial user worst case, including daily-cap Railway usage)
    display_credits: 300,
};

const PAID_PLANS = {
    starter: {
        id: 'starter',
        label: 'Starter',
        price_usd_monthly: 45,
        real_credits_monthly: 1800,
        display_credits_monthly: 18000,
    },
    pro: {
        id: 'pro',
        label: 'Pro',
        price_usd_monthly: 165,
        real_credits_monthly: 7600,
        display_credits_monthly: 76000,
    },
    business: {
        id: 'business',
        label: 'Business',
        price_usd_monthly: 345,
        real_credits_monthly: 16300,
        display_credits_monthly: 163000,
    },
};

function annualPrice(monthlyPrice) {
    return (monthlyPrice - ANNUAL_MONTHLY_DISCOUNT) * 12;
}

function getPlan(planId) {
    return PAID_PLANS[planId] || null;
}

module.exports = { TRIAL, PAID_PLANS, annualPrice, getPlan, ANNUAL_MONTHLY_DISCOUNT };
