const OpenAI = require('openai');
const { buildSystemPrompt } = require('./systemPrompt');
// Built on first use, not at import time. The OpenAI SDK throws from its
// constructor when OPENAI_API_KEY is missing, so a top-level `new OpenAI(...)`
// takes the ENTIRE backend down on boot the moment that one env var is absent
// — even for users who never touch the Luna tier. Lazy is the difference
// between "GPT is unavailable" and "nothing works".
let client = null;
function getClient() {
    if (!process.env.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not configured on the server.');
    }
    if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    return client;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main chat function — sends messages to GPT and returns structured response
// Mirrors chatWithClaude() exactly so chat.js can call either interchangeably
// history: array of { role: 'user'|'assistant', content: string }
// ─────────────────────────────────────────────────────────────────────────────
async function chatWithGPT(history, wpContext) {
    const systemPrompt = buildSystemPrompt(wpContext);

    const response = await getClient().chat.completions.create({
        model:       'gpt-5.6-luna', // cheap/high-volume tier — matches the "simple prompt, no file" package
        // Newer OpenAI models reject 'max_tokens' outright (400
        // unsupported_parameter). 'max_completion_tokens' is the replacement.
        max_completion_tokens: 8000,
        messages: [
            { role: 'system', content: systemPrompt },
            ...history,
        ],
    });

    const rawText = response.choices[0].message.content || '';

    // Parse the JSON response from GPT — same parsing logic as Claude
    try {
        // Strip markdown code fences if GPT accidentally adds them
        const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed  = JSON.parse(cleaned);
        return { success: true, parsed, raw: rawText };
    } catch (err) {
        // If GPT returns plain text (for questions), wrap it
        return {
            success: true,
            parsed: { message: rawText, actions: [], done: true },
            raw: rawText,
        };
    }
}

module.exports = { chatWithGPT };