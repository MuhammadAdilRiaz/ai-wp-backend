# Elimeni AI templates catalog

1. Apply `template-catalog-migration.sql` using the Supabase SQL editor of your **existing** project. This creates and seeds 28 reusable prompt-and-design presets.
2. Deploy the backend with its new public GET `/api/templates` and `/api/templates/:slug` endpoints.
3. Deploy the updated frontend. Homepage templates now come from the database.
4. Template selection is free. The current `/api/chat/message` AI generation **still uses the existing credit rules**; no pricing or model-routing behavior has been changed.
5. Presets are **not** pre-exported Elementor page JSON templates. They give the AI a structured creative starting point, not a guaranteed visual clone. Actual editable Elementor template packages and deployment support would require a separate builder implementation.
6. Selection saves `pending_template_slug` and `pending_prompt` in session storage for the existing login/chat flow.
