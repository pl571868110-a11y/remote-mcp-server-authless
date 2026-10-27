// Pin both the Access organization and the audience of VALERA - PCC Shopify UA.
// Never accept an assertion issued for a different application or route.
export const SHOPIFY_UA_ACCESS_ISSUER = 'https://autumn-mud-4aec.cloudflareaccess.com';
export const SHOPIFY_UA_ACCESS_AUDIENCE = '9589f185ba7f92fdf5f5dabf3f5a6b679e41b1772d76c80cb022c3deeb098c82';

function decodePart(part) {
  if (!/^[A-Za-z0-9_-]+$/.test(part)) throw new Error('Invalid JWT encoding');
  const value = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(value, c => c.charCodeAt(0));
}

export async function verifyShopifyUaAccessAssertion(assertion, allowedEmails, fetchKeys = fetch, now = Date.now() / 1000, report = () => {}) {
  const reject = reason => { report(reason); return false; };
  let stage = 'assertion_decode';
  try {
    if (!allowedEmails.length) return reject('owner_allowlist_missing');
    if (!assertion) return reject('assertion_missing');
    if (assertion.length > 16384) return reject('assertion_too_large');
    const parts = assertion.split('.');
    if (parts.length !== 3) return reject('assertion_format');
    const header = JSON.parse(new TextDecoder().decode(decodePart(parts[0])));
    const claims = JSON.parse(new TextDecoder().decode(decodePart(parts[1])));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid || header.crit) return reject('assertion_algorithm');
    if (claims.iss !== SHOPIFY_UA_ACCESS_ISSUER) return reject('assertion_issuer');
    if (!Array.isArray(claims.aud) || !claims.aud.includes(SHOPIFY_UA_ACCESS_AUDIENCE)) return reject('assertion_audience');
    if (!Number.isFinite(claims.exp) || claims.exp <= now) return reject('assertion_expired');
    if (!Number.isFinite(claims.iat) || claims.iat > now + 60 || claims.iat >= claims.exp) return reject('assertion_issued_at');
    if (claims.nbf !== undefined && (!Number.isFinite(claims.nbf) || claims.nbf > now)) return reject('assertion_not_yet_valid');
    if (typeof claims.sub !== 'string' || !claims.sub || typeof claims.email !== 'string') return reject('assertion_identity_missing');
    if (!allowedEmails.includes(claims.email.toLowerCase())) return reject('assertion_identity_not_allowed');
    stage = 'signing_keys_fetch';
    // Manual mode rejects redirects via the status check and works in Workers.
    const response = await fetchKeys(SHOPIFY_UA_ACCESS_ISSUER + '/cdn-cgi/access/certs', { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (!response.ok) return reject('signing_keys_unavailable');
    stage = 'signing_keys_decode';
    const { keys } = await response.json();
    const jwk = keys?.find(k => k.kid === header.kid && k.kty === 'RSA' && (!k.alg || k.alg === 'RS256') && (!k.use || k.use === 'sig'));
    if (!jwk) return reject('signing_key_not_found');
    stage = 'signing_key_import';
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    stage = 'assertion_signature_verify';
    return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decodePart(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1])) || reject('assertion_signature');
  } catch {
    return reject(stage + '_failed');
  }
}

export async function authorizeShopifyUaAccessRequest(request, env, authorizeStatic, fetchKeys = fetch) {
  const failure = authorizeStatic(request, env);
  // Keep configuration errors, scope isolation and all other routes unchanged.
  if (!failure || failure.status !== 401) return failure;
  const url = new URL(request.url);
  if (url.hostname !== 'remote-mcp-server-authless.pl571868110.workers.dev' || url.pathname !== '/shopify-ua-mcp') return failure;
  const emails = String(env.PCC_SHOPIFY_UA_ACCESS_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const assertion = request.headers.get('Cf-Access-Jwt-Assertion');
  let reason = 'assertion_rejected';
  if (await verifyShopifyUaAccessAssertion(assertion, emails, fetchKeys, Date.now() / 1000, code => { reason = code; })) return null;
  // Fixed diagnostic codes only: never return tokens, claims, email addresses or keys.
  console.warn('PCC_SHOPIFY_UA_ACCESS_DENIED', reason);
  return new Response('Unauthorized: ' + reason, {status:401,headers:{'Cache-Control':'no-store','WWW-Authenticate':'Bearer'}});
}
