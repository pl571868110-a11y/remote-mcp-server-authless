-- Atomic delivery reservation. Failed/ambiguous sends require operator reconciliation.
ALTER TABLE meta_weekly_reviews ADD COLUMN telegram_claimed_at TEXT;
