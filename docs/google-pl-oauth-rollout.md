# Poland OAuth preparation — 2026-11-10

Status: prepared for review, not deployed. No live consent, token replacement, Ads/Shopify writes or campaign launches performed.

## Confirmed mapping

- Poland Google identity: petschoiceclub.pl@gmail.com (Merchant administrator confirmed in owner screenshot).
- Ads 3206813262: linked actively to Merchant 5772972099; keep this fixed ID.
- Ads 1582377809: separate paused legacy PMax, disconnected Merchant; Simprosys manager 3033874770. Do not relink, remove managers or change this ID in this patch.
- GA4 463531572 and LINKIO Search Console work through the existing shared OAuth credential.
- Ads 403 / Merchant 401 remain unresolved. Reauthorization is a proposed repair, not proof of the root cause. OAuth subject for the old token has not been established.

## Prepared behavior

- Ads and Merchant use only GOOGLE_PL_REFRESH_TOKEN; absence produces GOOGLE_PL_CREDENTIALS_NOT_CONFIGURED, with no fallback to GOOGLE_REFRESH_TOKEN.
- GA4, Diagnostics, GSC and existing OAuth routes retain their current credentials and behavior. The PL callback is selected by a distinct signed state prefix on the existing registered callback URI.
- PL OAuth reuses GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET for the existing PCC Worker OAuth client. It adds a separate user grant/token, not another Cloud client.
- New start route: /oauth/google/pl/start. GET shows a setup form; POST requires a separate temporary GOOGLE_PL_OAUTH_SETUP_TOKEN (minimum 32 characters), same Origin and bounded body size.
- HMAC state, ten minute lifetime, PKCE S256, HttpOnly/Secure/SameSite cookie; callback verifies the Google userinfo email and email_verified. login_hint alone is never trusted.
- Consent requests openid/email, adwords, content. The adwords/content Google scopes are broad; this patch exposes no write tool or generic Google proxy. It does not expand the existing fixed account IDs.
- The verified callback shows the new refresh token only in the operator browser for direct entry in Cloudflare Secrets as GOOGLE_PL_REFRESH_TOKEN. It never stores it automatically or emits raw Google errors. Response is no-store, no-referrer, script-free and frame-blocked. Do not screenshot/share the callback or put credentials in git, tickets or chat.

## Release gate

This PR is based on repository main 1c781b5. Production has additional modules/configuration absent from this main branch (for example separate MCP credential guards, UA and CFO functionality). **Do not deploy repository main or this branch wholesale.** Reconcile the deployed source with the repository and carry this focused diff onto that release source first. Re-run MCP authorization/route regression tests there. This preparation does not claim those production regressions have passed.

## Subsequent installation and operator login

1. Review and reconcile production source as above. Preserve secrets, bindings, routes, schedules, Access and other integrations.
2. Confirm the PCC Worker OAuth client already registers the exact existing callback URI in src/google-pl-oauth.ts. Confirm consent permits openid/email/adwords/content. No GSC scope is added to PL consent.
3. Create a random temporary GOOGLE_PL_OAUTH_SETUP_TOKEN in a secure operator channel. Store it only as a new Worker secret. Do not reuse the MCP read credential.
4. Deploy the reconciled release in an agreed window. Ads/Merchant deliberately fail closed until the new secret is installed; they are already denied in the observed baseline. Keep existing GOOGLE_REFRESH_TOKEN unchanged.
5. Open the new setup route on the fixed workers.dev host, enter the temporary setup code, and consent as petschoiceclub.pl@gmail.com. After account validation, copy the value directly to GOOGLE_PL_REFRESH_TOKEN in Cloudflare Secrets. Close the callback tab, remove GOOGLE_PL_OAUTH_SETUP_TOKEN to disable setup, then verify reads.
6. Read-only smoke: Ads campaign list + dated summary for 3206813262, one Merchant product for 5772972099, GA4, Diagnostics and GSC siteOwner for linkio.one. If Ads still denies access, diagnose the authenticated user/account permissions; do not insert the Simprosys manager ID speculatively.
7. Do not enable advertising or change budgets. Token issuance alone does not establish account access; successful API reads do.

## Rollback

Revert only this focused code diff on the reconciled release. Keep the original shared Google secret intact. The PL token may remain unused until a separately approved cleanup; do not revoke a Google grant blindly, since the same OAuth client is used for other connections. This draft performs no rollback or production write.

## Validation

Run node --test test/google-pl-oauth.test.ts. All Google responses in tests are synthetic; no model calls, Google grants or external mutations occur.

Observed validation on 2026-11-10: 12 tests passed; git diff --check passed; Wrangler dry-run bundled successfully (no deployment). Full tsc --noEmit reports four existing TS2322 errors in src/index.ts at lines 220, 281, 504, 597. The same errors were independently reproduced on the unmodified main snapshot with the same dependencies; no new TypeScript diagnostics were introduced. A green full-project type check is not claimed.

Reference: https://developers.google.com/identity/protocols/oauth2/web-server
