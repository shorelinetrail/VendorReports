-- Add reschedule tracking fields to maintenance_visits
ALTER TABLE maintenance_visits
ADD COLUMN IF NOT EXISTS reschedule_reason TEXT,
ADD COLUMN IF NOT EXISTS rescheduled_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rescheduled_from DATE;
