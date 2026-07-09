const express  = require('express');
const supabase = require('../lib/supabase');
const router   = express.Router();

const FREE_CREDITS = parseInt(process.env.FREE_CREDITS) || 100;

// ─────────────────────────────────────────────────────────────────────────────
// Helper: create user profile + give free credits on first signup
// ─────────────────────────────────────────────────────────────────────────────
async function createUserProfile(userId, email) {
    // Check if profile already exists (avoid duplicates)
    const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .single();

    if (existing) return; // already set up

    // Create profile row
    await supabase.from('profiles').insert({
        id:         userId,
        email:      email,
        credits:    FREE_CREDITS,
        plan:       'free',
        created_at: new Date().toISOString(),
    });

    // Log the free credit grant
    await supabase.from('credit_transactions').insert({
        user_id:     userId,
        amount:      FREE_CREDITS,
        type:        'grant',
        description: 'Welcome gift — free credits',
        created_at:  new Date().toISOString(),
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/signup
// Body: { email, password }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/signup', async (req, res) => {
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
        credits: FREE_CREDITS,
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/oauth-url?provider=google|github
// Returns the OAuth redirect URL — frontend opens this in a popup or redirect
// ─────────────────────────────────────────────────────────────────────────────
router.get('/oauth-url', async (req, res) => {
    const provider  = req.query.provider; // 'google' or 'github'
    const siteUrl   = req.query.site_url || '';
    const siteToken = req.query.site_token || '';

    if (!['google', 'github'].includes(provider)) {
        return res.status(400).json({ error: 'Provider must be google or github.' });
    }

    // After OAuth, redirect back to frontend with session
    const redirectTo = `${process.env.FRONTEND_URL}/auth/callback?site_url=${encodeURIComponent(siteUrl)}&site_token=${encodeURIComponent(siteToken)}`;

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
