// PETSCHOICE Shopify UA cancel candidate; NOT deployed; requires trusted D1 orchestration.
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
