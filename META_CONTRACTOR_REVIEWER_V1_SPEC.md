# Meta Contractor Reviewer v1

## Goal

Provide an automated, read-only weekly review of the Meta Ads contractor for PetsChoice Ukraine.

The reviewer combines:
- Meta Ads performance
- Shopify UA actual store sales
- GA4 UA tracking data
- Meta change history when available

It sends a concise management report to one allowlisted Telegram group and stores structured history in D1.

## Safety model

- Meta Ads: READ ONLY
- Shopify: READ ONLY
- GA4: READ ONLY
- D1: READ/WRITE for review history only
- Telegram: SEND only to `TELEGRAM_ALLOWED_CHAT_ID`
- No Meta campaign/budget/ad writes are implemented
- No Shopify writes are implemented

The existing repository is intentionally authless for MCP endpoints. The reviewer therefore does **not** expose Meta data as a public MCP tool. Reviewer control routes use a separate `META_REVIEW_INTERNAL_TOKEN`.

Telegram webhook access requires both:
- `X-Telegram-Bot-Api-Secret-Token`
- exact chat ID match

## Verified data identities

### Meta
- Default ad account: `act_1792664644903675`
- Account name observed during validation: `petchoice.club`
- Currency: UAH
- Runtime uses direct Meta Marketing API via `META_ACCESS_TOKEN`
- Supermetrics is not a production dependency

### Shopify UA
Existing credentials are reused:
- `SHOPIFY_SHOP`
- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`

The reviewer performs its own cursor pagination over all orders in the requested store-local date range and excludes Shopify test orders.

### GA4 UA
- Default property: `550699954`
- Override with `GA4_UA_PROPERTY_ID`
- Existing Google OAuth credentials are reused

GA4 is treated as a tracking/control source, not sales ground truth. Shopify remains the business-sales source.

## Cloudflare schedules

Wrangler installs four UTC cron triggers:

```text
0 18 * * 0
0 19 * * 0
0 6 * * 1
0 7 * * 1
```

The Worker checks `Europe/Warsaw` local time internally:
- Sunday 20:00 -> preliminary report, sent to Telegram
- Monday 08:00 -> final full Mon-Sun snapshot

The duplicate UTC hours handle CET/CEST without hardcoding DST dates.

Set `META_REVIEW_SEND_FINAL=true` only if the Monday final snapshot should also be sent to Telegram. By default it is stored only.

## Routes

All `/internal/meta-review/*` routes require either:

```http
Authorization: Bearer <META_REVIEW_INTERNAL_TOKEN>
```

or:

```http
X-Internal-Token: <META_REVIEW_INTERNAL_TOKEN>
```

Routes:

```text
GET  /internal/meta-review/health
POST /internal/meta-review/run
GET  /internal/meta-review/latest
GET  /internal/meta-review/history
POST /telegram/webhook
```

Example manual run body:

```json
{
  "start_date": "2026-09-07",
  "end_date": "2026-09-13",
  "send_telegram": false
}
```

## Telegram commands

```text
/meta_week
/meta_now
/meta_history
```

Commands are ignored for non-allowlisted chat IDs.

## Operational status

The reviewer uses three states:
- GREEN
- YELLOW
- RED

These are threshold states, not subjective ratings of the contractor.

Default thresholds:
- CPA warning: +15% WoW
- CPA critical: +30% WoW
- ROAS warning: -15% WoW
- ROAS critical: -30% WoW
- CTR warning: -15% WoW
- frequency warning: 4.0

Overrides:

```text
META_CPA_WARN_PCT
META_CPA_CRITICAL_PCT
META_ROAS_WARN_PCT
META_ROAS_CRITICAL_PCT
META_CTR_WARN_PCT
META_FREQUENCY_WARN
```

A zero-purchase campaign warning is generated when spend exceeds 1.5x the current/previous account CPA baseline with zero attributed purchases.

## D1

Migration:

```text
migrations/0001_meta_contractor_reviewer.sql
```

Binding name expected by code:

```text
META_REVIEW_DB
```

Until D1 is created and bound:
- live/manual reviews can still be generated
- Telegram can still send
- history/latest endpoints return 503
- full idempotency across retries is not guaranteed

## Required secrets / variables

```text
META_ACCESS_TOKEN
META_AD_ACCOUNT_ID                 # optional; default 1792664644903675
META_GRAPH_API_VERSION             # optional; default v24.0
META_REVIEW_INTERNAL_TOKEN

TELEGRAM_BOT_TOKEN
TELEGRAM_ALLOWED_CHAT_ID
TELEGRAM_WEBHOOK_SECRET
META_REVIEW_SEND_FINAL             # optional; default false

GA4_UA_PROPERTY_ID                 # optional; default 550699954

# already used by current Worker
SHOPIFY_SHOP
SHOPIFY_CLIENT_ID
SHOPIFY_CLIENT_SECRET
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN
```

## Direct Meta API behavior

`src/meta-ads.ts` reads:
- account summary
- campaign breakdown
- ad set breakdown
- ad breakdown
- change history (`/activities`) when the token has access

If change history is unavailable, the reviewer does not invent contractor actions; it emits an informational finding instead.

## Review output

The stored review contains:
- current Meta summary
- previous-period Meta summary
- 4-week Meta baseline
- Shopify current/previous summaries
- GA4 current/previous summaries
- campaign/adset/ad rows
- Meta change history
- evidence-backed findings
- recommendations
- contractor questions
- Telegram-formatted message

## Known deployment blockers

Before production deployment:
1. Configure a direct read-only Meta access token.
2. Create and bind the D1 database as `META_REVIEW_DB`.
3. Apply the migration.
4. Configure Telegram bot/chat/webhook secrets.
5. Run TypeScript type-check and a dry run for 2026-09-07..2026-09-13.
6. Confirm the direct Meta API attribution output is acceptably close to the validated reference data.

## Validated reference period

For 2026-09-07 through 2026-09-13, validation data showed approximately:
- Meta spend: 21,891.78 UAH
- Meta purchases: 35
- Meta purchase value: 46,717.70 UAH
- Meta ROAS: 2.134
- Meta CPA: 625.48 UAH
- Shopify orders: 59
- Shopify gross sales: 95,077 UAH
- Shopify total/net sales from Shopify analytics: 79,025.25 UAH
- GA4 transactions: 18
- GA4 purchase revenue: 25,906.45 UAH

These values are a deployment sanity check, not hardcoded business logic.
