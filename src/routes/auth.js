const express  = require('express');
const crypto   = require('crypto');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
const supabase = require('../lib/supabase');
const oauthStore = require('../lib/oauthStore');
const { TRIAL } = require('../lib/plans');
const {
    requireAuth,
    registerSession,
    expireSession,
    sessionIdFromToken,
    SESSION_MAX_AGE_DAYS,
    SESSION_MAX_AGE_MS,
} = require('../middleware/auth');
const router   = express.Router();

// An isolated auth client for password/refresh calls. The shared `supabase`
// client keeps one internal session object for the whole process, so two users
// signing in or refreshing at the same moment can overwrite each other's state
// — the same class of bug oauthStore.js was added to fix for PKCE.
function makeAuthClient() {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
}

// Builds a one-off Supabase auth client whose PKCE code_verifier we can read
// or write ourselves, instead of relying on the shared `supabase` client's
// internal storage (which is the same object for every request/user and
// caused concurrent logins to clash — see lib/oauthStore.js).
function makePkceClient(storage) {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
        auth: { flowType: 'pkce', storage, persistSession: false, autoRefreshToken: false },
    });
}

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
    const { data: session, error: signInErr } = await makeAuthClient().auth.signInWithPassword({ email, password });
    if (signInErr) return res.status(400).json({ error: signInErr.message });

    // Stamp the session's real start time so the 7-day cap ages from here.
    await registerSession(session.session.access_token, session.user.id);

    res.json({
        user:    session.user,
        session: session.session,
        credits: TRIAL.display_credits,
        trial_days: TRIAL.days,
        session_max_age_days: SESSION_MAX_AGE_DAYS,
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

    const { data, error } = await makeAuthClient().auth.signInWithPassword({ email, password });
    if (error) return res.status(401).json({ error: 'Invalid email or password.' });

    // Ensure profile exists (handles edge cases)
    await createUserProfile(data.user.id, data.user.email);

    await registerSession(data.session.access_token, data.user.id);

    res.json({
        user: data.user,
        session: data.session,
        session_max_age_days: SESSION_MAX_AGE_DAYS,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/refresh
// Body: { refresh_token }
//
// Supabase access tokens last one hour. Without this, hour two of any visit
// looked identical to "logged out" and the app bounced people to /auth — the
// bug users actually reported. Refreshing through the backend (rather than
// straight from the browser to Supabase) is what lets the 7-day cap apply to
// refreshes too, instead of only to API calls.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: 'refresh_token is required.' });

    const { data, error } = await makeAuthClient().auth.refreshSession({ refresh_token });

    if (error || !data?.session) {
        return res.status(401).json({
            error: 'Your session has expired. Please sign in again.',
            code:  'SESSION_EXPIRED',
        });
    }

    // A refresh must not extend a login past the cap — otherwise an open tab
    // renews itself forever and the 7 days never arrive.
    const sessionId = sessionIdFromToken(data.session.access_token);
    if (sessionId) {
        const { data: row } = await supabase
            .from('user_sessions')
            .select('started_at')
            .eq('session_id', sessionId)
            .maybeSingle();

        if (row?.started_at && Date.now() - new Date(row.started_at).getTime() > SESSION_MAX_AGE_MS) {
            await expireSession(sessionId, data.session.access_token);
            return res.status(401).json({
                error: `For your security you are signed out after ${SESSION_MAX_AGE_DAYS} days. Please sign in again.`,
                code:  'SESSION_EXPIRED',
            });
        }

        if (!row) await registerSession(data.session.access_token, data.user.id);
        else await supabase.from('user_sessions')
            .update({ last_seen_at: new Date().toISOString() })
            .eq('session_id', sessionId);
    }

    res.json({
        user:    data.user,
        session: data.session,
        session_max_age_days: SESSION_MAX_AGE_DAYS,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/logout — revoke this session everywhere, not just locally.
// Clearing localStorage alone leaves a working refresh token behind.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (token) await expireSession(sessionIdFromToken(token), token);
    res.json({ success: true });
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

    // Unique per-attempt id — carries the PKCE verifier through the redirect
    // round-trip so a second, unrelated login happening at the same moment
    // can never pick up the wrong verifier.
    const state = crypto.randomBytes(16).toString('hex');

    // After OAuth, redirect back to whichever frontend the request came from
    const redirectTo = `${baseUrl}/auth/callback?state=${state}&site_url=${encodeURIComponent(siteUrl)}&site_token=${encodeURIComponent(siteToken)}`;

    // Capture the verifier this call generates instead of letting the shared
    // client store it internally.
    let capturedVerifier = null;
    const capturingStorage = {
        getItem: () => null,
        setItem: (key, value) => { if (key.includes('code-verifier')) capturedVerifier = value; },
        removeItem: () => {},
    };

    const { data, error } = await makePkceClient(capturingStorage).auth.signInWithOAuth({
        provider,
        options: { redirectTo, skipBrowserRedirect: true },
    });

    if (error) return res.status(400).json({ error: error.message });
    if (capturedVerifier) oauthStore.save(state, capturedVerifier);

    res.json({ url: data.url });
});
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/auth/oauth-callback
// Body: { code } — exchanges OAuth code for session (called by frontend)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/oauth-callback', async (req, res) => {
    const { code, state } = req.body;
    if (!code) return res.status(400).json({ error: 'Code is required.' });

    // Look up the verifier saved for this exact login attempt. If `state` is
    // missing (e.g. an older frontend build) or already expired, fall back to
    // the shared client — works fine as long as logins aren't overlapping.
    const verifier = state ? oauthStore.consume(state) : null;

    const exchangeClient = verifier
        ? makePkceClient({
            getItem: (key) => (key.includes('code-verifier') ? verifier : null),
            setItem: () => {},
            removeItem: () => {},
        })
        : supabase;

    const { data, error } = await exchangeClient.auth.exchangeCodeForSession(code);
    if (error) return res.status(400).json({ error: error.message });

    // Give free credits if new user
    await createUserProfile(data.user.id, data.user.email);

    await registerSession(data.session.access_token, data.user.id);

    res.json({
        user: data.user,
        session: data.session,
        session_max_age_days: SESSION_MAX_AGE_DAYS,
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/auth/me — get current user + credits (requires auth header)
// ─────────────────────────────────────────────────────────────────────────────
// Uses requireAuth like every other protected route, so /me reports the same
// verdict (and the same `code`) the rest of the API would — a page that polls
// /me must not think you are signed in when /api/chat would disagree.
router.get('/me', requireAuth, async (req, res) => {
    const { data: profile } = await supabase
        .from('profiles')
        .select('name, credits, plan, created_at')
        .eq('id', req.user.id)
        .single();

    res.json({ user: req.user, profile });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/auth/me — update your own display name
// (the only editable profile field for now — email changes go through
// Supabase auth directly, not this table, since it's also the login credential)
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/me', requireAuth, async (req, res) => {
    const user = req.user;
    const { name } = req.body;
    if (typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'name is required.' });
    }
    if (name.trim().length > 80) {
        return res.status(400).json({ error: 'name must be 80 characters or fewer.' });
    }

    const { data: profile, error: updateError } = await supabase
        .from('profiles')
        .update({ name: name.trim() })
        .eq('id', user.id)
        .select('name, credits, plan, created_at')
        .single();

    if (updateError) {
        console.error('Profile name update failed:', updateError);
        return res.status(500).json({ error: 'Could not update name.' });
    }

    res.json({ profile });
});

module.exports = router;