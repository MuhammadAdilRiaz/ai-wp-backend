async function pingWordPressSite(siteUrl, siteToken) {
    const clean = siteUrl.replace(/\/$/, '');

    // Try both with and without www
    const urlsToTry = [clean];
    if (clean.includes('://www.')) {
        urlsToTry.push(clean.replace('://www.', '://'));
    } else {
        urlsToTry.push(clean.replace('://', '://www.'));
    }

    for (const url of urlsToTry) {
        try {
            console.log(`Trying ping: ${url}/wp-json/aiwpb/v1/status`);
            const res = await fetch(`${url}/wp-json/aiwpb/v1/status`, {
                method:  'GET',
                headers: {
                    'X-AIWPB-Token': siteToken,
                    'User-Agent': 'AIWPBuilder/1.0',
                },
                signal: AbortSignal.timeout(10000),
                redirect: 'follow',
            });

            const text = await res.text();
            console.log(`Ping response ${res.status}:`, text.substring(0, 200));

            if (res.ok) {
                try {
                    const data = JSON.parse(text);
                    return { success: true, data };
                } catch {
                    return { success: false, error: 'Invalid JSON response from WordPress' };
                }
            }

            if (res.status === 401 || res.status === 403) {
                return { success: false, error: 'Token rejected by WordPress plugin. Check the token is correct.' };
            }

        } catch (err) {
            console.log(`Ping failed for ${url}:`, err.message);
        }
    }

    return { success: false, error: 'Could not reach WordPress site. Make sure the plugin is active.' };
}

async function sendActionToWordPress(siteUrl, siteToken, action, params = {}) {
    const clean = siteUrl.replace(/\/$/, '');
    const body  = { action, ...params };

    try {
        const res = await fetch(`${clean}/wp-json/aiwpb/v1/action`, {
            method:  'POST',
            headers: {
                'X-AIWPB-Token': siteToken,
                'Content-Type':  'application/json',
                'User-Agent': 'AIWPBuilder/1.0',
            },
            body:   JSON.stringify(body),
            signal: AbortSignal.timeout(30000),
            redirect: 'follow',
        });

        const data = await res.json();
        if (!res.ok) return { success: false, error: data.message || `HTTP ${res.status}`, data };
        return { success: true, data };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function getWordPressContext(siteUrl, siteToken) {
    const clean = siteUrl.replace(/\/$/, '');
    try {
        const res = await fetch(`${clean}/wp-json/aiwpb/v1/context`, {
            headers: {
                'X-AIWPB-Token': siteToken,
                'User-Agent': 'AIWPBuilder/1.0',
            },
            signal: AbortSignal.timeout(10000),
            redirect: 'follow',
        });
        return await res.json();
    } catch (err) {
        console.error('Get context error:', err.message);
        return null;
    }
}

module.exports = { pingWordPressSite, sendActionToWordPress, getWordPressContext };
