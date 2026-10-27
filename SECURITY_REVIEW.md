# MCP authorization review

An independent agent reviewed both draft authorization changes without modifying files or calling live business services. A second review verified the fixes and the CI design.

## Confirmed findings fixed

- **High: credential disclosure to READ callers.** The legacy `/mcp` server registered `novapay_test_auth`, called NovaPay `UserAuthenticationJWT`, and returned the raw SOAP authentication response. The tool is removed from the READ server, including its upstream request code.
- **Medium: billable generation on a READ surface.** The legacy server registered `claude_ask`. The tool and its upstream request code are removed from the READ server.

Neither capability is moved to another route in this release. Existing Shopify UA/PL tools use fixed GraphQL queries; Google tools use read/report/inspection operations. An HTTP POST used for GraphQL, reports, or token exchange does not itself make a business operation a write.

## Regression evidence

`npm run test:boundary` runs the actual dry-run Worker bundle in local workerd. It verifies exact `tools/list` surfaces for every implemented READ route, a permitted calculation, rejection of credential issuance, generation and write tool calls, rejection of all READ tokens at the reserved write route, and rejection of unsupported paths. All external business-service requests are blocked and counted; the final count must be zero. No live credentials or financial fixtures are used.

When the JWT module is present, the same test generates a synthetic RSA key and Access assertion, serves a mock pinned JWKS, and verifies that the signed assertion grants only UA READ tools. It also rejects the assertion on legacy, PL and write routes. Unit tests cover wrong signature, issuer, audience, identity, time claims and unavailable/redirected JWKS.

CI performs a clean lockfile install, TypeScript, unit tests, dry-run build, workerd boundary tests, dependency audit at the low threshold, publication-path checks, and redacted Gitleaks scans of the complete tracked tree and introduced commits. The workflow uses read-only repository permissions, no persisted checkout credentials and no deployment credentials.

## Limits and open gates

F-01 remains **OPEN** until specific affected tokens and their consumers are confirmed and a separately authorized controlled rotation is completed. JWT validation does not revoke existing credentials. No production deployment, merge, credential rotation or live NovaPay/Shopify mutation is part of this review.

Tests establish the candidate's local authorization behavior. They do not prove production or preview Access coverage, independently attest upstream services, or semantically classify financial data in every possible JSON/PDF. Review publication file lists in addition to automated secret and path checks.
