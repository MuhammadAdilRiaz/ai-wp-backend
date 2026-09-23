// Store for PKCE code_verifiers during Google/GitHub login, keyed by a random
// `state` value (one per login attempt) so two people signing in at the same
// moment can never pick up each other's verifier.
//
// This used to be an in-process Map. The backend runs on Render's free tier,
// which spins down when idle and recycles instances -- so a restart between
// "Continue with Google" and the callback silently dropped the verifier. The
// fallback in routes/auth.js did not save it either: it retried the exchange
// on the shared Supabase client, which never held a verifier, so the login
// failed and the user was thrown back to /auth having just authenticated
// successfully with Google. Keeping the verifier in Postgres makes the
// round-trip survive restarts, and would survive more than one instance.
const supabase = require('./supabase');

const TTL_MS = 5 * 60 * 1000; // an OAuth round-trip finishes well within this

async function save(state, verifier) {
    const { error } = await supabase
        .from('oauth_states')
        .insert({ state, verifier, created_at: new Date().toISOString() });

    if (error) {
        // Don't fail the login attempt over bookkeeping -- the exchange will
        // report a clearer error if the verifier really is missing later.
        console.error('oauthStore.save failed:', error.message);
    }
}

async function consume(state) {
    // Single-use: delete and read in one round-trip, so a replayed callback
    // cannot reuse a verifier even if it arrives twice.
    const { data, error } = await supabase
        .from('oauth_states')
        .delete()
        .eq('state', state)
        .select('verifier, created_at')
        .maybeSingle();

    if (error) {
        console.error('oauthStore.consume failed:', error.message);
        return null;
    }
    if (!data) return null;
    if (Date.now() - new Date(data.created_at).getTime() > TTL_MS) return null;

    return data.verifier;
}

// Sweep abandoned attempts (user closed the Google tab, etc.) so the table
// cannot grow without bound. Best-effort; unref'd so it never holds the
// process open.
setInterval(async () => {
    try {
        await supabase
            .from('oauth_states')
            .delete()
            .lt('created_at', new Date(Date.now() - TTL_MS).toISOString());
    } catch (err) {
        console.error('oauthStore sweep failed:', err.message);
    }
}, 5 * 60 * 1000).unref();

module.exports = { save, consume };
