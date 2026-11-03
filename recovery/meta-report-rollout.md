# Meta report collector — prepared 2026-11-03

## Scope and readiness

This prepares a read-only `/meta-report?since=YYYY-MM-DD&until=YYYY-MM-DD` route to the existing security-fixed worker. The route integration is supplied separately as recovery/meta-report-integration.patch, tested on the security-fixed baseline. The GitHub branch starts from main because that local security commit is not published. Do not apply the patch blindly to main. It does not deploy, create a second Telegram bot, change existing cron triggers, or modify banking/Shopify routes. Start and end are inclusive; maximum range is 93 days. Responses are never cached.

The collector is tested locally. A production deployment and authenticated access from the scheduled execution environment are NOT verified. Do not describe this preparation as working unattended collection.

## Credentials and protection

Use the existing Worker secrets `META_ACCESS_TOKEN` (Meta Graph only) and `META_REVIEW_INTERNAL_TOKEN` (application key). Never copy them into source, messages, query strings, logs or a task prompt. The application request must contain `X-Meta-Report-Key` with the latter secret. Cloudflare Access credentials belong in the existing protected execution environment, separately from the application key. Do not remove or bypass Access. Without either Worker secret this route returns 503; without the application key it returns 401.

## Required rollout checks

1. Identify the active production source/version. This branch is based on security-fixed commit `4bfaab0b07f567bc1b8443040140748b5a0d4e78`, not default main. Reconcile deployment drift before deploying. Never deploy the old meta-contractor-reviewer-v1 worker wholesale.
2. Apply only the Meta changes on the verified active security baseline. Run `npm test` and `npm run type-check`. Prepare a Wrangler dry-run bundle and retain the current production version for rollback.
3. Verify Access protects the new path as well as existing protected routes. Ensure both existing Worker secrets are attached, without displaying their values. Deploy through the existing authenticated Cloudflare release path.
4. Make the protected read route callable from the scheduled execution environment, using its managed secret bindings and existing Access identity. The ChatGPT task currently has no verified binding for these credentials. A browser login on the user's Windows PC does not grant that environment access. Do not put credentials into task instructions.
5. From that environment, request 2026-10-30 through 2026-11-02. UA Nov 1–2 reference totals: spend 6010.68 UAH, purchases 9, revenue 11924 UAH. Attribution may later revise. Verify exact account/currency, pagination completion and current query time.
6. PL is `act_1310408940864798`, not the old `act_1574947413603526`. After Anna approves the PCCPolska partner request, assign the shared account to **PCC_Reviewer** in petschoice.club with View performance. Re-run until this exact account returns VERIFIED; do not substitute dashboard figures or zeroes after #200.
7. Update the existing automation “Meta Ads → Таргет | Pet” with the verified protected route/connector reference, retaining all its data-quality rules. One daily 12:00 Europe/Warsaw run includes yesterday; Mondays also previous Mon–Sun; the first also previous calendar month. Each report compares the previous equal period. No duplicate schedules.
8. Run the automation once with live data and verify Telegram delivery. Known target is `telegram:-1004415760051`, General, test messages 494/495. Other forum topics require explicit thread support; do not invent a topic ID.

## Data behavior

The collector fetches UA and PL independently. It always reconstructs Graph requests on graph.facebook.com using the allowlisted account IDs; it never follows Meta paging URLs or returns them. It uses cursor pagination, a page cap, per-request timeout and no redirects. A failed later page yields PARTIAL with null totals; a permission/network failure yields UNAVAILABLE. Upstream error text is suppressed so it cannot leak credentials. Reports use only `offsite_conversion.fb_pixel_purchase`, 7d_click + 1d_view and impression time. Overlapping purchase aliases are not added. ROAS is null for zero spend and CPA null for zero purchases. Totals retain full precision; round only for display. Currencies are never combined.

## Deduplication limit

The collector itself performs no messaging or writes. Existing automation instructions check report period keys and delivery results. Persistent atomic delivery claims are not implemented; do not claim exactly-once delivery or safe automatic resend after an uncertain send result. Before repeated manual tests, check prior messages.
