require('../scripts/register-ts.cjs');
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { handleMetaReviewRequest: handle, handleMetaReviewScheduled: scheduled, validReviewRange } = require('../src/meta-reviewer.ts');
const { metaAccountSummary } = require('../src/meta-ads.ts');
const originalFetch = global.fetch;
afterEach(() => { global.fetch = originalFetch; });
const env = {
  META_REVIEW_INTERNAL_TOKEN: 'internal-test', META_ACCESS_TOKEN: 'meta-test',
  SHOPIFY_SHOP: 'test.myshopify.com', SHOPIFY_CLIENT_ID: 'id', SHOPIFY_CLIENT_SECRET: 'secret',
  GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret', GOOGLE_REFRESH_TOKEN: 'refresh',
};
const request = (route, body, headers = {}) => new Request(`https://test/internal/meta-review/${route}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { Authorization: 'Bearer internal-test', ...headers },
  ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
});
const range = { start_date: '2026-09-07', end_date: '2026-09-13' };
const response = data => new Response(JSON.stringify(data));
function mockApis() {
  const calls = [];
  global.fetch = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url, init });
    if (url.hostname === 'graph.facebook.com') {
      assert.equal(init.method, 'GET');
      assert.equal(init.headers.Authorization, 'Bearer meta-test');
      assert.equal(url.searchParams.has('access_token'), false);
      if (url.pathname.endsWith('/activities')) return new Response('{"error":{"code":10}}', { status: 403 });
      if (!url.pathname.endsWith('/insights')) return response({ id: 'act_1792664644903675', currency: 'UAH', timezone_name: 'Europe/Kyiv' });
      return response({ data: [{ account_id: '1792664644903675', spend: '21891.78', impressions: '100000', clicks: '1000', ctr: '1', cpm: '218.9178', cpc: '21.89178', frequency: '2',
        actions: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '35' }, { action_type: 'purchase', value: '35' }],
        action_values: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: '46717.70' }, { action_type: 'purchase', value: '46717.70' }],
      }] });
    }
    if (url.hostname === 'oauth2.googleapis.com') return response({ access_token: 'google-test' });
    if (url.hostname === 'analyticsdata.googleapis.com') return response({ rows: [{ metricValues: [{ value: '18' }, { value: '25906.45' }, { value: '100' }] }] });
    if (url.hostname === 'test.myshopify.com') {
      if (url.pathname.endsWith('/access_token')) return response({ access_token: 'shop-test' });
      const { query, variables } = JSON.parse(init.body);
      assert.ok(!query.includes('mutation'));
      if (query.includes('ReviewShopContext')) return response({ data: { shop: { currencyCode: 'UAH', ianaTimezone: 'Europe/Kyiv' } } });
      assert.match(variables.query, /^created_at:>='2026-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z' created_at:<'2026-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z'$/);
      const node = { id: 'order', test: false, cancelledAt: null, totalPriceSet: { shopMoney: { amount: '100' } }, currentTotalPriceSet: { shopMoney: { amount: '90' } }, totalRefundedSet: { shopMoney: { amount: '10' } } };
      return response({ data: { orders: { nodes: [node, { ...node, test: true }], pageInfo: { hasNextPage: !variables.after, endCursor: variables.after ? null : 'next' } } } });
    }
    if (url.hostname === 'api.telegram.org') return response({ ok: true });
    throw new Error(`Unexpected host ${url.hostname}`);
  };
  return calls;
}
function database() {
  const db = new DatabaseSync(':memory:');
  for (const file of ['0001_meta_contractor_reviewer.sql', '0002_meta_telegram_claim.sql']) db.exec(fs.readFileSync(path.join(__dirname, '../migrations', file), 'utf8'));
  return { db, prepare(sql) {
    let args = [];
    const statement = db.prepare(sql);
    return { bind(...values) { args = values; return this; }, async first() { return statement.get(...args) || null; }, async all() { return { results: statement.all(...args) }; }, async run() { return { success: true, meta: { changes: Number(statement.run(...args).changes) } }; } };
  } };
}

test('internal routes fail closed, require Bearer scheme, accept explicit token header', async () => {
  for (const authorization of ['', 'internal-test', 'Bearer wrong']) assert.equal((await handle(request('health', undefined, { Authorization: authorization }), env)).status, 401);
  assert.equal((await handle(request('health'), {})).status, 401);
  assert.equal((await handle(request('health', undefined, { Authorization: '', 'X-Internal-Token': 'internal-test' }), env)).status, 200);
  assert.equal(await handle(new Request('https://test/mcp'), env), null);
});
test('health distinguishes missing credentials and missing schema', async () => {
  const health = await (await handle(request('health'), { META_REVIEW_INTERNAL_TOKEN: 'internal-test' })).json();
  assert.equal(health.ok, false);
  assert.equal(health.dryRunReady, false);
  const db = database();
  const ready = await (await handle(request('health'), { ...env, META_REVIEW_DB: db })).json();
  assert.equal(ready.d1Schema, true);
  assert.equal(ready.telegramEnabled, false);
  db.db.close();
});
test('invalid JSON, dates, partial dates and string booleans fail before API calls', async () => {
  global.fetch = () => assert.fail('must not fetch');
  for (const body of ['{bad', 'null', '[]', { start_date: '2026-09-07' }, { ...range, end_date: '2026-02-30' }, { ...range, end_date: '2026-10-25' }, { ...range, send_telegram: 'false' }, { ...range, send_telegram: true }]) {
    assert.equal((await handle(request('dry-run', body), env)).status, 400);
  }
  assert.equal(validReviewRange('2024-02-29', '2024-02-29'), true);
  assert.equal(validReviewRange('2026-02-29', '2026-03-01'), false);
  assert.equal(validReviewRange('2026-09-13', '2026-09-07'), false);
});
test('missing Meta token returns actionable 503 without upstream calls', async () => {
  global.fetch = () => assert.fail('must not fetch');
  assert.equal((await handle(request('dry-run', range), { ...env, META_ACCESS_TOKEN: undefined })).status, 503);
});
test('full dry-run reads all APIs, paginates Shopify, excludes test orders and never touches D1 or Telegram', async () => {
  const calls = mockApis();
  const result = await handle(request('dry-run', { ...range, send_telegram: false }), { ...env, META_REVIEW_DB: { prepare() { assert.fail('dry-run must not touch D1'); } } });
  assert.equal(result.status, 200);
  const report = await result.json();
  assert.equal(report.meta.purchases, 35); // overlapping action names are not summed
  assert.equal(report.meta.purchaseValue, 46717.7);
  assert.equal(report.shopify.orders, 2);
  assert.equal(report.shopify.grossSales, 200);
  assert.equal(report.ga4.transactions, 18);
  assert.equal(report.changeHistory.available, false);
  assert.equal(report.findings.some(f => f.id === 'change-history-unavailable'), true);
  assert.ok(report.telegramMessage.includes('not Shopify Analytics'));
  assert.equal(calls.some(c => c.url.hostname === 'api.telegram.org'), false);
  assert.equal(JSON.stringify(report).includes('meta-test'), false);
});
test('real migrations, upsert and atomic Telegram claim prevent concurrent duplicate delivery', async () => {
  const calls = mockApis();
  const d1 = database();
  const configured = { ...env, META_REVIEW_DB: d1, META_REVIEW_TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'bot', TELEGRAM_ALLOWED_CHAT_ID: '-123' };
  const results = await Promise.all([handle(request('run', { ...range, send_telegram: true }), configured), handle(request('run', { ...range, send_telegram: true }), configured)]);
  assert.deepEqual(results.map(r => r.status), [200, 200]);
  assert.equal(calls.filter(c => c.url.hostname === 'api.telegram.org').length, 1);
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM meta_weekly_reviews').get().n, 1);
  assert.ok(d1.db.prepare('SELECT telegram_sent_at FROM meta_weekly_reviews').get().telegram_sent_at);
  assert.equal((await handle(request('latest'), configured)).status, 200);
  assert.equal((await (await handle(request('history'), configured)).json()).length, 1);
  d1.db.close();
});
test('webhook requires secret and exact allowlisted chat', async () => {
  global.fetch = () => assert.fail('must not fetch');
  const post = (secret, chat) => new Request('https://test/telegram/webhook', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify({ message: { chat: { id: chat }, text: '/meta_now' } }) });
  const configured = { ...env, TELEGRAM_WEBHOOK_SECRET: 'hook', TELEGRAM_ALLOWED_CHAT_ID: '-123', META_REVIEW_TELEGRAM_ENABLED: 'true' };
  assert.equal((await handle(post('wrong', '-123'), configured)).status, 403);
  assert.equal((await handle(post('hook', '-999'), configured)).status, 200);
  assert.equal((await handle(post('hook', '-123'), { ...configured, META_REVIEW_TELEGRAM_ENABLED: 'false' })).status, 503);
});
test('cron is disabled by default; Warsaw DST selects exactly one Sunday and Monday UTC trigger', async () => {
  global.fetch = () => assert.fail('must not fetch');
  const configured = { META_REVIEW_ENABLED: 'true' }; // matching schedule fails fast for missing token
  for (const [at, active] of [
    ['2026-07-12T18:00:00Z', true], ['2026-07-12T19:00:00Z', false],
    ['2026-07-13T06:00:00Z', true], ['2026-07-13T07:00:00Z', false],
    ['2026-10-25T18:00:00Z', false], ['2026-10-25T19:00:00Z', true],
    ['2026-10-26T06:00:00Z', false], ['2026-10-26T07:00:00Z', true],
  ]) {
    const controller = { scheduledTime: Date.parse(at) };
    await scheduled(controller, {}, {});
    if (active) await assert.rejects(scheduled(controller, configured, {}), /META_ACCESS_TOKEN/);
    else await scheduled(controller, configured, {});
  }
});
test('Meta pagination rejects foreign hosts and errors do not expose response/token', async () => {
  global.fetch = async () => response({ data: [], paging: { next: 'https://evil.example/steal?access_token=meta-test' } });
  await assert.rejects(metaAccountSummary(env, range.start_date, range.end_date), /Unexpected Meta pagination URL/);
  global.fetch = async () => new Response('{"error":{"message":"meta-test","code":190}}', { status: 401 });
  await assert.rejects(metaAccountSummary(env, range.start_date, range.end_date), error => !error.message.includes('meta-test') && error.message.includes('190'));
});

test('explicit false persists a manual report with delivery disabled', async () => {
  const calls = mockApis();
  const d1 = database();
  const result = await handle(request('run', { ...range, send_telegram: false }), { ...env, META_REVIEW_DB: d1 });
  assert.equal(result.status, 200);
  assert.equal(d1.db.prepare('SELECT COUNT(*) AS n FROM meta_weekly_reviews').get().n, 1);
  assert.equal(calls.some(c => c.url.hostname === 'api.telegram.org'), false);
  d1.db.close();
});
test('ambiguous Telegram failure retains a claim and retry does not send twice', async () => {
  mockApis();
  const upstream = global.fetch;
  let sends = 0;
  global.fetch = async (url, init) => {
    if (new URL(url).hostname === 'api.telegram.org') { sends++; throw new Error('ambiguous network failure'); }
    return upstream(url, init);
  };
  const d1 = database();
  const configured = { ...env, META_REVIEW_DB: d1, META_REVIEW_TELEGRAM_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'bot', TELEGRAM_ALLOWED_CHAT_ID: '-123' };
  assert.equal((await handle(request('run', { ...range, send_telegram: true }), configured)).status, 502);
  assert.equal((await handle(request('run', { ...range, send_telegram: true }), configured)).status, 200);
  assert.equal(sends, 1);
  const row = d1.db.prepare('SELECT telegram_claimed_at, telegram_sent_at FROM meta_weekly_reviews').get();
  assert.ok(row.telegram_claimed_at);
  assert.equal(row.telegram_sent_at, null);
  d1.db.close();
});
test('trusted Meta pagination strips query credentials and keeps authenticated GET', async () => {
  let count = 0;
  global.fetch = async (url, init) => {
    count++;
    assert.equal(new URL(url).searchParams.has('access_token'), false);
    assert.equal(init.headers.Authorization, 'Bearer meta-test');
    return count === 1 ? response({ data: [], paging: { next: 'https://graph.facebook.com/v24.0/act_1792664644903675/insights?after=cursor&access_token=meta-test' } }) : response({ data: [{ spend: '100', actions: [] }] });
  };
  assert.equal((await metaAccountSummary(env, range.start_date, range.end_date)).spend, 100);
  assert.equal(count, 2);
});
test('missing migration is unhealthy and upstream secrets are not returned on dry-run errors', async () => {
  const health = await (await handle(request('health'), { ...env, META_REVIEW_DB: { prepare() { throw new Error('missing column'); } } })).json();
  assert.equal(health.d1Schema, false);
  assert.equal(health.ok, false);
  global.fetch = async () => { throw new Error('upstream echo meta-test'); };
  const result = await handle(request('dry-run', range), env);
  assert.equal(result.status, 502);
  assert.equal((await result.text()).includes('meta-test'), false);
});
test('zero-purchase account is flagged even when previous CPA/ROAS are absent', async () => {
  mockApis();
  const upstream = global.fetch;
  global.fetch = async (url, init) => {
    if (new URL(url).pathname.endsWith('/insights')) return response({ data: [{ spend: '100', actions: [], action_values: [] }] });
    return upstream(url, init);
  };
  const report = await (await handle(request('dry-run', range), env)).json();
  assert.equal(report.status, 'RED');
  assert.ok(report.findings.some(f => f.id === 'account-zero-purchases'));
});

test('GA4 uses the complete UA credential set rather than generic credentials', async () => {
  const calls = mockApis();
  const result = await handle(request('dry-run', range), { ...env, GOOGLE_UA_CLIENT_ID: 'ua-id', GOOGLE_UA_CLIENT_SECRET: 'ua-secret', GOOGLE_UA_REFRESH_TOKEN: 'ua-refresh' });
  assert.equal(result.status, 200);
  const refreshes = calls.filter(c => c.url.hostname === 'oauth2.googleapis.com');
  assert.equal(refreshes.length, 2);
  for (const call of refreshes) {
    assert.equal(call.init.body.get('client_id'), 'ua-id');
    assert.equal(call.init.body.get('client_secret'), 'ua-secret');
    assert.equal(call.init.body.get('refresh_token'), 'ua-refresh');
  }
});
test('partial UA credentials fail closed without falling back to a different Google account', async () => {
  const calls = mockApis();
  const configured = { ...env, GOOGLE_UA_CLIENT_ID: 'ua-id' };
  const health = await (await handle(request('health'), configured)).json();
  assert.equal(health.ga4, false);
  const result = await handle(request('dry-run', range), configured);
  assert.equal(result.status, 502);
  assert.match((await result.json()).source, /^ga4_/);
  assert.equal(calls.some(c => c.url.hostname === 'oauth2.googleapis.com'), false);
});
test('isolated preview exposes only authenticated health and dry-run with side effects forced off', async () => {
  const preview = require('../src/meta-review-preview.ts').default;
  for (const path of ['/mcp', '/telegram/webhook', '/internal/meta-review/run', '/internal/meta-review/history']) {
    assert.equal((await preview.fetch(new Request(`https://test${path}`), env)).status, 404);
  }
  assert.equal((await preview.fetch(new Request('https://test/internal/meta-review/health'), env)).status, 401);
  const health = await (await preview.fetch(request('health'), { ...env, META_REVIEW_ENABLED: 'true', META_REVIEW_TELEGRAM_ENABLED: 'true' })).json();
  assert.equal(health.scheduledEnabled, false);
  assert.equal(health.telegramEnabled, false);
});

test('preflight independently reports successful sources and safe Google OAuth failure', async () => {
  mockApis();
  const upstream = global.fetch;
  global.fetch = async (url, init) => new URL(url).hostname === 'oauth2.googleapis.com'
    ? new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'sensitive-echo' }), { status: 400 })
    : upstream(url, init);
  const result = await handle(request('preflight', range), { ...env, META_REVIEW_DB: { prepare() { assert.fail('preflight must not access D1'); } } });
  assert.equal(result.status, 200);
  const report = await result.json();
  assert.equal(report.ok, false);
  assert.equal(report.sources.meta_current.ok, true);
  assert.equal(report.sources.shopify_current.ok, true);
  assert.equal(report.sources.ga4_current.ok, false);
  assert.deepEqual(report.sources.ga4_current.diagnostic, { http_status: 400, provider_error: 'invalid_grant', kind: 'google_token_refresh' });
  assert.equal(JSON.stringify(report).includes('sensitive-echo'), false);
  assert.equal(report.persisted, false);
  assert.equal(report.telegramSent, false);
});

test('generic Google credentials require explicit selection when UA credentials exist', async () => {
  const calls = mockApis();
  const result = await handle(request('dry-run', range), { ...env, GOOGLE_UA_CLIENT_ID: 'ua-id', META_REVIEW_GOOGLE_SOURCE: 'generic' });
  assert.equal(result.status, 200);
  for (const call of calls.filter(c => c.url.hostname === 'oauth2.googleapis.com')) {
    assert.equal(call.init.body.get('client_id'), env.GOOGLE_CLIENT_ID);
    assert.equal(call.init.body.get('refresh_token'), env.GOOGLE_REFRESH_TOKEN);
  }
  const health = await (await handle(request('health'), { ...env, META_REVIEW_GOOGLE_SOURCE: 'typo' })).json();
  assert.equal(health.ga4, false);
});

test('GA4 service-disabled diagnostic never returns provider messages or metadata', async () => {
  mockApis();
  const upstream = global.fetch;
  global.fetch = async (url, init) => new URL(url).hostname === 'analyticsdata.googleapis.com'
    ? new Response(JSON.stringify({ error: { status: 'PERMISSION_DENIED', message: 'private upstream text', details: [{ reason: 'SERVICE_DISABLED', metadata: { consumer: 'private project' } }] } }), { status: 403 })
    : upstream(url, init);
  const report = await (await handle(request('preflight', range), env)).json();
  assert.deepEqual(report.sources.ga4_current.diagnostic, { http_status: 403, provider_error: 'SERVICE_DISABLED', kind: 'ga4_report' });
  assert.equal(JSON.stringify(report).includes('private'), false);
});
