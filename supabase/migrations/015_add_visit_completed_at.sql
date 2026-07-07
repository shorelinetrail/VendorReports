-- Record when a visit was actually closed, instead of inferring it from
-- updated_at (which moves on any edit). Set on close, cleared on reopen.
ALTER TABLE maintenance_visits
ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

COMMENT ON COLUMN maintenance_visits.completed_at IS 'When the visit was closed (status -> completed); NULL while open or after reopen';

-- Backfill: for already-completed visits, updated_at is the best approximation.
UPDATE maintenance_visits
SET completed_at = updated_at
WHERE status = 'completed' AND completed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_maintenance_visits_completed_at ON maintenance_visits(completed_at);
