import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.resolve('wrangler/package.json'));
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const bindings = {
  PCC_MCP_READ_TOKEN: 'test-legacy', PCC_MCP_WRITE_TOKEN: 'test-write',
  PCC_GOOGLE_PL_READ_TOKEN: 'test-google', PCC_SHOPIFY_PL_READ_TOKEN: 'test-shopify-pl',
  PCC_CFO_READ_TOKEN: 'test-cfo',
};
let outbound = 0;
let jwksRequests = 0;
const jwtEnabled = existsSync('src/shopify-ua-access-auth.mjs');
let assertion, jwk, issuer;
if (jwtEnabled) {
  const access = await import('../src/shopify-ua-access-auth.mjs');
  issuer = access.SHOPIFY_UA_ACCESS_ISSUER;
  const pair = await crypto.subtle.generateKey({name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256'}, true, ['sign', 'verify']);
  jwk = {...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'synthetic-key', alg: 'RS256'};
  const now = Math.floor(Date.now() / 1000);
  const part = obj => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const message = part({alg: 'RS256', kid: jwk.kid}) + '.' + part({iss: issuer, aud: [access.SHOPIFY_UA_ACCESS_AUDIENCE], sub: 'synthetic-owner', email: 'owner@example.test', iat: now - 5, exp: now + 300});
  assertion = message + '.' + Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(message))).toString('base64url');
  bindings.PCC_SHOPIFY_UA_ACCESS_EMAILS = 'owner@example.test';
}
const options = convertV4MiniflareOptions({
  host: '127.0.0.1', port: 0, cf: false,
  workers: [{ name: 'read-boundary', modules: true, scriptPath: resolve('.build/worker.js'),
    compatibilityDate: '2026-07-02', compatibilityFlags: ['nodejs_compat'], bindings,
    outboundService: request => {
      if (jwtEnabled && request.url === issuer + '/cdn-cgi/access/certs') {
        jwksRequests++;
        return Response.json({keys: [jwk]});
      }
      outbound++;
      return new Response('Network disabled', {status: 503});
    },
  }],
});
options.telemetry = {enabled: false};
const mf = new Miniflare(options);
const routes = [
  ['/mcp', 'test-legacy', ['add', 'calculate', 'monobank_balance', 'monobank_transactions', 'novaposhta_status', 'privatbank_balance', 'privatbank_transactions']],
  ['/shopify-ua-mcp', 'test-legacy', ['shopify_store_identity', 'shopify_get_order', 'shopify_ua_orders_between']],
  ['/shopify-pl-mcp', 'test-shopify-pl', ['shopify_pl_store_identity', 'shopify_pl_order_by_id', 'shopify_pl_orders_between']],
  ['/google-mcp', 'test-google', ['google_ads_campaigns', 'google_ads_summary', 'ga4_purchase_report', 'ga4_purchase_transactions', 'ga4_event_report', 'merchant_products', 'search_console_access', 'search_console_performance', 'search_console_sitemaps', 'search_console_inspect_url']],
  ['/google-diagnostics-mcp', 'test-google', ['ga4_event_timeline', 'ga4_event_hour']],
];
const prohibited = ['claude_ask', 'novapay_test_auth', 'shopify_mark_order_paid', 'shopify_order_mark_paid', 'shopify_cancel_order', 'orderMarkAsPaid', 'mutation', 'google_ads_mutate'];
function rpc(path, token, method, params = {}) {
  return new Request('https://local.test' + path, {method: 'POST', headers: {
    Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
  }, body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params})});
}
async function body(response) {
  const text = await response.text();
  return JSON.parse(text.trimStart().startsWith('{') ? text : text.split(/\r?\n/).filter(x => x.startsWith('data: ')).map(x => x.slice(6)).join('\n'));
}
try {
  await mf.ready;
  const worker = await mf.getWorker();
  for (const [path, token, names] of routes) {
    const listed = await body(await worker.fetch(rpc(path, token, 'tools/list')));
    assert.deepEqual(listed.result.tools.map(t => t.name).sort(), [...names].sort(), path + ' exact read tool surface');
    for (const name of prohibited) {
      const result = await body(await worker.fetch(rpc(path, token, 'tools/call', {name, arguments: {prompt: 'test', order_id: '123'}})));
      assert.ok(result.error || result.result?.isError, path + ' must reject ' + name);
    }
    for (const readToken of ['test-legacy', 'test-google', 'test-shopify-pl', 'test-cfo']) {
      assert.equal((await worker.fetch(rpc('/shopify-ua-write-mcp', readToken, 'tools/call', {name: 'shopify_mark_order_paid', arguments: {}}))).status, 401);
    }
  }
  for (const path of ['/mcp/', '/unknown-mcp', '/sse', '/messages']) {
    assert.equal((await worker.fetch(rpc(path, 'test-legacy', 'tools/list'))).status, 404);
  }
  // A scope-valid WRITE token does not create an endpoint absent from this release.
  assert.equal((await worker.fetch(rpc('/shopify-ua-write-mcp', 'test-write', 'tools/list'))).status, 404);
  if (jwtEnabled) {
    const signed = (path, method, params) => {
      const request = rpc(path, 'wrong', method, params);
      const url = new URL(request.url);
      url.hostname = 'remote-mcp-server-authless.pl571868110.workers.dev';
      const result = new Request(url, request);
      result.headers.set('Cf-Access-Jwt-Assertion', assertion);
      return result;
    };
    const listed = await body(await worker.fetch(signed('/shopify-ua-mcp', 'tools/list')));
    assert.deepEqual(listed.result.tools.map(t => t.name).sort(), [...routes[1][2]].sort());
    for (const name of prohibited) {
      const result = await body(await worker.fetch(signed('/shopify-ua-mcp', 'tools/call', {name, arguments: {}})));
      assert.ok(result.error || result.result?.isError, 'JWT READ must reject ' + name);
    }
    for (const path of ['/mcp', '/shopify-pl-mcp', '/shopify-ua-write-mcp']) {
      assert.equal((await worker.fetch(signed(path, 'tools/list'))).status, 401);
    }
    assert.ok(jwksRequests > 0, 'JWT integration must really fetch the synthetic signing key');
    console.log('PASS: signed Access assertion grants only UA READ tools; other scopes denied');
  }
  assert.equal(outbound, 0, 'denied calls must not reach any external service');
  console.log('PASS: exact READ surfaces, forbidden tools/call, cross-scope write rejection; zero outbound requests');
} finally {
  await mf.dispose();
}
