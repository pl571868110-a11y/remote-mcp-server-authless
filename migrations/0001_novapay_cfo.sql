-- PCC AI CFO / NovaPay UA ingest
-- Stores normalized settlement registries and payment rows without buyer PII.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS novapay_registries (
  registry_no TEXT PRIMARY KEY,
  registry_date TEXT NOT NULL,
  recipient_account TEXT,
  payment_count INTEGER NOT NULL,
  accepted_amount_cents INTEGER NOT NULL,
  fee_amount_cents INTEGER NOT NULL,
  transferred_amount_cents INTEGER NOT NULL,
  source_filename TEXT,
  file_sha256 TEXT NOT NULL UNIQUE,
  gmail_message_id TEXT,
  imported_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'gmail_xlsx'
);

CREATE TABLE IF NOT EXISTS novapay_payments (
  payment_key TEXT PRIMARY KEY,
  registry_no TEXT NOT NULL,
  row_no INTEGER,
  transfer_date TEXT NOT NULL,
  accepted_amount_cents INTEGER NOT NULL,
  fee_amount_cents INTEGER NOT NULL,
  transferred_amount_cents INTEGER NOT NULL,
  tariff TEXT,
  en_np TEXT,
  order_number TEXT NOT NULL,
  operation_id TEXT,
  comfort_transfer TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (registry_no) REFERENCES novapay_registries(registry_no) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_novapay_payments_order_number
  ON novapay_payments(order_number);

CREATE INDEX IF NOT EXISTS idx_novapay_payments_transfer_date
  ON novapay_payments(transfer_date);

CREATE TABLE IF NOT EXISTS novapay_shopify_reconciliation (
  payment_key TEXT PRIMARY KEY,
  shopify_order_id TEXT,
  shopify_order_name TEXT,
  shopify_total_cents INTEGER,
  shopify_current_total_cents INTEGER,
  shopify_financial_status TEXT,
  shopify_cancelled_at TEXT,
  shopify_test INTEGER,
  result_status TEXT NOT NULL,
  delta_cents INTEGER,
  checked_at TEXT NOT NULL,
  FOREIGN KEY (payment_key) REFERENCES novapay_payments(payment_key) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_novapay_reconciliation_status
  ON novapay_shopify_reconciliation(result_status);
