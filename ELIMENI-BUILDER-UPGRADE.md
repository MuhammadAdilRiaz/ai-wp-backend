# Elimeni AI — incremental builder backend upgrade

Existing OpenAI / Claude provider selection, API model IDs, manual WordPress token header, Supabase schema, billing, chat routes and endpoint contracts have not been intentionally changed.

## New modules
- `src/services/builder/designSystem.js`: provider-neutral design/content instructions.
- `src/services/builder/actionWorkflow.js`: safe sequential execution, action limit, page/menu output references.
- `src/services/builder/completionReport.js`: reply based on actual WordPress results, with direct links and failures.
- `src/services/quality/pageValidator.js`: basic Elementor JSON structure validation, not screenshot QA.

## Edited
- `src/services/systemPrompt.js`: adds website production guidance, content writing, brand-aware design and action references.
- `src/routes/chat.js`: uses workflow executor and persists/returns factual completion message.

## Known limitations / next required work
- This is **not** a Lovable-equivalent full website builder yet. Fully reliable multipage creation requires a persisted background job/queue and page-by-page planning/execution; single LLM response has token limits.
- Real image search/generation/upload/attribution pipeline is not implemented. Existing `upload_media_from_url` is still available and must receive legitimate, allowed URLs.
- Browser preview screenshot capture, desktop/mobile rendering comparisons, interaction tests, and automatic redesign are **not implemented**.
- WordPress connector/plugin must be capable of each requested action. New result refs use `@page:slug` and `@menu:menu-name` only when earlier actions in the same response succeeded.
- Install theme/plugin remains confirmation-gated by existing `wordpressConnector.js`.
- Existing billing is per chat message and not reconciled per individual website-generation action. Validate metering before commercial rollout.
- No live API, Supabase, WordPress, or Next.js end-to-end tests run.

## Test
`node tests/builder-smoke.test.js`

## Rollout
Deploy to staging first. Test user authentication, token connection, both AI providers, credits, one page creation, multipage prompt, homepage assignment and menu refs. Roll back if results differ.
