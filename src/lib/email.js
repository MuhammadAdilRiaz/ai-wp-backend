const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.EMAIL_FROM || 'billing@yourdomain.com';

// The only function that knows which provider you're on. If you switch to
// SendGrid or Postmark, this is the one place that changes — every sendX()
// function below just calls this.
async function send({ to, subject, html }) {
    try {
        await resend.emails.send({ from: FROM, to, subject, html });
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
