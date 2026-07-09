/**
 * wordpress.js
 * All communication with customer WordPress sites.
 * Every function calls the REST API endpoints exposed by our WP plugin.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Ping: verify the site is reachable and the token is valid
// ─────────────────────────────────────────────────────────────────────────────
async function pingWordPressSite(siteUrl, siteToken) {
    try {
        const clean = siteUrl.replace(/\/$/, '');
        const res = await fetch(`${clean}/wp-json/aiwpb/v1/status`, {
            method:  'GET',
            headers: { 'X-AIWPB-Token': siteToken },
            signal:  AbortSignal.timeout(8000), // 8 second timeout
        });

        if (!res.ok) {
            return { success: false, error: `HTTP ${res.status}` };
        }

        const data = await res.json();
        return { success: true, data };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Send action: main function — sends any AI action to the WP plugin
// ─────────────────────────────────────────────────────────────────────────────
async function sendActionToWordPress(siteUrl, siteToken, action, params = {}) {
    const clean = siteUrl.replace(/\/$/, '');
    const body  = { action, ...params };

    try {
        const res = await fetch(`${clean}/wp-json/aiwpb/v1/action`, {
            method:  'POST',
            headers: {
                'X-AIWPB-Token': siteToken,
                'Content-Type':  'application/json',
            },
            body:   JSON.stringify(body),
            signal: AbortSignal.timeout(30000), // 30s — Elementor builds can take time
        });

        const data = await res.json();

        if (!res.ok) {
            return { success: false, error: data.message || `HTTP ${res.status}`, data };
        }

        return { success: true, data };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Get context: fetch current site state for Claude to understand
// ─────────────────────────────────────────────────────────────────────────────
async function getWordPressContext(siteUrl, siteToken) {
    const clean = siteUrl.replace(/\/$/, '');
    try {
        const res = await fetch(`${clean}/wp-json/aiwpb/v1/context`, {
            headers: { 'X-AIWPB-Token': siteToken },
            signal:  AbortSignal.timeout(10000),
        });
        return await res.json();
    } catch (err) {
        return null;
    }
}

module.exports = { pingWordPressSite, sendActionToWordPress, getWordPressContext };
