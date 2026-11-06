import assert from 'node:assert/strict';
import { test } from 'node:test';
import { guardedCancel } from './shopify-ua-cancel-guard.ts';

const c = { shopify_order:'#5203', tracking_number:'20451572274051',
  refusal_confirmed:1, actual_arrival_confirmed:1,
  arrival_location:'Первомайськ, відділення 1', payment_status:'PENDING',
  review_status:'DRY_RUN_ELIGIBLE' };
const o = { id:'gid://shopify/Order/123456789', name:'#5203', cancelledAt:null,
  displayFinancialStatus:'PENDING', test:false,
  fulfillments:[{ trackingInfo:[{number:c.tracking_number}] }] };
const mockDb = (candidate, changeCount=0) => ({ prepare: (sql) => ({
  bind: () => ({ first: async () => candidate, run: async () => ({meta:{changes:changeCount}}) })
}) });
const args = ['gid://shopify/Order/123456789','#5203',c.tracking_number];

test('eligible candidate dry-run reads Shopify but does not cancel', async () => {
  let mutations = 0;
  const result = await guardedCancel(mockDb(c), async (q) => {
    if (q.startsWith('mutation')) mutations++;
    return {order:o};
  }, ...args, false);
  assert.equal(result.status,'DRY_RUN_ELIGIBLE');
  assert.equal(mutations,0);
});

test('live cancellation fails shut without an acquired D1 lock', async () => {
  let calls=0;
  await assert.rejects(guardedCancel(mockDb(c,0), async () => {calls++;return {order:o};}, ...args,true));
  assert.equal(calls,0);
});

test('missing physical arrival cannot proceed', async () => {
  await assert.rejects(guardedCancel(mockDb({...c,actual_arrival_confirmed:0}),async()=>({order:o}),...args,false));
});
