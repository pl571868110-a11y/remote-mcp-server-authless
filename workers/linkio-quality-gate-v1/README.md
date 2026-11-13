# LINKIO Quality Gate v1 — Additive Only

Isolated Cloudflare Worker for deterministic quality checks. No D1, secrets, cron, Shopify, or live financial bindings. Public fetch always returns 404, workers.dev and preview URLs are disabled. Integration to LINKIO orchestrator is NOT enabled.

Checks: Unicode character counts, minimum and maximum lengths, normalized quote presence, URL syntax. Authenticity of source URLs is NOT verified; if policy requires verified sources, result remains UNVERIFIED. The Worker never returns the full submitted text and does not persist inputs.

Run tests: `node --test tests/*.test.mjs`.

Release gate: independent CI + synthetic RPC test through a dedicated Service Binding; no connection to production without separate approval.
