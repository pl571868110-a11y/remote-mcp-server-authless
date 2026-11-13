# LINKIO Task Recovery v1 — Additive Only

Isolated, read-only evidence classifier. **It does not resume, replay, cancel, mutate, or mark tasks as completed.** It only recommends which independent evidence to check for tasks in UNKNOWN/FAILED states.

Inputs are supplied by an authorized future caller. Receipt provenance is **not** independently verified, so presence of a receipt does NOT count as proof. `replayPermitted` is always false. No D1, secrets, cron, public route, financial bindings, or connection to production orchestrator.

Run unit tests: `node --test tests/*.test.mjs`. An independent Service Binding RPC integration test is required before wiring any consumer.
