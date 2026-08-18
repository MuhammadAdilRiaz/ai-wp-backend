const { getSettings } = require('../lib/setting');

async function selectProvider(profile) {
    if (profile.plan === 'business') return 'claude';
    if (profile.plan === 'pro') {
        const settings = await getSettings();
        const threshold = settings.pro_claude_threshold ?? 800; // agar setting missing ho to purana default
        return profile.credits > threshold ? 'claude' : 'chatgpt';
    }
    return 'chatgpt';
}

module.exports = { selectProvider };