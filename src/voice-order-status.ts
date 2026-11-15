// Narrow, fail-closed endpoint for the ElevenLabs PL telephone agent.
// caller_phone must be a fixed ElevenLabs system__caller_id parameter, never LLM input.
export const VOICE_ORDER_PATH = "/voice/pl/order-status";
export const VOICE_ORDER_QUERY = `query VoiceOrderStatus($query: String!) {
  orders(first: 2, query: $query) { nodes {
    name email phone sourceName cancelledAt
    shippingAddress { phone }
    displayFinancialStatus displayFulfillmentStatus
    fulfillments { displayStatus trackingInfo { company number } }
  } }
}`;

type Limiter = { limit(input: { key: string }): Promise<{ success: boolean }> };
export type VoiceOrderEnv = {
  VOICE_PL_ENABLED?: string;
  VOICE_PL_TOKEN?: string;
  VOICE_PL_LIMITER?: Limiter;
};
type Order = {
  name: string; email: string | null; phone: string | null;
  sourceName: string; cancelledAt: string | null;
  shippingAddress?: { phone: string | null } | null;
  displayFinancialStatus: string; displayFulfillmentStatus: string;
  fulfillments: { displayStatus: string; trackingInfo: { company: string | null; number: string | null }[] }[];
};
type Query = (query: string, variables: Record<string, unknown>) => Promise<{ orders: { nodes: Order[] } }>;

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}
function unavailable() { return response({ status: "unavailable" }, 503); }
function unverified() { return response({ status: "not_verified" }); }
function email(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 254) return null;
  const result = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result) ? result : null;
}
function phone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 32 || !/^\+?[\d ()-]+$/.test(value)) return null;
  let result = value.replace(/[ ()-]/g, "");
  if (result.startsWith("00")) result = "+" + result.slice(2);
  // Only unambiguous Polish national numbers get a default country code.
  if (/^\d{9}$/.test(result)) result = "+48" + result;
  return /^\+[1-9]\d{7,14}$/.test(result) ? result : null;
}
async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
async function equalSecret(a: string, b: string) {
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function handleVoiceOrderStatus(request: Request, env: VoiceOrderEnv, query: Query): Promise<Response | null> {
  if (new URL(request.url).pathname !== VOICE_ORDER_PATH) return null;
  if (env.VOICE_PL_ENABLED !== "true" || !env.VOICE_PL_TOKEN || env.VOICE_PL_TOKEN.length < 32 || !env.VOICE_PL_LIMITER) return unavailable();
  if (request.method !== "POST") return response({ status: "method_not_allowed" }, 405);
  const auth = request.headers.get("Authorization") || "";
  if (auth.length > 512 || !await equalSecret(auth, "Bearer " + env.VOICE_PL_TOKEN)) return response({ status: "unauthorized" }, 401);
  try {
    // Global abuse cap in addition to caller and order caps; fail closed if unavailable.
    if (!(await env.VOICE_PL_LIMITER.limit({ key: "voice-pl-global" })).success) return response({ status: "rate_limited" }, 429);
    if (!request.headers.get("Content-Type")?.startsWith("application/json")) return response({ status: "invalid_request" }, 400);
    const raw = await request.text();
    if (raw.length > 2048) return response({ status: "invalid_request" }, 400);
    const body = JSON.parse(raw);
    const orderName = typeof body.order_number === "string" ? body.order_number.trim().replace(/^#/, "") : "";
    const address = email(body.email);
    const caller = phone(body.caller_phone);
    if (!/^\d{1,12}$/.test(orderName) || !address || !caller) return unverified();
    const key = async (s: string) => Array.from(await digest(s), b => b.toString(16).padStart(2, "0")).join("");
    for (const value of ["caller:" + caller, "order:" + orderName]) {
      if (!(await env.VOICE_PL_LIMITER.limit({ key: await key(value) })).success) return response({ status: "rate_limited" }, 429);
    }
    const data = await query(VOICE_ORDER_QUERY, { query: `name:${JSON.stringify("#" + orderName)}` });
    // Never trust approximate Shopify search matching, and never reveal existence on mismatch.
    const matches = data.orders.nodes.filter(o => o.name === "#" + orderName);
    if (matches.length !== 1) return unverified();
    const order = matches[0];
    if (order.sourceName !== "web" || email(order.email) !== address || ![phone(order.phone), phone(order.shippingAddress?.phone)].includes(caller)) return unverified();
    return response({
      status: "verified", order_number: order.name,
      cancelled: Boolean(order.cancelledAt),
      payment_status: order.displayFinancialStatus,
      fulfillment_status: order.displayFulfillmentStatus,
      shipments: order.fulfillments.map(f => ({ status: f.displayStatus, tracking: f.trackingInfo.map(t => ({ carrier: t.company, number: t.number })) })),
      source: "Shopify Poland", checked_at: new Date().toISOString(),
    });
  } catch {
    // Never echo Shopify error payloads, customer data, credentials or input.
    return unavailable();
  }
}
