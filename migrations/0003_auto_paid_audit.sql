-- PCC AI CFO / automatic Shopify paid audit trail
-- Append-only operational history for each auto-paid run and per-order decision.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS cfo_auto_paid_runs (
  run_id TEXT PRIMARY KEY,
  trigger_source TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  candidates_found INTEGER NOT NULL DEFAULT 0,
  novaposhta_confirmed INTEGER NOT NULL DEFAULT 0,
  ready_for_shopify INTEGER NOT NULL DEFAULT 0,
  marked_paid INTEGER NOT NULL DEFAULT 0,
  verified_match_current INTEGER NOT NULL DEFAULT 0,
  decisions_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_cfo_auto_paid_runs_started_at
  ON cfo_auto_paid_runs(started_at);

CREATE INDEX IF NOT EXISTS idx_cfo_auto_paid_runs_status
  ON cfo_auto_paid_runs(status);

CREATE TABLE IF NOT EXISTS cfo_auto_paid_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  payment_key TEXT,
  registry_no TEXT,
  order_number TEXT,
  tracking_number TEXT,
  accepted_amount_cents INTEGER,
  event_status TEXT NOT NULL,
  blockers_json TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES cfo_auto_paid_runs(run_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cfo_auto_paid_events_run_id
  ON cfo_auto_paid_events(run_id);

CREATE INDEX IF NOT EXISTS idx_cfo_auto_paid_events_order_number
  ON cfo_auto_paid_events(order_number);

CREATE INDEX IF NOT EXISTS idx_cfo_auto_paid_events_status
  ON cfo_auto_paid_events(event_status);

CREATE INDEX IF NOT EXISTS idx_cfo_auto_paid_events_created_at
  ON cfo_auto_paid_events(created_at);


-- Audit events are immutable after insertion.
CREATE TRIGGER IF NOT EXISTS trg_cfo_auto_paid_events_no_update
BEFORE UPDATE ON cfo_auto_paid_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CFO_AUTO_PAID_EVENT_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_cfo_auto_paid_events_no_delete
BEFORE DELETE ON cfo_auto_paid_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CFO_AUTO_PAID_EVENT_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS trg_cfo_auto_paid_runs_no_delete
BEFORE DELETE ON cfo_auto_paid_runs
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'CFO_AUTO_PAID_RUN_IMMUTABLE');
END;
