-- Create visit_reports table for storing multiple reports per visit
CREATE TABLE IF NOT EXISTS visit_reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  visit_id UUID NOT NULL REFERENCES maintenance_visits(id) ON DELETE CASCADE,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  uploaded_by_id UUID NOT NULL REFERENCES users(id),
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for faster lookups by visit_id
CREATE INDEX IF NOT EXISTS idx_visit_reports_visit_id ON visit_reports(visit_id);

-- Migrate existing report data from maintenance_visits to visit_reports
INSERT INTO visit_reports (visit_id, file_path, file_name, uploaded_by_id, uploaded_at, created_at, updated_at)
SELECT
  mv.id,
  mv.report_file_path,
  COALESCE(
    SUBSTRING(mv.report_file_path FROM '[^/]+$'),
    'report.pdf'
  ),
  mv.maintenance_engineer_id,
  mv.report_uploaded_at,
  mv.report_uploaded_at,
  mv.report_uploaded_at
FROM maintenance_visits mv
WHERE mv.report_file_path IS NOT NULL;

-- Note: We keep report_file_path and report_uploaded_at for backward compatibility
-- They can be removed in a future migration after confirming all code uses visit_reports
