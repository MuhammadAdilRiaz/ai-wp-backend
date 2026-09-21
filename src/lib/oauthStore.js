// Short-lived, in-memory store for PKCE code_verifiers during Google/GitHub
// login. Keyed by a random `state` value (one per login attempt) instead of
// being tied to one shared Supabase client instance — this is what lets two
// different users go through OAuth at the same time without overwriting
// each other's verifier. See routes/auth.js (oauth-url / oauth-callback).
const store = new Map();
const TTL_MS = 5 * 60 * 1000; // an OAuth round-trip should finish well within 5 minutes

function save(state, verifier) {
    store.set(state, { verifier, expires: Date.now() + TTL_MS });
}

function consume(state) {
    const entry = store.get(state);
    store.delete(state); // one-time use either way
    if (!entry || entry.expires < Date.now()) return null;
    return entry.verifier;
}

// Sweep anything that was never completed so this never grows unbounded
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
        if (entry.expires < now) store.delete(key);
    }
}, 60 * 1000).unref();

module.exports = { save, consume };