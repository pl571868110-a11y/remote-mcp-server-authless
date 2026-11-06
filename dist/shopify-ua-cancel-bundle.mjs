// Isolated Cloudflare Worker candidate. NOT deployed; DO NOT replace the existing multi-route Worker.
export async function cancelReturnedOrder(graphql, args) {
    if (!/^gid:\/\/shopify\/Order\/\d+$/.test(args.orderId)) throw new Error('Invalid Shopify order ID');
    if (!/^#\d+$/.test(args.expectedName)) throw new Error('Invalid order number');
    if (!/^\d{14}$/.test(args.trackingNumber)) throw new Error('Invalid Nova Poshta TTN');
    const readOrder = async ()=>{
        const result = await graphql(`query CancelCandidate($id: ID!) {
      order(id: $id) {
        id name cancelledAt displayFinancialStatus test
        fulfillments { trackingInfo { number } }
      }
    }`, {
            id: args.orderId
        });
        const order = result?.order;
        if (!order || order.id !== args.orderId || order.name !== args.expectedName) {
            throw new Error('Order identity mismatch');
        }
        if (order.test || order.cancelledAt || order.displayFinancialStatus !== 'PENDING') {
            throw new Error('Order is not eligible: test, paid, or cancelled');
        }
        if (!order.fulfillments?.some((f)=>f.trackingInfo?.some((t)=>t.number === args.trackingNumber))) {
            throw new Error('Nova Poshta TTN does not match the order');
        }
        return order;
    };
    await readOrder();
    if (!args.execute) return {
        status: 'DRY_RUN_ELIGIBLE',
        order: args.expectedName,
        restock: false
    };
    const result = await graphql(`mutation CancelReturned($id: ID!) {
    orderCancel(orderId: $id, reason: CUSTOMER, restock: false,
      notifyCustomer: false, refundMethod: {originalPaymentMethodsRefund: false},
      staffNote: "Nova Poshta: buyer refusal; verified return to fulfillment. No restock.") {
      job { id done }
      orderCancelUserErrors { code field message }
    }
  }`, {
        id: args.orderId
    });
    const operation = result?.orderCancel;
    const errors = operation?.orderCancelUserErrors || [];
    if (!operation?.job || errors.length) throw new Error(`Shopify rejected cancellation: ${JSON.stringify(errors)}`);
    return {
        status: 'SUBMITTED',
        order: args.expectedName,
        jobId: operation.job.id,
        jobDone: operation.job.done,
        restock: false,
        verificationRequired: true
    };
}
export async function guardedCancel(db, graphql, orderId, orderName, ttn, execute = false) {
    const candidate = await db.prepare('SELECT * FROM cfo_auto_cancel_candidates WHERE shopify_order=? AND tracking_number=?').bind(orderName, ttn).first();
    if (!candidate || candidate.refusal_confirmed !== 1 || candidate.actual_arrival_confirmed !== 1 || candidate.arrival_location !== 'Первомайськ, відділення 1' || candidate.payment_status !== 'PENDING' || candidate.review_status !== 'DRY_RUN_ELIGIBLE') {
        throw new Error('D1 return evidence is not eligible');
    }
    if (!execute) return cancelReturnedOrder(graphql, {
        orderId,
        expectedName: orderName,
        trackingNumber: ttn,
        execute: false
    });
    const acquired = await db.prepare(`UPDATE cfo_auto_cancel_locks
    SET state='EXECUTING', updated_at=CURRENT_TIMESTAMP
    WHERE shopify_order=? AND tracking_number=? AND state='READY'
      AND EXISTS (SELECT 1 FROM cfo_auto_cancel_authorizations a
        WHERE a.shopify_order=? AND a.tracking_number=? AND a.enabled=1)
      AND EXISTS (SELECT 1 FROM cfo_auto_cancel_candidates c
        WHERE c.shopify_order=? AND c.cancellation_enabled=1)`).bind(orderName, ttn, orderName, ttn, orderName).run();
    if (acquired.meta?.changes !== 1) throw new Error('D1 execution lock or kill switch rejected');
    return cancelReturnedOrder(graphql, {
        orderId,
        expectedName: orderName,
        trackingNumber: ttn,
        execute: true
    });
}
const TRACKING_5203 = '20451572274051';
const ORDER_5203 = '#5203';
const reply = (value, status = 200)=>new Response(JSON.stringify(value), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store'
        }
    });
export default {
    async fetch (request, env) {
        const url = new URL(request.url);
        if (url.pathname !== '/internal/shopify-ua/cancel-return/5203') return reply({
            error: 'Not found'
        }, 404);
        if (request.method !== 'POST') return reply({
            error: 'Method not allowed'
        }, 405);
        if (!env.CFO_DB || !env.SHOPIFY_UA_SHOP || !env.SHOPIFY_UA_ADMIN_TOKEN || !env.CANCEL_ADMIN_TOKEN || !env.CANCEL_ORDER_5203_GID) {
            return reply({
                error: 'Required bindings unavailable'
            }, 503);
        }
        if (request.headers.get('authorization') !== `Bearer ${env.CANCEL_ADMIN_TOKEN}`) {
            return reply({
                error: 'Unauthorized'
            }, 401);
        }
        let payload;
        try {
            payload = await request.json();
        } catch  {
            return reply({
                error: 'Invalid JSON'
            }, 400);
        }
        if (!payload || payload.order !== ORDER_5203 || payload.ttn !== TRACKING_5203 || typeof payload.execute !== 'boolean' || Object.keys(payload).some((k)=>![
                'order',
                'ttn',
                'execute'
            ].includes(k))) {
            return reply({
                error: 'Order, tracking or operation mismatch'
            }, 400);
        }
        const graphql = async (query, variables)=>{
            const response = await fetch(`https://${env.SHOPIFY_UA_SHOP}/admin/api/2026-07/graphql.json`, {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    'x-shopify-access-token': env.SHOPIFY_UA_ADMIN_TOKEN
                },
                body: JSON.stringify({
                    query,
                    variables
                })
            });
            if (!response.ok) throw new Error(`Shopify API HTTP ${response.status}`);
            const body = await response.json();
            if (body.errors?.length) throw new Error('Shopify GraphQL errors');
            return body.data;
        };
        try {
            const result = await guardedCancel(env.CFO_DB, graphql, env.CANCEL_ORDER_5203_GID, ORDER_5203, TRACKING_5203, payload.execute);
            return reply(result);
        } catch (error) {
            return reply({
                error: 'Cancellation denied or not verified',
                code: 'CANCEL_FAIL_CLOSED'
            }, 409);
        }
    }
};
