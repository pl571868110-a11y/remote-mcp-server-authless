# Reviewer validation and activation

## Current state (2026-10-25)

PR #2 remains draft. No production deploy or merge was performed during this audit.
The configured D1 is `pcc-meta-reviewer`, ID `2e906996-8722-42a7-8dd6-266fe5df2644`, binding `META_REVIEW_DB`.
Creation and migration 0001 are recorded in the previous PR discussion. Recheck
the intended remote version and D1 migration state before activation.
Migration 0002 must be applied before enabling delivery.

## First action: unblock direct Meta access

In Meta Business Settings for `petschoice.club`, the second administrator must
approve token generation for system user `PCC_Reviewer` through `PetsChoice Finance`.
Complete Meta's device/security check through the normal account flow if requested.
Assign read access to ad account `1792664644903675` and generate a token with `ads_read`.
Do not paste the token into chat, PRs, shell history, or tracked files.

## Dry-run without Cloudflare or Telegram

Requires Node 24 and dependencies installed with `npm ci --ignore-scripts`.
Copy `.dev.vars.example` to `.dev.vars` and fill `META_ACCESS_TOKEN` privately in a local editor.
The file and its environment variants are git-ignored. The default command reads
only direct Meta account metadata and account insights; it needs no Cloudflare login,
D1, Shopify, Google, or Telegram credentials:

```powershell
npm run meta:dry-run
```

Default dates: `2026-09-07` through `2026-09-13` inclusive, in the Meta ad account timezone.
The output records account ID, currency, timezone, API version, actual metrics,
reference values and percentage deltas. Non-UAH Meta accounts fail closed.
Reference: spend 21891.78 UAH, purchases 35, purchase value 46717.70 UAH, ROAS 2.134.
The command exits 2 if purchases differ or another metric differs by more than 1%.
This is an explicit sanity-check tolerance, not a guarantee that attribution matches.
Investigate currency, account, timezone, attribution window and reporting-time settings
before accepting differences. The code uses the account/API attribution defaults;
it does not hardcode reference numbers into report generation.

For the full reviewer, fill the existing Shopify UA and Google OAuth credentials in
the same ignored file, then run:

```powershell
npm run meta:dry-run -- --full
```

Prefer `GOOGLE_UA_CLIENT_ID`, `GOOGLE_UA_CLIENT_SECRET`, and `GOOGLE_UA_REFRESH_TOKEN`
for the UA property. If any UA value is configured, all three are required; the reviewer
does not mix them with generic Google credentials. When none are configured, it uses
the complete generic `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` set.
The health response checks the same selected set. Failed dry-runs return only a safe
source label (for example `ga4_current`), without upstream error bodies or secrets.
Set `META_REVIEW_GOOGLE_SOURCE=ua` or `generic` only to deliberately select a complete
credential set; the default `auto` prefers UA when configured. This does not change
the GA4 property ID. Invalid selector values fail readiness checks.

`POST /internal/meta-review/preflight` accepts the same dates as dry-run. It probes
Meta context/current summary, Shopify current/previous cohorts, and GA4 independently,
so one failing source does not hide the others. It never saves reports or sends Telegram.
Diagnostics contain only fixed categories, HTTP status, numeric API codes, and an
allowlisted OAuth error name. `invalid_grant` requires a renewed OAuth authorization;
it does not prove whether the grant expired, was revoked, or became invalid for another reason.

Both modes perform API reads and token exchanges only. Neither mode writes D1,
sends Telegram, installs cron, uploads a Worker version, or deploys production.
Full output contains business data: keep it private. A successful Meta-only check
does not verify Shopify/GA4 credentials. Full validation is still required before production.
Shopify needs access to orders for both current and previous periods; dates older
than the default 60-day history require `read_all_orders` access.

For local HTTP validation, use `npm run dev` with the same `.dev.vars`. Send:

```http
POST /internal/meta-review/dry-run
Authorization: Bearer <local internal token>
Content-Type: application/json

{"start_date":"2026-09-07","end_date":"2026-09-13","send_telegram":false}
```

This endpoint always skips D1 and Telegram, including when a D1 binding is present.
`send_telegram:true` is rejected. `/run` is different: it saves history even with
`send_telegram:false`. Both endpoints reject invalid calendar dates, partial ranges,
ranges over 31 days, malformed JSON, and non-boolean send flags.

## Checks that do not require secrets

```powershell
npm run type-check
npm test
npm run build:check
```

GitHub Actions runs these checks on PRs and pushes. `build:check` is Wrangler's
local bundling dry-run; it does not upload or deploy. The lockfile fixes dependency resolution.
Tests use stubbed upstream APIs and actual SQLite migrations, not live account data.

## Cloudflare preflight after full validation

Do not run `wrangler deploy`, `wrangler secret put`, `wrangler secret bulk`, or merge
until the Meta token exists and full dry-run validation is accepted.
Ordinary secret writes deploy immediately; use the versions variant to stage secrets.

1. Restore the authorized Cloudflare session with `npx wrangler login`.
2. Read `npx wrangler versions list` and `npx wrangler deployments list`.
   The previously staged internal token may be on an undeployed version; do not
   assume it is available in production or a branch preview.
3. Inspect secret **names only** with `npx wrangler secret list` and verify the
   staged version bindings. Never print secret values.
4. Stage the Meta token without production deployment:
   `npx wrangler versions secret put META_ACCESS_TOKEN` (interactive secret input).
5. Apply the outstanding D1 migration with
   `npx wrangler d1 migrations apply pcc-meta-reviewer --remote`.
   This only adds a nullable delivery reservation column to the existing reviews table;
   it does not deploy Worker code or modify ads.
6. Verify `/internal/meta-review/health` against the intended version with internal auth.
   It checks credential presence and both D1 tables, including the new column;
   it does not prove upstream credentials are valid. `dryRunReady` excludes Telegram/D1.
7. Run the full HTTP dry-run on the intended version and compare output again.

The four existing UTC cron expressions are correct for Warsaw summer/winter time:
Sunday 18/19 UTC (local 20:00) and Monday 06/07 UTC (local 08:00).
`META_REVIEW_ENABLED` defaults to `false`, so scheduled invocations do nothing.
Do not enable it until full validation is accepted. With Telegram disabled, enabled
cron saves snapshots only. Sunday data is preliminary because the day is incomplete.
Monday records the completed week. The four-week baseline is descriptive; performance
alerts compare the current period with the preceding period of equal calendar length.

## Isolated Cloudflare preview validation

`src/meta-review-preview.ts` is a validation-only entry point. It exposes only
authenticated `/internal/meta-review/health`, `/internal/meta-review/preflight`, and `/internal/meta-review/dry-run`.
All other routes, including public MCP, `/run`, history and Telegram, return 404.
It has no scheduled handler and forces schedule/delivery flags off.
Never deploy this entry point to production.

Uploading secrets to Cloudflare requires explicit approval for that destination.
Use a locally generated preview internal token, separate from the production control
token. Keep the staging JSON inside ignored `.wrangler/`; never print it or commit it.
After approval, use `wrangler versions upload src/meta-review-preview.ts --keep-vars
--secrets-file <ignored staging file> --preview-alias meta-review-validation`.
This creates a version URL without moving production traffic or installing cron.
Recheck production deployments afterward. Existing Shopify/Google secrets stay on
Cloudflare; their values need not be downloaded or revealed for this validation.
If Version URLs are protected by Cloudflare Access, keep that protection in place.
An authenticated `wrangler dev src/meta-review-preview.ts --remote --ip 127.0.0.1 --port 8791`
session can validate through localhost using the same internal header. This is temporary
development execution, not a production deployment. Stop the session after testing.

Before any future production activation, reconcile this older PR with the active
Worker's code and complete binding inventory. In particular, preserve existing
non-reviewer D1 bindings and existing route authentication. An isolated reviewer
preview does not establish compatibility of a full Worker replacement.

## Optional Telegram activation

Telegram is not required for either dry-run. Delivery stays disabled by default.
Configure `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_CHAT_ID`, and
`TELEGRAM_WEBHOOK_SECRET` using `wrangler versions secret put` only when available.
Then explicitly set `META_REVIEW_TELEGRAM_ENABLED=true` in the reviewed configuration.
The webhook secret header and exact chat ID must both match.
Register `/telegram/webhook` using Telegram `setWebhook` with that secret only
after the intended version is active. No webhook is registered by this PR or CI.

Delivery requires D1. Migration 0002 provides an atomic claim before sendMessage;
parallel/retried runs cannot both reserve the same report. If the send or its response
fails, the reservation remains. Inspect Telegram and the D1 row before manually
clearing `telegram_claimed_at` for that specific report. Never clear a reservation
blindly: the message may already have arrived. This prefers avoiding duplicates over
automatic retry after ambiguous network failures; it is not exactly-once delivery.

## Metric limitations

Legacy JSON/D1 fields `grossSales`/`netSales` (`shopify_gross_sales`/`shopify_net_sales`)
remain for compatibility. They contain sums of `totalPriceSet` and `currentTotalPriceSet`
for non-test orders created in the store-local period, including cancelled/unpaid orders,
shipping and tax where applicable. They are order cohort totals, **not Shopify Analytics
gross/net sales**, not paid revenue, and not a period-refund ledger. Reports label them accordingly.
Refund totals are current lifetime refunds on that order cohort.
GA4 and Meta remain attribution/tracking sources, not proof of incremental sales.
Meta change-history access can fail independently of insights; the report explicitly
marks it unavailable, and stores history in the report JSON without inventing actions.
The separate contractor-action table is reserved for future reconciliation and is not populated.

## References

- [Cloudflare secret staging and immediate-deploy behavior](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Cloudflare version/deployment separation](https://developers.cloudflare.com/workers/versions-and-deployments/)
- [Shopify Order fields and historical-order access](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/Order)
- [Shopify quoted date-search syntax](https://shopify.dev/docs/api/usage/search-syntax)
- [Google refresh-token expiration and reauthorization](https://developers.google.com/identity/protocols/oauth2)
