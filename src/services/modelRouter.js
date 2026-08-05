// ─────────────────────────────────────────────────────────────────────────────
// Decides which AI provider ('claude' or 'chatgpt') a message should use,
// based on the user's plan and their CURRENT remaining credit balance.
//
// Rules:
//   - free plan:      always 'chatgpt'
//   - pro plan:       'claude' while balance > 800 credits, else 'chatgpt'
//   - business plan:  always 'claude'
// ─────────────────────────────────────────────────────────────────────────────
const PRO_CLAUDE_THRESHOLD = 800;

function selectProvider(profile) {
    if (profile.plan === 'business') return 'claude';
    if (profile.plan === 'pro') {
        return profile.credits > PRO_CLAUDE_THRESHOLD ? 'claude' : 'chatgpt';
    }
    return 'chatgpt'; // free plan, or any unrecognized plan value
}

module.exports = { selectProvider, PRO_CLAUDE_THRESHOLD };