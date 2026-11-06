import { cancelReturnedOrder } from './shopify-ua-cancel.ts';

type D1 = { prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null>; run(): Promise<{ meta?: { changes?: number } }> } } };
type Candidate = { shopify_order: string; tracking_number: string; refusal_confirmed: number;
  actual_arrival_confirmed: number; arrival_location: string; payment_status: string; review_status: string };

/** Must run only in a server-side Worker holding a D1 binding. */
export async function guardedCancel(
  db: D1, graphql: (query: string, variables: Record<string, unknown>) => Promise<any>,
  orderId: string, orderName: string, ttn: string, execute = false,
) {
  const candidate = await db.prepare(
    'SELECT * FROM cfo_auto_cancel_candidates WHERE shopify_order=? AND tracking_number=?',
  ).bind(orderName, ttn).first<Candidate>();
  if (!candidate || candidate.refusal_confirmed !== 1 || candidate.actual_arrival_confirmed !== 1 ||
      candidate.arrival_location !== 'Первомайськ, відділення 1' ||
      candidate.payment_status !== 'PENDING' || candidate.review_status !== 'DRY_RUN_ELIGIBLE') {
    throw new Error('D1 return evidence is not eligible');
  }

  if (!execute) return cancelReturnedOrder(graphql, { orderId, expectedName: orderName,
    trackingNumber: ttn, execute: false });

  // D1's original cancellation_enabled=0 CHECK remains an independent kill switch.
  // A single explicit authorization is required, and only one transition may win.
  const acquired = await db.prepare(`UPDATE cfo_auto_cancel_locks
    SET state='EXECUTING', updated_at=CURRENT_TIMESTAMP
    WHERE shopify_order=? AND tracking_number=? AND state='READY'
      AND EXISTS (SELECT 1 FROM cfo_auto_cancel_authorizations a
        WHERE a.shopify_order=? AND a.tracking_number=? AND a.enabled=1)
      AND EXISTS (SELECT 1 FROM cfo_auto_cancel_candidates c
        WHERE c.shopify_order=? AND c.cancellation_enabled=1)`)
    .bind(orderName, ttn, orderName, ttn, orderName).run();
  if (acquired.meta?.changes !== 1) throw new Error('D1 execution lock or kill switch rejected');

  // On timeout or ambiguous submission, retain EXECUTING. Reconcile Shopify
  // before changing state or attempting a retry.
  return cancelReturnedOrder(graphql, { orderId, expectedName: orderName,
    trackingNumber: ttn, execute: true });
}
