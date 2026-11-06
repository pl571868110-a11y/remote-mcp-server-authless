-- PREPARED ONLY. Do NOT execute until the active Worker is safely integrated,
-- a D1 backup is verified, and Shopify order GID and access scopes are checked.
-- The original D1 CHECK(cancellation_enabled=0) is a deliberate kill switch.
-- All existing candidates remain disabled after this migration.

CREATE TABLE IF NOT EXISTS cfo_auto_cancel_authorizations (
  shopify_order TEXT PRIMARY KEY,
  tracking_number TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  approved_at TEXT,
  approved_by TEXT,
  purpose TEXT NOT NULL DEFAULT 'single_return_cancellation'
);

-- SQLite cannot directly drop one CHECK constraint. Rebuild explicitly while
-- retaining every column, existing candidate, and the dry-run view.
DROP VIEW IF EXISTS cfo_auto_cancel_dry_run_v1;

CREATE TABLE cfo_auto_cancel_candidates_new (
  shopify_order TEXT PRIMARY KEY,
  tracking_number TEXT NOT NULL,
  order_amount_cents INTEGER NOT NULL CHECK(order_amount_cents > 0),
  currency TEXT NOT NULL DEFAULT 'UAH',
  refusal_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(refusal_confirmed IN (0,1)),
  actual_arrival_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(actual_arrival_confirmed IN (0,1)),
  arrival_location TEXT,
  arrival_at TEXT,
  evidence_source TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK(review_status IN ('PENDING','DRY_RUN_ELIGIBLE','BLOCKED','CANCELLED')),
  cancellation_enabled INTEGER NOT NULL DEFAULT 0 CHECK(cancellation_enabled IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO cfo_auto_cancel_candidates_new (
  shopify_order, tracking_number, order_amount_cents, currency,
  refusal_confirmed, actual_arrival_confirmed, arrival_location,
  arrival_at, evidence_source, payment_status, review_status,
  cancellation_enabled, created_at, updated_at
) SELECT shopify_order, tracking_number, order_amount_cents, currency,
  refusal_confirmed, actual_arrival_confirmed, arrival_location,
  arrival_at, evidence_source, payment_status, review_status,
  0, created_at, updated_at
FROM cfo_auto_cancel_candidates;

DROP TABLE cfo_auto_cancel_candidates;
ALTER TABLE cfo_auto_cancel_candidates_new RENAME TO cfo_auto_cancel_candidates;

CREATE VIEW cfo_auto_cancel_dry_run_v1 AS
SELECT c.shopify_order,c.tracking_number,c.order_amount_cents,
  c.payment_status,c.actual_arrival_confirmed,c.arrival_at,
  CASE
    WHEN c.payment_status <> 'PENDING' THEN 'BLOCK_PAYMENT'
    WHEN c.refusal_confirmed <> 1 THEN 'BLOCK_REFUSAL'
    WHEN c.actual_arrival_confirmed <> 1 OR
      c.arrival_location <> 'Первомайськ, відділення 1' THEN 'BLOCK_ARRIVAL'
    WHEN l.shopify_order IS NULL OR l.tracking_number <> c.tracking_number THEN 'BLOCK_LOCK_MISSING'
    WHEN c.cancellation_enabled <> 0 OR l.state <> 'BLOCKED' THEN 'BLOCK_UNEXPECTED_STATE'
    ELSE 'DRY_RUN_ELIGIBLE'
  END AS decision,
  0 AS would_call_shopify, 0 AS would_restock
FROM cfo_auto_cancel_candidates c
LEFT JOIN cfo_auto_cancel_locks l ON l.shopify_order=c.shopify_order;

-- Separate one-time activation, intentionally NOT included here:
-- INSERT INTO cfo_auto_cancel_authorizations (shopify_order,tracking_number,enabled,approved_at,approved_by)
-- VALUES ('#5203','20451572274051',1,CURRENT_TIMESTAMP,'ANTON');
-- UPDATE cfo_auto_cancel_candidates SET cancellation_enabled=1 WHERE shopify_order='#5203';
-- UPDATE cfo_auto_cancel_locks SET state='READY' WHERE shopify_order='#5203' AND state='BLOCKED';
