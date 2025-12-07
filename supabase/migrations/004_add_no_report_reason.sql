-- Add no_report_reason column to maintenance_visits
ALTER TABLE maintenance_visits
ADD COLUMN IF NOT EXISTS no_report_reason TEXT;
