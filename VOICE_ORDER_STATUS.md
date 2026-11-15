# PetsChoice PL voice order status

POST `/voice/pl/order-status`, read-only Shopify Poland web orders only.
Inputs: numeric `order_number`, checkout `email`, and `caller_phone` injected by
ElevenLabs from `system__caller_id` (never an LLM-generated/spoken phone number).
Exact order name, email and order/shipping phone must match. Caller ID is an
additional check, not strong identity proof: telephony caller ID can be spoofed.
No addresses, customer profiles, line items, payment details or order-status URLs
are returned. Only payment/fulfillment status, cancellation flag, shipment status
and carrier/tracking number are returned. This endpoint cannot modify orders.

## Access

- Dedicated Cloudflare Access self-hosted app protects only this exact path.
- Only the dedicated ElevenLabs service token is permitted (non-identity policy).
- The same secret is checked independently by the Worker as a Bearer token.
- Client ID, Client Secret and Bearer headers reference ElevenLabs workspace
  secrets; never put their values in prompts, tool descriptions, git, or logs.
- Worker requires `VOICE_PL_ENABLED=true`, `VOICE_PL_TOKEN` and `VOICE_PL_LIMITER`.
  Missing configuration fails closed with 503.
- Rate limit binding: namespace `15112026`, 10/60s per global/caller/order key.
  Cloudflare rate-limit counters are location-scoped, not globally transactional.
  Caller/order keys are SHA-256 digests; no input/customer values are logged here.
- No match, wrong identity, missing identity and non-web order all yield the same
  `not_verified` result. API failures return generic `unavailable` without details.

## Agent behavior

Ask for order number, then checkout email, at most one question at a time.
Confirm transcription of the email. Use `get_petschoice_pl_order_status` only
after both are supplied. Never substitute a spoken phone number for caller ID.
Only a `verified` result permits reading status/tracking. On `not_verified`,
`rate_limited` or `unavailable`, do not confirm that an order exists; direct the
customer to support@petschoiceclub.pl. Do not infer delivery from FULFILLED;
delivery claims require the shipment's returned status. Do not promise an ETA.
Callers without an order-associated phone or a usable caller ID must use support.

## Validation and deployment

- 9 synthetic security/behavior tests: `node --experimental-strip-types --test tests/voice-order-status.test.ts`.
- Shopify PL validated and executed the exact query using an impossible order
  number; empty result confirmed, without reading customer PII.
- Wrangler dry-run succeeds. Type-check reports the same four pre-existing
  `string | undefined` errors in src/index.ts on this branch and clean main.
- Live deployment was patched additively against the then-current downloaded
  bundle using content-only API, preserving its newer Google changes, modules,
  compatibility settings and all existing bindings. Do not overwrite production
  using this repository's entire bundle without reconciling that drift first.
- Initial content deployment: 41181848c0f4405e84495f55a61e3071.
- Follow-up token-refresh deployment: 89e625f21f0144a29cfcb0f00b33e853.
- Shopify fixed token returned 401 during live validation. The PL helper now
  retries once with the configured client-credentials flow; store identity then
  passed again. No Shopify write scopes or mutations were introduced.
- Access app: e0511220-0953-4465-9330-191ff4ef8983.
- Access policy: b9971273-340b-4c0f-9dd7-6173c7fbd03e.
- Tool: tool_3601m7f8xe3xedb8m2t858yd6kyz.
- ElevenLabs published the updated agent prompt and attached tool on 2026-11-15.
  The publish control became disabled after completion.
- Real (not mocked) ElevenLabs Preview call returned `status: not_verified` in
  conversation conv_8401m7f926khe3ya49460vcwh0w9; tool execution succeeded and the
  agent disclosed no order details. Preview had no telephone caller ID. The
  `system__` namespace cannot be overridden by preview client variables.
- A successful lookup of a real order over a telephone call remains unverified;
  test from the phone recorded on that order, with its order number and email.

Rollback access by setting `VOICE_PL_ENABLED=false` and detaching the tool from
the agent. Keep the Access app protecting the path. No need to delete data.
