# Elimeni AI — OpenAI + Claude WordPress connector

This release preserves the existing `modelRouter.js`, OpenAI service, Claude service,
WordPress manual-token connection and SaaS database schema. No SQL migration required.

## Install
Deploy this backend ZIP over your existing backend; retain server environment variables.
Install the companion `Elimeni AI Connector` WordPress plugin v1.2.0 and connect with
its manually generated token as before. HTTPS is recommended; **do not expose tokens**.

## Provider-neutral API (all requests use existing SaaS bearer auth)

- `GET /api/sites/connector/capabilities` — supported connector operations.
- `GET /api/sites/:id/inspect` — read-only WordPress inspection and classification.
- `POST /api/sites/:id/connector-action` — requires `{ "confirm": true, "action": { "action": "install_plugin", "slug": "elementor" } }`. Use only after displaying the exact change to the user and receiving affirmative approval.

The existing `/api/chat/message` still selects OpenAI or Claude using the original
routing rules. It now invokes the same provider-neutral connector for any generated
WordPress actions. Sensitive AI-proposed actions are returned as needing confirmation
rather than automatically executed.

## WordPress plugin currently supports

Current: page create/update, Elementor JSON pages, media URL uploads, menus,
homepage, site settings, theme/plugin inspection and approved WordPress.org slug
installation/activation (where permissions and environment allow it).

Not yet implemented: WordPress Application Password onboarding, complete WooCommerce
product management, builder-native WPBakery/Divi content generation, custom Elimeni
AI theme ZIP deployment, or an approval modal in the SaaS frontend.

## Production security caveats

- Existing backend `sites.site_token` is stored as before; encrypt at rest before
  production use. Never include it in logs or browser URLs.
- The WordPress plugin's legacy chat iframe currently puts a token in its URL.
  This is a **known security issue**; disable embedded chat until using a secure
  session exchange instead, or use the SaaS's standalone chat UI.
- On the WordPress plugin, management actions rely on its shared token rather than
  scoped capability credentials. Limit site access, restrict the allowlists and
  review site backups and customer approval before production use.
- This backend endpoint's `confirm:true` is a confirmation assertion from an
  authenticated client, not proof of an independently verified human approval.
  Implement server-side approval records before production high-impact actions.
- Site freshness classification is heuristic. Never auto-replace existing sites.
- WordPress live installation, provider API calls and E2E checks are untested here.
