<<<<<<< HEAD
// ─────────────────────────────────────────────────────────────────────────────
// requireAuth — the single gate every protected route goes through.
//
// This file used to export an Express *Router* (a near-duplicate of
// routes/auth.js). So in chat.js / sites.js / billing.js / credits.js:
//
//     const { requireAuth } = require('../middleware/auth');   // -> undefined
//     router.use(requireAuth);                                 // -> throws
//
// Express throws "Router.use() requires a middleware function but got a
// undefined" at require() time, which killed the server on boot — and a dead
// backend is exactly why a signed-in user got "authentication required" the
// moment they opened a project. The router that used to live here has been
// moved (with its PKCE fix intact) into routes/auth.js, which is the file
// server.js actually mounts.
// ─────────────────────────────────────────────────────────────────────────────
=======
const express  = require('express');
const crypto   = require('crypto');
const rateLimit = require('express-rate-limit');
const { createClient } = require('@supabase/supabase-js');
>>>>>>> 0b836fa23e96675e1ba058e27632f588f8dc77fa
const supabase = require('../lib/supabase');
const oauthStore = require('../lib/oauthStore');
const { TRIAL } = require('../lib/plans');
const router   = express.Router();

<<<<<<< HEAD
// How long a login lasts before we force a fresh sign-in, regardless of
// activity. Supabase access tokens expire hourly and refresh silently, so
// without a cap here a session would effectively never end.
const SESSION_MAX_AGE_DAYS = 7;
const SESSION_MAX_AGE_MS   = SESSION_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

// session_id -> epoch ms of when that session first signed in. Saves a DB
// round-trip on every authenticated request; user_sessions is the source of
// truth and a cold cache just re-reads it.
const sessionStartCache = new Map();
const SESSION_CACHE_MAX = 5000;

function cacheSessionStart(sessionId, ms) {
    if (sessionStartCache.size > SESSION_CACHE_MAX) sessionStartCache.clear();
    sessionStartCache.set(sessionId, ms);
}

// Supabase access tokens are plain JWTs and carry a `session_id` claim that
// stays stable across refreshes — that is what lets us age a *login* rather
// than an access token. We only read the payload for the id; the signature is
// verified by supabase.auth.getUser() before we trust anything here.
function decodeJwtPayload(token) {
    try {
        const part = String(token).split('.')[1];
        if (!part) return null;
        return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

function sessionIdFromToken(token) {
    return decodeJwtPayload(token)?.session_id || null;
}

// "We could not reach Supabase" vs "Supabase said this token is bad". The
// first must never log a user out. supabase-js signals the network case with
// AuthRetryableFetchError (status 0 / 5xx) instead of throwing.
function isTransientAuthError(error) {
    if (!error) return false;
    if (error.name === 'AuthRetryableFetchError') return true;
    if (error.status === 0 || error.status === undefined) return true;
    return error.status >= 500;
}

// Record a brand-new login. Called from routes/auth.js right after
// signup/login/oauth so started_at is the real sign-in moment.
async function registerSession(accessToken, userId) {
    const sessionId = sessionIdFromToken(accessToken);
    if (!sessionId) return null;

    const startedAt = new Date();
    try {
        await supabase.from('user_sessions').upsert({
            session_id:   sessionId,
            user_id:      userId,
            started_at:   startedAt.toISOString(),
            last_seen_at: startedAt.toISOString(),
        }, { onConflict: 'session_id', ignoreDuplicates: true });
        cacheSessionStart(sessionId, startedAt.getTime());
    } catch (err) {
        // Never block a successful login on bookkeeping. Worst case the
        // session gets adopted on first use instead (see sessionStartedAt).
        console.error('registerSession failed:', err.message);
    }
    return sessionId;
}

// When did this login start? Falls back to "now" the first time we see a
// session we have no row for (e.g. someone still holding a token issued
// before this table existed) — erring late is the forgiving direction.
async function sessionStartedAt(sessionId, userId) {
    const cached = sessionStartCache.get(sessionId);
    if (cached) return cached;

    const { data } = await supabase
        .from('user_sessions')
        .select('started_at')
        .eq('session_id', sessionId)
        .maybeSingle();

    if (data?.started_at) {
        const ms = new Date(data.started_at).getTime();
        cacheSessionStart(sessionId, ms);
        return ms;
    }

    const now = new Date();
    await supabase.from('user_sessions').upsert({
        session_id:   sessionId,
        user_id:      userId,
        started_at:   now.toISOString(),
        last_seen_at: now.toISOString(),
    }, { onConflict: 'session_id', ignoreDuplicates: true });

    // Re-read: a concurrent request may have won the insert with an earlier
    // timestamp, and that earlier one is the one we should age against.
    const { data: after } = await supabase
        .from('user_sessions')
        .select('started_at')
        .eq('session_id', sessionId)
        .maybeSingle();

    const ms = after?.started_at ? new Date(after.started_at).getTime() : now.getTime();
    cacheSessionStart(sessionId, ms);
    return ms;
}

// Hard-revoke a session that has outlived the cap. Revoking at Supabase is
// the part that matters: it kills the refresh token too, so the frontend
// cannot quietly mint a fresh access token and keep the login alive forever.
async function expireSession(sessionId, accessToken) {
    if (sessionId) sessionStartCache.delete(sessionId);
    try {
        await supabase.auth.admin.signOut(accessToken, 'global');
    } catch (err) {
        console.error('expireSession: signOut failed:', err.message);
    }
    if (sessionId) {
        try {
            await supabase.from('user_sessions').delete().eq('session_id', sessionId);
        } catch (err) {
            console.error('expireSession: cleanup failed:', err.message);
        }
    }
}

async function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token  = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

    if (!token) {
        return res.status(401).json({ error: 'Please sign in to continue.', code: 'NO_TOKEN' });
    }

    // Reject junk before it reaches Supabase, so that a client-side parse
    // failure (which carries no HTTP status) can't be mistaken for an outage
    // by isTransientAuthError and leave the caller retrying a 503 forever.
    if (!decodeJwtPayload(token)) {
        return res.status(401).json({
            error: 'Your session has expired. Please sign in again.',
            code:  'TOKEN_INVALID',
        });
    }

    let user;
    try {
        const { data, error } = await supabase.auth.getUser(token);

        if (error) {
            // Supabase being unreachable is NOT the same as a bad token, and it
            // usually arrives as a returned error rather than a thrown one.
            // Answering 401 here would sign every active user out over a
            // transient network blip — the most annoying auth bug a product
            // can ship. 503 tells the frontend to retry, not to log out.
            if (isTransientAuthError(error)) {
                console.error('requireAuth: auth service unreachable:', error.message);
                return res.status(503).json({
                    error: 'Could not verify your session right now. Please try again in a moment.',
                    code:  'AUTH_UNAVAILABLE',
                });
            }
            return res.status(401).json({
                error: 'Your session has expired. Please sign in again.',
                code:  'TOKEN_INVALID',
            });
        }

        if (!data?.user) {
            return res.status(401).json({
                error: 'Your session has expired. Please sign in again.',
                code:  'TOKEN_INVALID',
            });
        }
        user = data.user;
    } catch (err) {
        console.error('requireAuth: auth service threw:', err.message);
        return res.status(503).json({
            error: 'Could not verify your session right now. Please try again in a moment.',
            code:  'AUTH_UNAVAILABLE',
        });
    }

    const sessionId = sessionIdFromToken(token);

    if (sessionId) {
        let startedAt = null;
        try {
            startedAt = await sessionStartedAt(sessionId, user.id);
        } catch (err) {
            // Bookkeeping trouble must not lock a valid user out.
            console.error('requireAuth: session lookup failed:', err.message);
        }

        if (startedAt && Date.now() - startedAt > SESSION_MAX_AGE_MS) {
            await expireSession(sessionId, token);
            return res.status(401).json({
                error: `For your security you are signed out after ${SESSION_MAX_AGE_DAYS} days. Please sign in again.`,
                code:  'SESSION_EXPIRED',
            });
        }
    }

    req.user        = user;
    req.accessToken = token;
    req.sessionId   = sessionId;
    next();
}

module.exports = {
    requireAuth,
    registerSession,
    expireSession,
    sessionIdFromToken,
    decodeJwtPayload,
    SESSION_MAX_AGE_DAYS,
    SESSION_MAX_AGE_MS,
};
=======
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
        .select('name, credits, plan, created_at')
        .eq('id', user.id)
        .single();

    res.json({ user, profile });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/auth/me — update your own display name
// (the only editable profile field for now — email changes go through
// Supabase auth directly, not this table, since it's also the login credential)
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/me', async (req, res) => {
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Not logged in.' });

    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error || !user) return res.status(401).json({ error: 'Invalid session.' });

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
>>>>>>> 0b836fa23e96675e1ba058e27632f588f8dc77fa
