-- Add confirmed_at field to track when the visit date was confirmed
-- This is separate from confirmed_date which stores the actual visit date

ALTER TABLE maintenance_visits
ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ;

-- Backfill existing confirmed visits with their updated_at as best approximation
UPDATE maintenance_visits
SET confirmed_at = updated_at
WHERE confirmed_date IS NOT NULL AND confirmed_at IS NULL;

-- Add comment for documentation
COMMENT ON COLUMN maintenance_visits.confirmed_at IS 'Timestamp when the visit date was confirmed by the vendor coordinator';
