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
const supabase = require('../lib/supabase');

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
