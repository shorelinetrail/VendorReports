-- Support explicit visit cancellation (replacing destructive deletes) and a
-- dedicated completion timestamp (so "completed this month" is exact rather
-- than inferred from updated_at).

ALTER TABLE maintenance_visits
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancellation_reason TEXT,
    ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Backfill completed_at for already-completed visits using updated_at as a
-- best-effort approximation.
UPDATE maintenance_visits
SET completed_at = updated_at
WHERE status = 'completed' AND completed_at IS NULL;
