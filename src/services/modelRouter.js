const { getSettings } = require('../lib/setting');

// Task-based routing: a plain-text prompt with no attachment goes to the
// cheap ChatGPT tier (Luna). A prompt with a file attached, OR one that
// looks like a full page build, goes to Claude. The user's plan still sets
// a ceiling so a free-trial user can't rack up Claude costs before paying.
//
// heavy-build heuristic: since we don't know the AI's chosen actions until
// AFTER we call it, we guess from the message text itself. Keep this list
// short and specific — false positives here just mean a slightly more
// expensive model on an easy question, not a broken feature.
const HEAVY_BUILD_HINTS = [
    'full page', 'full website', 'entire site', 'landing page',
    'build me a', 'build a page', 'redesign', 'new page', 'elementor',
];

function looksLikeHeavyBuild(message) {
    if (!message) return false;
    const lower = message.toLowerCase();
    return HEAVY_BUILD_HINTS.some(hint => lower.includes(hint)) || message.length > 400;
}

// profile: { plan, credits }
// context: { hasAttachment: boolean, message: string }
async function selectProvider(profile, context = {}) {
    const settings = await getSettings();
    const { hasAttachment = false, message = '' } = context;
    const wantsClaude = hasAttachment || looksLikeHeavyBuild(message);

    // Trial users: always the cheap tier, no matter what the prompt looks
    // like. This is the deliberate exception to pure task-based routing —
    // a non-paying trial user attaching a file shouldn't put Claude spend
    // on your card. Revisit if you want trial users to see Claude too.
    if (profile.plan === 'trial' || !profile.plan) {
        return { provider: 'chatgpt', model: 'luna' };
    }

    // Business/agency plan: Claude Opus for heavy work, Sonnet otherwise —
    // matches "enterprise level uses Opus" from your spec.
    if (profile.plan === 'business' || profile.plan === 'agency') {
        if (wantsClaude) {
            const heavy = looksLikeHeavyBuild(message);
            return { provider: 'claude', model: heavy ? 'opus' : 'sonnet' };
        }
        return { provider: 'chatgpt', model: 'luna' };
    }

    // Starter / Pro: task-based, Claude Sonnet only when the message
    // actually needs it (file attached or looks like a full build).
    if (wantsClaude) {
        return { provider: 'claude', model: 'sonnet' };
    }
    return { provider: 'chatgpt', model: 'luna' };
}

module.exports = { selectProvider, looksLikeHeavyBuild };
