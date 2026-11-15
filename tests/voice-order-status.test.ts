import test from "node:test";
import assert from "node:assert/strict";
import { handleVoiceOrderStatus, VOICE_ORDER_PATH } from "../src/voice-order-status.ts";

const token = "synthetic-test-token-not-a-production-secret";
const env = { VOICE_PL_ENABLED: "true", VOICE_PL_TOKEN: token, VOICE_PL_LIMITER: { limit: async () => ({ success: true }) } };
const order = {
  name: "#1234", email: "test@example.com", phone: "+48500100200", sourceName: "web", cancelledAt: null,
  displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED", shippingAddress: null,
  fulfillments: [{ displayStatus: "IN_TRANSIT", trackingInfo: [{ company: "Test Carrier", number: "SYNTHETIC123" }] }],
};
const input = { order_number: "1234", email: "test@example.com", caller_phone: "+48500100200" };
function request(body: unknown = input, auth = "Bearer " + token) {
  return new Request("https://example.invalid" + VOICE_ORDER_PATH, { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
const query = async () => ({ orders: { nodes: [order] } });
async function result(body: unknown = input, lookup = query, settings = env) {
  const res = await handleVoiceOrderStatus(request(body), settings, lookup);
  assert.ok(res);
  return { status: res.status, body: await res.json() };
}
test("exact identity returns only status and shipment allowlist", async () => {
  const r = await result();
  assert.equal(r.body.status, "verified");
  assert.equal(r.body.shipments[0].tracking[0].number, "SYNTHETIC123");
  for (const field of ["email", "phone", "shippingAddress", "lineItems", "customer", "id"]) assert.ok(!(field in r.body));
});
test("email case and unambiguous Polish phone normalize", async () => {
  assert.equal((await result({ ...input, email: " TEST@EXAMPLE.COM ", caller_phone: "500 100 200" })).body.status, "verified");
});
test("missing order and mismatched identity produce the same response", async () => {
  const missing = await result(input, async () => ({ orders: { nodes: [] } }));
  for (const body of [{ ...input, email: "other@example.com" }, { ...input, caller_phone: "+48500100201" }, { ...input, caller_phone: "anonymous" }]) {
    assert.deepEqual(await result(body), missing);
  }
});
test("approximate order search, ambiguous results and marketplace orders are rejected", async () => {
  for (const nodes of [[{ ...order, name: "#12345" }], [order, order], [{ ...order, sourceName: "shopify_draft_order" }]]) {
    assert.equal((await result(input, async () => ({ orders: { nodes } }))).body.status, "not_verified");
  }
});
test("query injection is rejected before Shopify is called", async () => {
  let called = false;
  const r = await result({ ...input, order_number: "1234 OR status:any" }, async () => { called = true; return query(); });
  assert.equal(called, false);
  assert.equal(r.body.status, "not_verified");
});
test("disabled endpoint and missing limiter fail closed", async () => {
  assert.equal((await result(input, query, { ...env, VOICE_PL_ENABLED: "false" })).status, 503);
  const res = await handleVoiceOrderStatus(request(), { VOICE_PL_ENABLED: "true", VOICE_PL_TOKEN: token }, query);
  assert.equal(res?.status, 503);
});
test("bad token never queries Shopify", async () => {
  let called = false;
  const res = await handleVoiceOrderStatus(request(input, "Bearer wrong"), env, async () => { called = true; return query(); });
  assert.equal(res?.status, 401);
  assert.equal(called, false);
});
test("rate limit failure prevents Shopify access", async () => {
  const r = await result(input, query, { ...env, VOICE_PL_LIMITER: { limit: async () => ({ success: false }) } });
  assert.equal(r.status, 429);
});
test("Shopify errors never reveal error text or customer data", async () => {
  const r = await result(input, async () => { throw new Error("SECRET customer@example.com"); });
  assert.deepEqual(r, { status: 503, body: { status: "unavailable" } });
});
