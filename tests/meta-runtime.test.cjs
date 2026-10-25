const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');

test('Meta account request works in the actual Workers runtime and never follows redirects', async () => {
  const bundled = await build({
    stdin: { contents: `import { metaAccountContext } from './src/meta-ads.ts'; export default { async fetch() { try { return Response.json(await metaAccountContext({ META_ACCESS_TOKEN: 'runtime-test' })); } catch { return new Response('upstream failed', { status: 502 }); } } };`, resolveDir: path.join(__dirname, '..') },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  });
  let redirect = false;
  let calls = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-07-02',
    outboundService: async request => {
      calls++;
      const url = new URL(request.url);
      assert.equal(url.origin, 'https://graph.facebook.com');
      assert.equal(url.searchParams.has('access_token'), false);
      assert.equal(request.headers.get('Authorization'), 'Bearer runtime-test');
      return redirect ? new Response(null, { status: 302, headers: { Location: 'https://unexpected.example/' } })
        : Response.json({ id: 'act_1792664644903675', currency: 'UAH', timezone_name: 'Europe/Kyiv' });
    },
  }));
  try {
    const result = await mf.dispatchFetch('https://runtime.test/');
    assert.equal(result.status, 200);
    assert.equal((await result.json()).currency, 'UAH');
    redirect = true;
    assert.equal((await mf.dispatchFetch('https://runtime.test/')).status, 502);
    assert.equal(calls, 2);
  } finally { await mf.dispose(); }
});
