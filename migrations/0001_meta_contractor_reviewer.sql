CREATE TABLE IF NOT EXISTS meta_weekly_reviews (
  id TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  report_type TEXT NOT NULL,
  generated_at TEXT NOT NULL,

  meta_spend REAL,
  meta_purchases INTEGER,
  meta_revenue REAL,
  meta_roas REAL,
  meta_cpa REAL,
  meta_cpm REAL,
  meta_ctr REAL,
  meta_cpc REAL,
  meta_frequency REAL,
  meta_add_to_cart INTEGER,
  meta_checkout INTEGER,

  shopify_orders INTEGER,
  shopify_gross_sales REAL,
  shopify_net_sales REAL,
  shopify_refunds REAL,
  shopify_cancelled INTEGER,

  ga4_transactions INTEGER,
  ga4_purchase_revenue REAL,

  status TEXT NOT NULL,
  findings_json TEXT NOT NULL,
  recommendations_json TEXT NOT NULL,
  contractor_questions_json TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  telegram_message TEXT NOT NULL,
  telegram_sent_at TEXT,

  UNIQUE(period_start, period_end, report_type)
);

CREATE INDEX IF NOT EXISTS idx_meta_weekly_reviews_generated_at
  ON meta_weekly_reviews(generated_at DESC);

CREATE TABLE IF NOT EXISTS meta_contractor_actions (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  actor TEXT,
  entity_type TEXT,
  entity_id TEXT,
  entity_name TEXT,
  operation TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  source TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meta_contractor_actions_occurred_at
  ON meta_contractor_actions(occurred_at DESC);
