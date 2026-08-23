const express  = require('express');
const stripe   = require('../lib/stripe');
const supabase = require('../lib/supabase');
const { getPlan, planFromStripePriceId } = require('../lib/plans');
const { sendPaymentFailedEmail, sendSubscriptionCancelledEmail } = require('../lib/email');
const router   = express.Router();

// NOTE: this route is mounted with express.raw() in server.js, BEFORE the
// global express.json() middleware — Stripe signature verification needs
// the exact raw request bytes, not a re-serialized JSON object. If you ever
// see "No signatures found matching the expected signature", the raw-body
// mounting order in server.js is almost always the cause.
router.post('/stripe', async (req, res) => {
    let event;
    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            req.headers['stripe-signature'],
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error('Stripe webhook signature verification failed:', err.message);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutCompleted(event.data.object);
                break;
            case 'invoice.paid':
                await handleInvoicePaid(event.data.object);
                break;
            case 'invoice.payment_failed':
                await handlePaymentFailed(event.data.object);
                break;
            case 'customer.subscription.updated':
                await handleSubscriptionUpdated(event.data.object);
                break;
            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event.data.object);
                break;
            // Unhandled event types are expected — Stripe sends many more
            // than you need. Returning 200 for them tells Stripe "received,
            // no action needed" so it doesn't keep retrying.
        }
        res.json({ received: true });
    } catch (err) {
        // Return 500 so Stripe retries this event later — losing a webhook
        // silently is how a paid user ends up stuck on trial credits.
        console.error(`Error handling ${event.type}:`, err);
        res.status(500).json({ error: 'Webhook handler failed' });
    }
});

// ── checkout.session.completed — first payment, activate the plan ─────────────
async function handleCheckoutCompleted(session) {
    const userId = session.metadata?.user_id || session.client_reference_id;
    if (!userId) {
        console.error('checkout.session.completed with no user_id in metadata:', session.id);
        return;
    }

    const subscription = await stripe.subscriptions.retrieve(session.subscription);
    const priceId = subscription.items.data[0]?.price?.id;
    const match = planFromStripePriceId(priceId);
    if (!match) {
        console.error('checkout.session.completed with unrecognized price:', priceId);
        return;
    }

    const plan = getPlan(match.planId);

    await supabase.from('profiles').update({
        plan:                  match.planId,
        billing_cycle:         match.cycle,
        credits:               plan.real_credits_monthly,
        trial_ends_at:         null,
        billing_status:        'active',
        stripe_customer_id:    session.customer,
        stripe_subscription_id: session.subscription,
        low_credit_notified:   false,
    }).eq('id', userId);

    await supabase.from('credit_transactions').insert({
        user_id:     userId,
        amount:      plan.real_credits_monthly,
        type:        'grant',
        description: `${plan.label} plan activated`,
        created_at:  new Date().toISOString(),
    });
}

// ── invoice.paid — monthly/annual renewal, refill credits ─────────────────────
async function handleInvoicePaid(invoice) {
    // Skip the FIRST invoice (checkout.session.completed already granted
    // credits for it) — only act on actual renewals.
    if (invoice.billing_reason !== 'subscription_cycle') return;
    if (!invoice.subscription) return;

    const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('stripe_subscription_id', invoice.subscription)
        .single();
    if (!profile) return;

    const priceId = invoice.lines.data[0]?.price?.id;
    const match = planFromStripePriceId(priceId);
    if (!match) return;
    const plan = getPlan(match.planId);

    // Reset (not add) — unused credits don't roll over month to month.
    await supabase.from('profiles').update({
        credits:             plan.real_credits_monthly,
        billing_status:      'active',
        low_credit_notified: false,
    }).eq('id', profile.id);

    await supabase.from('credit_transactions').insert({
        user_id:     profile.id,
        amount:      plan.real_credits_monthly,
        type:        'grant',
        description: `${plan.label} plan renewed`,
        created_at:  new Date().toISOString(),
    });
}

// ── invoice.payment_failed — start the dunning grace period ───────────────────
// Deliberately does NOT downgrade or lock the account — Stripe's Smart
// Retries will retry the card automatically. Only customer.subscription.deleted
// (fired after retries are exhausted, per your Stripe dunning settings)
// actually locks the account. This is what makes it a grace period and not
// an instant hard stop.
async function handlePaymentFailed(invoice) {
    if (!invoice.subscription) return;

    const { data: profile } = await supabase
        .from('profiles')
        .select('id, email, billing_status')
        .eq('stripe_subscription_id', invoice.subscription)
        .single();
    if (!profile) return;

    // Only email on the FIRST failure for this dunning cycle, not every retry
    if (profile.billing_status === 'past_due') return;

    await supabase.from('profiles').update({ billing_status: 'past_due' }).eq('id', profile.id);
    await sendPaymentFailedEmail(profile.email);
}

// ── customer.subscription.updated — plan change (upgrade/downgrade/cycle) ─────
async function handleSubscriptionUpdated(subscription) {
    const priceId = subscription.items.data[0]?.price?.id;
    const match = planFromStripePriceId(priceId);
    if (!match) return;

    const { data: profile } = await supabase
        .from('profiles')
        .select('id, credits, plan')
        .eq('stripe_subscription_id', subscription.id)
        .single();
    if (!profile) return;
    if (profile.plan === match.planId) return; // no plan change, nothing to do

    const newPlan = getPlan(match.planId);

    await supabase.from('profiles').update({
        plan:          match.planId,
        billing_cycle: match.cycle,
        // Cap credits at the new plan's allotment — a downgrade shouldn't
        // leave someone holding more credits than that tier is priced for.
        // An upgrade keeps whatever they had (they haven't lost anything).
        credits: Math.min(profile.credits, newPlan.real_credits_monthly),
    }).eq('id', profile.id);
}

// ── customer.subscription.deleted — retries exhausted or manually cancelled ───
async function handleSubscriptionDeleted(subscription) {
    const { data: profile } = await supabase
        .from('profiles')
        .select('id, email')
        .eq('stripe_subscription_id', subscription.id)
        .single();
    if (!profile) return;

    await supabase.from('profiles').update({
        plan:           'cancelled',
        billing_status: 'cancelled',
        credits:        0, // hard stop, per your call — no messages until they resubscribe
    }).eq('id', profile.id);

    await sendSubscriptionCancelledEmail(profile.email);
}

module.exports = router;
