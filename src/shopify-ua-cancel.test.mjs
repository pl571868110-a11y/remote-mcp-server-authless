import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cancelReturnedOrder } from './shopify-ua-cancel.ts';

const candidate = {
  id: 'gid://shopify/Order/5203', name: '#5203', cancelledAt: null,
  displayFinancialStatus: 'PENDING', test: false,
  fulfillments: [{ trackingInfo: [{ number: '20451572274051' }] }],
};
const args = { orderId: candidate.id, expectedName: '#5203',
  trackingNumber: '20451572274051', execute: false };

test('dry run verifies order and never mutates', async () => {
  const calls = [];
  const graphql = async (query) => { calls.push(query); return { order: candidate }; };
  const result = await cancelReturnedOrder(graphql, args);
  assert.equal(result.status, 'DRY_RUN_ELIGIBLE');
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^query/);
});

test('paid, cancelled, or mismatched TTN fail closed', async () => {
  for (const changes of [
    { displayFinancialStatus: 'PAID' }, { cancelledAt: '2026-11-06T00:00:00Z' },
    { fulfillments: [] },
  ]) {
    const graphql = async () => ({ order: { ...candidate, ...changes } });
    await assert.rejects(cancelReturnedOrder(graphql, { ...args, execute: true }));
  }
});

test('execute uses restock false and reports asynchronous submission', async () => {
  const calls = [];
  const graphql = async (query) => {
    calls.push(query);
    if (query.startsWith('query')) return { order: candidate };
    return { orderCancel: { job: { id: 'gid://shopify/Job/1', done: false }, orderCancelUserErrors: [] } };
  };
  const result = await cancelReturnedOrder(graphql, { ...args, execute: true });
  assert.equal(result.status, 'SUBMITTED');
  assert.equal(result.verificationRequired, true);
  assert.match(calls[1], /restock: false/);
});
