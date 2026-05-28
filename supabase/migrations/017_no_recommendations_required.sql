-- Let the maintenance engineer explicitly finish the recommendation phase,
-- either by finalising the recommendations they created ("all recommendations
-- created") or by declaring that none are required. When the routine requires
-- technical review, the "none required" declaration must be approved by the
-- technical engineer before the visit can be closed.

ALTER TABLE maintenance_visits
    ADD COLUMN IF NOT EXISTS recommendations_complete BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS no_recommendations_required BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS no_recommendations_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS no_recommendations_approved BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS no_recommendations_reviewed_by_id UUID REFERENCES users(id),
    ADD COLUMN IF NOT EXISTS no_recommendations_reviewed_at TIMESTAMPTZ;

COMMENT ON COLUMN maintenance_visits.recommendations_complete IS 'Maintenance engineer has finished the recommendation phase (created all, or declared none required)';
COMMENT ON COLUMN maintenance_visits.no_recommendations_required IS 'Maintenance engineer declared that no recommendations are required';
COMMENT ON COLUMN maintenance_visits.no_recommendations_approved IS 'Technical engineer approved the no-recommendations declaration (auto-true when the routine does not require technical review)';
