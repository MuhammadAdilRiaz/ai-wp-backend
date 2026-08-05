require('dotenv').config();
const express    = require('express');
const helmet     = require('helmet');
const cors       = require('cors');
const rateLimit  = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const chatRoutes = require('./routes/chat');
const siteRoutes = require('./routes/sites');
const creditRoutes = require('./routes/credits');
const plansRoutes = require('./routes/plans');

const app  = express();
const PORT = process.env.PORT || 3001;

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

// ── Parse JSON bodies ─────────────────────────────────────────────────────────
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
app.use('/api/plans', plansRoutes);

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
app.listen(PORT, () => {
    console.log(`AI WP Builder backend running on port ${PORT}`);
});
