import { guardedCancel } from './shopify-ua-cancel-guard.ts';

type Env = {
  CFO_DB: any;
  SHOPIFY_UA_SHOP: string;
  SHOPIFY_UA_ADMIN_TOKEN: string;
  CANCEL_ADMIN_TOKEN: string;
  CANCEL_ORDER_5203_GID: string;
};

const TRACKING_5203 = '20451572274051';
const ORDER_5203 = '#5203';

const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

/** Isolated Worker entrypoint. Never replace the existing multi-route Worker with this. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/internal/shopify-ua/cancel-return/5203') return reply({ error: 'Not found' }, 404);
    if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
    // Fail closed unless all production bindings are explicitly configured.
    if (!env.CFO_DB || !env.SHOPIFY_UA_SHOP || !env.SHOPIFY_UA_ADMIN_TOKEN ||
        !env.CANCEL_ADMIN_TOKEN || !env.CANCEL_ORDER_5203_GID) {
      return reply({ error: 'Required bindings unavailable' }, 503);
    }
    if (request.headers.get('authorization') !== `Bearer ${env.CANCEL_ADMIN_TOKEN}`) {
      return reply({ error: 'Unauthorized' }, 401);
    }
    let payload: any;
    try { payload = await request.json(); } catch { return reply({ error: 'Invalid JSON' }, 400); }
    if (!payload || payload.order !== ORDER_5203 || payload.ttn !== TRACKING_5203 ||
        typeof payload.execute !== 'boolean' || Object.keys(payload).some(k => !['order', 'ttn', 'execute'].includes(k))) {
      return reply({ error: 'Order, tracking or operation mismatch' }, 400);
    }
    const graphql = async (query: string, variables: Record<string, unknown>) => {
      const response = await fetch(`https://${env.SHOPIFY_UA_SHOP}/admin/api/2026-07/graphql.json`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-shopify-access-token': env.SHOPIFY_UA_ADMIN_TOKEN },
        body: JSON.stringify({ query, variables }),
      });
      if (!response.ok) throw new Error(`Shopify API HTTP ${response.status}`);
      const body: any = await response.json();
      if (body.errors?.length) throw new Error('Shopify GraphQL errors');
      return body.data;
    };
    try {
      const result = await guardedCancel(env.CFO_DB, graphql,
        env.CANCEL_ORDER_5203_GID, ORDER_5203, TRACKING_5203, payload.execute);
      return reply(result);
    } catch (error) {
      // Never echo tokens, upstream bodies, or internal error data.
      return reply({ error: 'Cancellation denied or not verified', code: 'CANCEL_FAIL_CLOSED' }, 409);
    }
  },
};
