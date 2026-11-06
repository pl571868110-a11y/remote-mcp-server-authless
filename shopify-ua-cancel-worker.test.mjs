import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from './shopify-ua-cancel-worker.ts';

const url = 'https://example.invalid/internal/shopify-ua/cancel-return/5203';
const env = { CFO_DB: {}, SHOPIFY_UA_SHOP: 'example.myshopify.com',
  SHOPIFY_UA_ADMIN_TOKEN: 'shopify-test', CANCEL_ADMIN_TOKEN: 'private-test',
  CANCEL_ORDER_5203_GID: 'gid://shopify/Order/123' };
const make = (path = url, auth = 'Bearer private-test', body = {
  order: '#5203', ttn: '20451572274051', execute: false,
}) => new Request(path, { method: 'POST', headers: {
  authorization: auth, 'content-type': 'application/json',
}, body: JSON.stringify(body) });

test('isolated route rejects unrelated paths', async () => {
  assert.equal((await worker.fetch(make('https://example.invalid/anything'), env)).status, 404);
});
test('isolated route rejects absent bindings before API calls', async () => {
  assert.equal((await worker.fetch(make(), {})).status, 503);
});
test('isolated route rejects unauthorized request', async () => {
  assert.equal((await worker.fetch(make(url, 'Bearer incorrect'), env)).status, 401);
});
test('isolated route refuses a different order or bulk payload', async () => {
  assert.equal((await worker.fetch(make(url, 'Bearer private-test', {
    order: '#5214', ttn: '20451572274051', execute: true,
  }), env)).status, 400);
});
