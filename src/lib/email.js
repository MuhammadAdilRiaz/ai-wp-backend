const { Resend } = require('resend');

// Built on first send, not at import time: Resend's constructor throws when
// RESEND_API_KEY is missing, and this module is required (transitively) by
// routes/chat.js — so one unset optional env var was enough to stop the whole
// server from booting. Email is a nice-to-have; it must never be load-bearing.
let resend = null;
function getResend() {
    if (!process.env.RESEND_API_KEY) return null;
    if (!resend) resend = new Resend(process.env.RESEND_API_KEY);
    return resend;
}

const FROM = process.env.EMAIL_FROM || 'billing@yourdomain.com';

// The only function that knows which provider you're on. If you switch to
// SendGrid or Postmark, this is the one place that changes — every sendX()
// function below just calls this.
async function send({ to, subject, html }) {
    const client = getResend();
    if (!client) {
        console.warn(`Email skipped (RESEND_API_KEY not set): "${subject}" -> ${to}`);
        return;
    }
    try {
        await client.emails.send({ from: FROM, to, subject, html });
    } catch (err) {
        // Email failing should never break the request that triggered it
        // (a chat message, a webhook). Log and move on.
        console.error('Email send failed:', err);
    }
}

async function sendTrialEndingEmail(email) {
    await send({
        to: email,
        subject: 'Your trial ends tomorrow',
        html: `<p>Your 7-day trial ends in about 24 hours. Pick a plan to keep building — Starter, Pro, or Business.</p>`,
    });
}

async function sendLowCreditEmail(email, planLabel) {
    await send({
        to: email,
        subject: "You're running low on credits",
        html: `<p>You've used most of your ${planLabel} plan's monthly credits. Upgrade to a higher tier if you need more room this month, or wait for your next renewal.</p>`,
    });
}

async function sendPaymentFailedEmail(email) {
    await send({
        to: email,
        subject: 'Payment failed — please update your card',
        html: `<p>Your last payment didn't go through. We'll retry automatically over the next few days — update your card to avoid any interruption.</p>`,
    });
}

async function sendSubscriptionCancelledEmail(email) {
    await send({
        to: email,
        subject: 'Your subscription has ended',
        html: `<p>Your subscription is now cancelled and your account is locked. Resubscribe any time to pick up where you left off.</p>`,
    });
}

module.exports = {
    sendTrialEndingEmail,
    sendLowCreditEmail,
    sendPaymentFailedEmail,
    sendSubscriptionCancelledEmail,
};
