const express  = require('express');
const stripe   = require('../lib/stripe');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');
const { stripePriceId, PAID_PLANS } = require('../lib/plans');
const router   = express.Router();

router.use(requireAuth);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/checkout — { plan_id, billing_cycle } -> { url }
// Frontend redirects the browser to the returned URL. Stripe Checkout handles
// card entry; you never touch card details. metadata.user_id is what lets
// the webhook handler above know who just paid.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/checkout', async (req, res) => {
    const { plan_id, billing_cycle = 'monthly' } = req.body;

    if (!PAID_PLANS[plan_id]) {
        return res.status(400).json({ error: 'Unknown plan.' });
    }
    if (!['monthly', 'yearly'].includes(billing_cycle)) {
        return res.status(400).json({ error: 'billing_cycle must be monthly or yearly.' });
    }

    const priceId = stripePriceId(plan_id, billing_cycle);
    if (!priceId) {
        console.error(`No Stripe price configured for ${plan_id}/${billing_cycle}`);
        return res.status(500).json({ error: 'This plan is not available for purchase yet.' });
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('email, stripe_customer_id')
        .eq('id', req.user.id)
        .single();

    try {
        const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            customer: profile?.stripe_customer_id || undefined,
            customer_email: profile?.stripe_customer_id ? undefined : profile?.email,
            client_reference_id: req.user.id,
            metadata: { user_id: req.user.id },
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${process.env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url:  `${process.env.FRONTEND_URL}/billing/cancelled`,
        });
        res.json({ url: session.url });
    } catch (err) {
        console.error('Stripe checkout session error:', err);
        res.status(500).json({ error: 'Could not start checkout. Please try again.' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/billing/portal — -> { url }
// Stripe's hosted billing portal: lets a customer update their card, switch
// monthly/yearly, or cancel, without you building any of that UI yourself.
// Self-serve cancellation here is what makes customer.subscription.deleted
// fire correctly in the webhook handler.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/portal', async (req, res) => {
    const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', req.user.id)
        .single();

    if (!profile?.stripe_customer_id) {
        return res.status(400).json({ error: 'No billing account yet — subscribe to a plan first.' });
    }

    try {
        const session = await stripe.billingPortal.sessions.create({
            customer: profile.stripe_customer_id,
            return_url: `${process.env.FRONTEND_URL}/billing`,
        });
        res.json({ url: session.url });
    } catch (err) {
        console.error('Stripe portal session error:', err);
        res.status(500).json({ error: 'Could not open billing portal. Please try again.' });
    }
});

module.exports = router;
