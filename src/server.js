require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const siteRoutes = require('./routes/sites');
const creditRoutes = require('./routes/credits');
const billingRoutes = require('./routes/billing');
const webhookRoutes = require('./routes/webhooks');
const { startCronJobs } = require('./lib/cron');
// plansRoutes is NOT wired below — it queries a `plans` table and a
// `plan_credit_tiers_display` view that don't exist in supabase-schema.sql,
// so every call 500s. /api/credits/plans does the same job (list of buyable
// plans) and is actually backed by the schema. Build out the plans/tiers
// tables properly before re-enabling this route.
// const plansRoutes = require('./routes/plans');

const app  = express();
const PORT = process.env.PORT || 3001;

app.disable('etag');

// Render (like any PaaS) puts a proxy in front of us, so req.ip is the proxy's
// address unless we trust the X-Forwarded-For header it sets. Without this,
// express-rate-limit keys EVERY request off that one proxy IP -- meaning all
// users share a single 60-requests-per-minute bucket and throttle each other.
// It also logs ERR_ERL_UNEXPECTED_X_FORWARDED_FOR on every request. `1` trusts
// exactly one proxy hop, which is what Render puts in front of the service;
// `true` would trust the whole chain and let a client spoof its own IP.
app.set('trust proxy', 1);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS: only allow your frontend ───────────────────────────────────────────
// FRONTEND_URL names ONE origin, but a site is normally reachable at both the
// apex and the www host. Listing only one meant the other loaded the page and
// then failed every API call on CORS -- a confusing "the site is up but nothing
// works" failure. Accept both spellings of the configured host instead.
function allowedOrigins() {
    const list = ['http://localhost:3000'];
    const configured = process.env.FRONTEND_URL;
    if (!configured) return list;

    list.push(configured);
    try {
        const { protocol, host } = new URL(configured);
        const sibling = host.startsWith('www.')
            ? host.slice(4)          // www.example.com -> example.com
            : `www.${host}`;         // example.com     -> www.example.com
        list.push(`${protocol}//${sibling}`);
    } catch {
        // FRONTEND_URL isn't a parseable URL; the exact string above still works.
    }
    return list;
}

const ALLOWED_ORIGINS = allowedOrigins();

app.use(cors({
    origin: (origin, callback) => {
        // No Origin header = a same-origin or non-browser caller (curl, health
        // checks, the WordPress plugin). Those aren't subject to CORS.
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        callback(new Error(`Origin ${origin} is not allowed by CORS.`));
    },
    credentials: true,
}));

// ── Stripe webhook: MUST get the raw body, so this is mounted BEFORE
// express.json() below. Moving this line after express.json() will break
// signature verification — Stripe signs the exact raw bytes, and by the
// time express.json() has parsed+re-serialized them they no longer match.
app.use('/api/webhooks', express.raw({ type: 'application/json' }), webhookRoutes);

// ── Parse JSON bodies (everything except the webhook route above) ────────────
app.use(express.json());

// ── Rate limiting: max 60 requests per minute per IP ─────────────────────────
app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'Too many requests, slow down.' },
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/chat',    chatRoutes);
app.use('/api/sites',   siteRoutes);
app.use('/api/credits', creditRoutes);
app.use('/api/billing', billingRoutes);
// /api/webhooks already mounted above, before express.json()

// ── Health check (Railway uses this to confirm app is running) ────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0.0' });
});

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0' , () => {
    console.log(`AI WP Builder backend running on port ${PORT}`);
    startCronJobs();
});
