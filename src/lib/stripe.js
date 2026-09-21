const Stripe = require('stripe');

// Lazy, for the same reason as lib/email.js and services/openai.js: Stripe's
// constructor throws on a missing key, and a missing STRIPE_SECRET_KEY should
// mean "billing is unavailable", not "the server will not start". The proxy
// keeps the existing `const stripe = require('../lib/stripe')` call sites
// working unchanged.
let stripe = null;
function getStripe() {
    if (!process.env.STRIPE_SECRET_KEY) {
        throw new Error('STRIPE_SECRET_KEY is not configured on the server.');
    }
    if (!stripe) stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    return stripe;
}

module.exports = new Proxy({}, {
    get: (_target, prop) => getStripe()[prop],
});
