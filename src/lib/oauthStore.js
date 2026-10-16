// Holds the Supabase auth-client storage snapshot for an in-flight
// Google/GitHub login, keyed by a random `state` (one per attempt) so two
// people signing in at the same moment cannot collide.
//
// Why a whole snapshot and not just "the verifier": during the authorize step
// supabase-js writes several keys, and they do not all hold the verifier --
// <base>-flows-code-verifier is a JSON array of flow ids. Matching keys by
// substring risked storing the wrong value, and the layout is an internal
// detail that already changed between 2.43 and 2.112. Replaying the snapshot
// verbatim means the exchange finds whatever key it actually asks for.
//
// Why Postgres and not memory: this ran on a Map in process memory, and the
// backend is on Render free tier, which spins down when idle and recycles
// instances -- a restart mid-login dropped the state and the user was bounced
// back to /auth having just authenticated successfully.
const supabase = require('./supabase');

const TTL_MS = 5 * 60 * 1000; // an OAuth round-trip finishes well within this

// snapshot: a plain object of storage key -> value
async function save(state, snapshot) {
    const { error } = await supabase
        .from('oauth_states')
        .insert({
            state,
            storage: JSON.stringify(snapshot),
            created_at: new Date().toISOString(),
        });

    if (error) console.error('oauthStore.save failed:', error.message);
}

async function consume(state) {
    // Delete and read in one statement: single-use, so a replayed callback
    // cannot reuse a snapshot even if it arrives twice.
    const { data, error } = await supabase
        .from('oauth_states')
        .delete()
        .eq('state', state)
        .select('storage, created_at')
        .maybeSingle();

    if (error) {
        console.error('oauthStore.consume failed:', error.message);
        return null;
    }
    if (!data) return null;
    if (Date.now() - new Date(data.created_at).getTime() > TTL_MS) return null;

    try {
        return JSON.parse(data.storage);
    } catch (err) {
        console.error('oauthStore.consume: unreadable snapshot:', err.message);
        return null;
    }
}

// Sweep attempts that were never completed (user closed the provider tab, etc.)
// so the table cannot grow without bound. Unreferenced so it never holds the
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
