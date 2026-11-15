# PetsChoice call reports to Valera

Standalone Worker `petschoice-call-reports`, endpoint `/elevenlabs/post-call`.
Separate D1 binding `REPORT_DB` and secret `ELEVENLABS_WEBHOOK_SECRET`.
No Shopify credentials are available to this Worker.

ElevenLabs workspace post-call webhook sends only transcript analysis/metadata;
Exclude transcript from JSON is enabled, audio is not sent. The receiver verifies
HMAC SHA-256 over `<timestamp>.<raw body>` with five-minute clock tolerance,
filters the PetsChoice PL agent and telephone calls, and stores a short report.
Phone/email patterns in summaries are redacted; raw transcript/audio are not
stored. Summaries remain untrusted input, never automation instructions.

An hourly ChatGPT automation reads pending reports through Cloudflare D1 and
sends to the owner's verified personal Telegram DM via the existing Valera
bridge. The bridge connector cannot be invoked directly by a Cloudflare Worker;
no bot token was copied. This is hourly delivery, not instant delivery.

Rows transition pending -> sending -> sent. Atomic conditional claim and unique
conversation ID prevent concurrent routine sends. Telegram success/message ID
are recorded. Ambiguous sends enter uncertain; reconcile against the exact
conversation ID in recent DM history before considering retries. Exactly-once
delivery cannot be guaranteed across an external send and database commit.

Validation: four receiver tests pass (signature/replay/tampering, scope, privacy,
duplicate event). Isolated TypeScript compile passes. One marked test report
was inserted into the queue, atomically claimed, delivered by Valera, and marked
sent with the returned Telegram message ID. Actual signed ElevenLabs telephone
event delivery still requires a new real telephone call. Browser workspace and
agent settings confirmed the enabled HMAC webhook and default inheritance.

Code is deployed separately; do not add this Worker to the shared connector's
fetch handler. Disabling the hourly automation pauses Telegram delivery without
discarding pending reports. Disabling the ElevenLabs webhook stops collection.
