-- VendorTrak schema (D1 / SQLite).
-- Conventions: TEXT uuids (crypto.randomUUID), dates as 'YYYY-MM-DD',
-- timestamps as ISO-8601 UTC strings, booleans as INTEGER 0/1.
-- updated_at is maintained by the app's data layer, which also writes audit_log.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'vendor_coordinator', 'maintenance_engineer', 'technical_engineer')),
  password_hash TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Admin impersonation: when set, the app acts as this user while auditing as user_id.
  impersonating_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE vendors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE routines (
  id TEXT PRIMARY KEY,
  plan_number TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  interval_months INTEGER NOT NULL CHECK (interval_months > 0),
  start_date TEXT NOT NULL,
  call_horizon_months INTEGER NOT NULL DEFAULT 2 CHECK (call_horizon_months >= 0),
  vendor_coordinator_id TEXT NOT NULL REFERENCES users(id),
  maintenance_engineer_id TEXT NOT NULL REFERENCES users(id),
  technical_engineer_id TEXT NOT NULL REFERENCES users(id),
  requires_technical_review INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_routines_vendor ON routines(vendor_id);

CREATE TABLE visits (
  id TEXT PRIMARY KEY,
  routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  scheduled_date TEXT NOT NULL,
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (routine_id, scheduled_date)
);
CREATE INDEX idx_visits_status ON visits(status);
CREATE INDEX idx_visits_scheduled ON visits(scheduled_date);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  task_type TEXT NOT NULL CHECK (task_type IN (
    'confirm_visit_date', 'upload_report', 'create_recommendations',
    'review_recommendations', 'technical_review', 'close_visit')),
  assigned_to_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'in_progress', 'completed', 'overdue', 'cancelled')),
  due_date TEXT NOT NULL,
  completed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_visit ON tasks(visit_id);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to_id, status);
CREATE INDEX idx_tasks_due ON tasks(due_date);

CREATE TABLE recommendations (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  sap_notification_number TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open', 'in_review', 'approved', 'completed', 'cancelled')),
  created_by_id TEXT NOT NULL REFERENCES users(id),
  sent_for_review INTEGER NOT NULL DEFAULT 0,
  technical_review_response TEXT,
  review_decision TEXT CHECK (review_decision IN ('no_action', 'request_sap', 'other_action')),
  review_action_description TEXT,
  action_assigned_to_id TEXT REFERENCES users(id),
  reviewed_by_id TEXT REFERENCES users(id),
  reviewed_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  cancellation_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_recs_visit ON recommendations(visit_id);
CREATE INDEX idx_recs_status ON recommendations(status);

CREATE TABLE visit_reports (
  id TEXT PRIMARY KEY,
  visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  file_key TEXT NOT NULL,          -- R2 object key: <visit_id>/<timestamp>-<safe_name>
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL DEFAULT 0,
  content_type TEXT,
  uploaded_by_id TEXT NOT NULL REFERENCES users(id),
  uploaded_at TEXT NOT NULL,
  notes TEXT
);
CREATE INDEX idx_reports_visit ON visit_reports(visit_id);

CREATE TABLE system_config (
  config_key TEXT PRIMARY KEY,
  config_value TEXT NOT NULL,
  description TEXT
);

INSERT INTO system_config (config_key, config_value, description) VALUES
  ('visit_confirmation_days', '14', 'Days before the visit for the vendor coordinator to confirm the date'),
  ('report_upload_weeks', '2', 'Weeks after the visit date for the report upload deadline'),
  ('recommendations_review_days', '7', 'Days for the maintenance engineer to create recommendations'),
  ('technical_review_days', '7', 'Days for the technical engineer to complete a review');

-- Append-only audit trail, written by the data layer on every mutation.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  record_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  actor_id TEXT,                    -- null for cron/system
  old_data TEXT,                    -- JSON
  new_data TEXT,                    -- JSON
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_record ON audit_log(table_name, record_id);
