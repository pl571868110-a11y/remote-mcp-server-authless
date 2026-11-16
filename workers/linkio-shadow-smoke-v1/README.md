# Shadow Audit — scheduled private workflow

Cloudflare Worker: `linkio-shadow-smoke-v1`. Cloudflare Workflow: `linkio-shadow-smoke-run-v1`, `SmokeWorkflow`.

- Schedule: `42 * * * *` (UTC, once hourly), configured through Cloudflare Workflows API on 2026-11-16.
- Default retention requested: 7 days for complete and errored instances.
- No public HTTP route, no workers.dev or preview URLs, no Cloudflare Worker cron.
- Service Binding: `READER` → `linkio-shadow-reader-v1` named entrypoint `ShadowReader`.
- Runs only fixed bounded read-only D1 queries via the Reader; no financial database, mutating operation, task replay, or status update.
- Quality checks: full available artifact length and `rules-json` structure (not source factual authenticity), preserve upstream authoritative failure.
- Recovery: classify stored UNKNOWN stages; does not prove external executor completion and never authorizes retries.
- Real Cloudflare E2E acceptance: `shadow_citations_e2e_20261116_v1`, 20 quality checks + 17 UNKNOWN, `complete`, `success=true`.
- Changing the schedule or connecting to existing production orchestration requires a separate review.

Cloudflare Workflows API scheduling example (documentation only, **do not run during CI**): PUT /accounts/{account_id}/workflows/linkio-shadow-smoke-run-v1, body `{"script_name":"linkio-shadow-smoke-v1","class_name":"SmokeWorkflow","schedules":[{"cron":"42 * * * *"}]}`.
