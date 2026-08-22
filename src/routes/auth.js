const express  = require('express');
const rateLimit = require('express-rate-limit');
const supabase = require('../lib/supabase');
const { TRIAL } = require('../lib/plans');
const router   = express.Router();

// Scripted mass trial signups are the real cost risk, not organic trial
// usage (worst case there is bounded — see TRIAL.real_credits). 5 signups/hr
// per IP is generous for a real person, tight for a bot loop.
const signupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { error: 'Too many signup attempts from this address. Try again later.' },
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: create user profile + start their 7-day trial on first signup.
// No free tier — every account starts on `trial` and must pick a paid plan
// (starter/pro/business) before or when the trial runs out (enforced in
// chat.js, not here).
// ─────────────────────────────────────────────────────────────────────────────
async function createUserProfile(userId, email) {
    // Check if profile already exists (avoid duplicates)
    const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .single();

    if (existing) return; // already set up

    const trialEndsAt = new Date(Date.now() + TRIAL.days * 24 * 60 * 60 * 1000).toISOString();

    // Create profile row
    await supabase.from('profiles').insert({
        id:             userId,
        email:          email,
        credits:        TRIAL.real_credits,
        plan:           'trial',
        trial_ends_at:  trialEndsAt,
        created_at:     new Date().toISOString(),
    });

    // Log the trial credit grant
    await supabase.from('credit_transactions').insert({
        user_id:     userId,
        amount:      TRIAL.real_credits,
        type:        'grant',
        description: `${TRIAL.days}-day trial credits`,
        created_at:  new Date().toISOString(),
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/signup
// Body: { email, password }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/signup', signupLimiter, async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }
    if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true, // skip email verification for now
    });

    if (error) return res.status(400).json({ error: error.message });

    // Give free credits
    await createUserProfile(data.user.id, email);

    // Sign them in immediately
    const { data: session, error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
    if (signInErr) return res.status(400).json({ error: signInErr.message });

    res.json({
        user:    session.user,
        session: session.session,
        credits: TRIAL.display_credits,
        trial_days: TRIAL.days,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/login
// Body: { email, password }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
    }

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid email or password.' });

    // Ensure profile exists (handles edge cases)
    await createUserProfile(data.user.id, data.user.email);

    res.json({ user: data.user, session: data.session });
});

/// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/oauth-url?provider=google|github
// Returns the OAuth redirect URL — frontend opens this in a popup or redirect
// ─────────────────────────────────────────────────────────────────────────────

// List of frontend URLs allowed to receive the OAuth redirect
const ALLOWED_FRONTEND_URLS = [
    process.env.FRONTEND_URL,          // production, e.g. https://derbypetstore.com
    'http://localhost:3000',           // local dev
];

router.get('/oauth-url', async (req, res) => {
    const provider  = req.query.provider; // 'google' or 'github'
    const siteUrl   = req.query.site_url || '';
    const siteToken = req.query.site_token || '';

    if (!['google', 'github'].includes(provider)) {
        return res.status(400).json({ error: 'Provider must be google or github.' });
    }

    // Figure out which frontend this request came from
    const origin = req.query.origin || req.headers.origin || req.headers.referer || '';
    const matchedOrigin = ALLOWED_FRONTEND_URLS.find(url => url && origin.startsWith(url));
    const baseUrl = matchedOrigin || process.env.FRONTEND_URL; // fallback to production

    // After OAuth, redirect back to whichever frontend the request came from
    const redirectTo = `${baseUrl}/auth/callback?site_url=${encodeURIComponent(siteUrl)}&site_token=${encodeURIComponent(siteToken)}`;

    const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
    });

    if (error) return res.status(400).json({ error: error.message });

    res.json({ url: data.url });
});
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/oauth-callback
// Body: { code } — exchanges OAuth code for session (called by frontend)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/oauth-callback', async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code is required.' });

    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return res.status(400).json({ error: error.message });

    // Give free credits if new user
    await createUserProfile(data.user.id, data.user.email);

    res.json({ user: data.user, session: data.session });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me — get current user + credits (requires auth header)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Not logged in.' });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid session.' });

    const { data: profile } = await supabase
        .from('profiles')
        .select('credits, plan, created_at')
        .eq('id', user.id)
        .single();

    res.json({ user, profile });
});

module.exports = router;
