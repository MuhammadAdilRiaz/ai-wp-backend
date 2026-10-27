# Elimeni AI Hybrid Backend — Setup

## Responsibility split
- **Claude via Anthropic Messages API** is the sole generator of website-development operations, Elementor layouts, site structures, and edit actions. This is **Claude API**, not the separate Claude Code terminal application/SDK.
- **OpenAI** prepares website content, brand/design briefs, image-generation prompts, and recommended icon names. It never authors WordPress actions for a build request.
- Ordinary chat keeps the existing modelRouter selection, including trial behavior for non-build questions.
- Builder preflight remains in place: Elementor and WooCommerce must be approved and verified before website writes.
- Manual WordPress tokens and existing Supabase tables are untouched.

## Configure in Render → Environment
```
ANTHROPIC_API_KEY=<server-only secret>
OPENAI_API_KEY=<server-only secret>
ELIMENI_CLAUDE_SONNET_MODEL=claude-sonnet-5
ELIMENI_CLAUDE_OPUS_MODEL=claude-opus-5
ELIMENI_OPENAI_CONTENT_MODEL=gpt-4.1-mini
ELIMENI_OPENAI_IMAGE_MODEL=gpt-image-2.5-flare
ELIMENI_GENERATE_HERO_IMAGE=false
ELIMENI_MEDIA_BUCKET=elimeni-generated
```
Confirm the two Claude model IDs against **your** Anthropic model list before deployment (they are overrideable). Do not paste actual keys into code or Git.

To enable **real OpenAI generated hero WebP images**, first create a dedicated **public** `elimeni-generated` bucket in Supabase Storage, grant the backend service role upload permission, and set `ELIMENI_GENERATE_HERO_IMAGE=true`. Without it, OpenAI supplies asset briefs but no image files are created. Image generation costs are **not** included in the existing per-token credits computation; set limits/pricing before production use.

## Known limitations
- Only the first relevant hero illustration is generated per request, not every section.
- OpenAI outputs icon *names* (Lucide compatible); generating/installing arbitrary SVG into WordPress is intentionally not allowed until a sanitized icon pipeline exists.
- Design brief helps Claude but does not replace native Elementor design compiler, multipage task queue, or browser visual QA.
- No full external API calls or live WordPress deployment were executed by the packaging tests.
