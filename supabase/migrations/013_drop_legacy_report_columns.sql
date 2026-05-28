-- Finish the migration started in 005: all report data now lives in
-- visit_reports. Drop the legacy single-report columns from maintenance_visits.
-- NOTE: apply this only after deploying the application changes that stop
-- reading/writing these columns.
ALTER TABLE maintenance_visits DROP COLUMN IF EXISTS report_file_path;
ALTER TABLE maintenance_visits DROP COLUMN IF EXISTS report_uploaded_at;
