-- Visits can now be cancelled from the UI, with a required reason.
ALTER TABLE visits ADD COLUMN cancelled_at TEXT;
ALTER TABLE visits ADD COLUMN cancellation_reason TEXT;
