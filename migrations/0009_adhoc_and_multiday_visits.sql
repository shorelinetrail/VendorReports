-- Ad-hoc visits (no maintenance routine - vendor/description/review flag live
-- on the visit itself) and multi-day visits (optional end_date).
-- SQLite can't drop NOT NULL, so rebuild the table; children keep referencing
-- the "visits" name after the rename.
PRAGMA defer_foreign_keys = on;

CREATE TABLE visits_new (
  id TEXT PRIMARY KEY,
  routine_id TEXT REFERENCES routines(id) ON DELETE CASCADE,  -- NULL = ad-hoc visit
  vendor_id TEXT REFERENCES vendors(id),                      -- set on ad-hoc visits
  description TEXT,                                           -- ad-hoc visits
  requires_technical_review INTEGER,                          -- ad-hoc visits; NULL = inherit from routine
  scheduled_date TEXT NOT NULL,
  end_date TEXT,                                              -- last day, when the visit spans multiple days
  confirmed_date TEXT,
  confirmed_at TEXT,
  notification_number TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN (
    'scheduled', 'date_confirmed', 'report_uploaded',
    'recommendations_created', 'in_review', 'completed', 'cancelled')),
  vendor_coordinator_id TEXT NOT NULL REFERENCES users(id),
  maintenance_engineer_id TEXT NOT NULL REFERENCES users(id),
  technical_engineer_id TEXT NOT NULL REFERENCES users(id),
  no_report_reason TEXT,
  reschedule_reason TEXT,
  rescheduled_at TEXT,
  rescheduled_from TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (routine_id IS NOT NULL OR vendor_id IS NOT NULL)
);

INSERT INTO visits_new (
  id, routine_id, scheduled_date, confirmed_date, confirmed_at, notification_number, status,
  vendor_coordinator_id, maintenance_engineer_id, technical_engineer_id,
  no_report_reason, reschedule_reason, rescheduled_at, rescheduled_from,
  completed_at, cancelled_at, cancellation_reason, created_at, updated_at)
SELECT
  id, routine_id, scheduled_date, confirmed_date, confirmed_at, notification_number, status,
  vendor_coordinator_id, maintenance_engineer_id, technical_engineer_id,
  no_report_reason, reschedule_reason, rescheduled_at, rescheduled_from,
  completed_at, cancelled_at, cancellation_reason, created_at, updated_at
FROM visits;

DROP TABLE visits;
ALTER TABLE visits_new RENAME TO visits;

CREATE INDEX idx_visits_status ON visits(status);
CREATE INDEX idx_visits_scheduled ON visits(scheduled_date);
-- Generator dedupe; multiple NULL routine_ids (ad-hoc) are allowed.
CREATE UNIQUE INDEX idx_visits_routine_date ON visits(routine_id, scheduled_date);
