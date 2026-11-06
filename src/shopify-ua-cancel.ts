/** Shopify UA cancellation primitive. Never expose directly to untrusted callers. */
export type CancelEnv = {
  SHOPIFY_SHOP: string;
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
};

type GraphQL = (query: string, variables: Record<string, unknown>) => Promise<any>;

export async function cancelReturnedOrder(
  graphql: GraphQL,
  args: {
    orderId: string;
    expectedName: string;
    trackingNumber: string;
    execute: boolean;
  },
) {
  if (!/^gid:\/\/shopify\/Order\/\d+$/.test(args.orderId)) throw new Error('Invalid Shopify order ID');
  if (!/^#\d+$/.test(args.expectedName)) throw new Error('Invalid order number');
  if (!/^\d{14}$/.test(args.trackingNumber)) throw new Error('Invalid Nova Poshta TTN');

  const readOrder = async () => {
    const result = await graphql(`query CancelCandidate($id: ID!) {
      order(id: $id) {
        id name cancelledAt displayFinancialStatus test
        fulfillments { trackingInfo { number } }
      }
    }`, { id: args.orderId });
    const order = result?.order;
    if (!order || order.id !== args.orderId || order.name !== args.expectedName) {
      throw new Error('Order identity mismatch');
    }
    if (order.test || order.cancelledAt || order.displayFinancialStatus !== 'PENDING') {
      throw new Error('Order is not eligible: test, paid, or cancelled');
    }
    if (!order.fulfillments?.some((f: any) =>
      f.trackingInfo?.some((t: any) => t.number === args.trackingNumber))) {
      throw new Error('Nova Poshta TTN does not match the order');
    }
    return order;
  };

  await readOrder();
  if (!args.execute) return { status: 'DRY_RUN_ELIGIBLE', order: args.expectedName, restock: false };

  // The caller must acquire a persistent, unique D1 lock and verify refusal +
  // physical return arrival before invoking execute. Do not retry an ambiguous
  // network failure without reconciling Shopify order/job state.
  const result = await graphql(`mutation CancelReturned($id: ID!) {
    orderCancel(orderId: $id, reason: CUSTOMER, restock: false,
      notifyCustomer: false, refundMethod: {originalPaymentMethodsRefund: false},
      staffNote: "Nova Poshta: buyer refusal; verified return to fulfillment. No restock.") {
      job { id done }
      orderCancelUserErrors { code field message }
    }
  }`, { id: args.orderId });
  const operation = result?.orderCancel;
  const errors = operation?.orderCancelUserErrors || [];
  if (!operation?.job || errors.length) throw new Error(`Shopify rejected cancellation: ${JSON.stringify(errors)}`);
  return { status: 'SUBMITTED', order: args.expectedName, jobId: operation.job.id,
    jobDone: operation.job.done, restock: false, verificationRequired: true };
}
