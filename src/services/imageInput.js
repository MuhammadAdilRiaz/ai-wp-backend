// Normalize user-supplied screenshot/reference images for OpenAI and Anthropic.
// Accept HTTPS image URLs or base64 data URLs; never fetch arbitrary user URLs here.
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

function normalizeImages(body = {}) {
    const supplied = body.images ?? body.image ?? body.image_url ?? body.image_base64 ?? [];
    const images = Array.isArray(supplied) ? supplied : [supplied];
    if (images.length > 4) throw new Error('Maximum 4 reference images per message.');
    return images.map(value => {
        const raw = typeof value === 'string' ? value :
            (value && typeof value === 'object' ? (value.url || value.data_url || value.base64 || value.image_url) : null);
        if (typeof raw !== 'string') throw new Error('Each image must be a URL or base64 data URL.');
        if (/^https:\/\//i.test(raw)) {
            const url = new URL(raw);
            if (url.username || url.password) throw new Error('Image URLs cannot contain credentials.');
            return { url: raw, type: 'url' };
        }
        const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(raw);
        if (!match || !ALLOWED_TYPES.has(match[1].toLowerCase())) {
            throw new Error('Images must be HTTPS URLs or PNG/JPEG/WEBP/GIF base64 data URLs.');
        }
        const bytes = Buffer.from(match[2], 'base64');
        if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('Image must be 8 MB or smaller.');
        if (bytes.toString('base64').replace(/=+$/, '') !== match[2].replace(/=+$/, '')) {
            throw new Error('Invalid image base64.');
        }
        return { url: `data:${match[1].toLowerCase()};base64,${match[2]}`, type: 'base64', mediaType: match[1].toLowerCase(), data: match[2] };
    });
}

function attachImagesToLastUserMessage(history, images, provider) {
    if (!images.length) return history;
    const result = history.map(m => ({ ...m }));
    const index = result.length - 1;
    if (index < 0 || result[index].role !== 'user') throw new Error('No user message to attach images to.');
    const text = result[index].content || '';
    if (provider === 'openai') {
        result[index].content = [
            { type: 'text', text: text || 'Analyze the attached reference image.' },
            ...images.map(image => ({ type: 'image_url', image_url: { url: image.url, detail: 'high' } })),
        ];
    } else {
        // Anthropic accepts inline base64 images; HTTPS URLs can be passed with URL source.
        result[index].content = [
            { type: 'text', text: text || 'Analyze the attached reference image.' },
            ...images.map(image => ({
                type: 'image',
                source: image.type === 'base64'
                    ? { type: 'base64', media_type: image.mediaType, data: image.data }
                    : { type: 'url', url: image.url },
            })),
        ];
    }
    return result;
}
module.exports = { normalizeImages, attachImagesToLastUserMessage };
