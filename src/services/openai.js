const OpenAI = require('openai');
const { buildSystemPrompt } = require('./systemPrompt');
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// Main chat function — sends messages to GPT and returns structured response
// Mirrors chatWithClaude() exactly so chat.js can call either interchangeably
// history: array of { role: 'user'|'assistant', content: string }
// ─────────────────────────────────────────────────────────────────────────────
async function chatWithGPT(history, wpContext) {
    const systemPrompt = buildSystemPrompt(wpContext);

    const response = await client.chat.completions.create({
        model:       'gpt-4.1',
        max_tokens:  8000,
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