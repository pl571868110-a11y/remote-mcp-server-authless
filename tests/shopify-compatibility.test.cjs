const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

test('Shopify PL preserves deployed admin-token access and client-credentials fallback', async () => {
  const bundled = await build({
    stdin: { contents: `import { handleShopifyRequest } from './src/shopify-pl.ts'; export default { async fetch(request, env, ctx) { return await handleShopifyRequest(request, env, ctx) ?? new Response('Not found', { status: 404 }); } };`, resolveDir: path.join(__dirname, '..') },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
    conditions: ['workerd', 'worker', 'browser'],
    external: ['node:*'],
  });
  for (const directToken of [true, false]) {
    let exchanges = 0;
    let queries = 0;
    const mf = new Miniflare(convertV4MiniflareOptions({
      modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-07-02',
      compatibilityFlags: ['nodejs_compat'],
      bindings: { SHOPIFY_PL_SHOP: 'compat.myshopify.com', ...(directToken
        ? { SHOPIFY_PL_ADMIN_TOKEN: 'test-admin-token' }
        : { SHOPIFY_PL_CLIENT_ID: 'test-client', SHOPIFY_PL_CLIENT_SECRET: 'test-secret' }) },
      outboundService: async request => {
        const url = new URL(request.url);
        assert.equal(url.hostname, 'compat.myshopify.com');
        if (url.pathname === '/admin/oauth/access_token') {
          exchanges++;
          assert.equal(directToken, false, 'direct admin token must not require token exchange');
          const form = new URLSearchParams(await request.text());
          assert.equal(form.get('grant_type'), 'client_credentials');
          return Response.json({ access_token: 'test-exchanged-token', expires_in: 86400 });
        }
        queries++;
        assert.equal(url.pathname, '/admin/api/2026-07/graphql.json');
        assert.equal(request.headers.get('X-Shopify-Access-Token'), directToken ? 'test-admin-token' : 'test-exchanged-token');
        return Response.json({ data: { shop: { name: 'Compatibility store', myshopifyDomain: 'compat.myshopify.com', currencyCode: 'PLN' } } });
      },
    }));
    try {
      const response = await mf.dispatchFetch('https://compat.test/shopify-pl-mcp', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'shopify_pl_store_identity', arguments: {} } }),
      });
      const body = await response.text();
      assert.equal(response.status, 200, body);
      assert.match(body, /Compatibility store/);
      assert.doesNotMatch(body, /"isError":true/);
      assert.equal(queries, 1);
      assert.equal(exchanges, directToken ? 0 : 1);
    } finally { await mf.dispose(); }
  }
});
