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

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());

// ── CORS: only allow your frontend ───────────────────────────────────────────
app.use(cors({
    origin: [
        process.env.FRONTEND_URL,
        'http://localhost:3000',  // for local dev
    ],
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
