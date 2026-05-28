-- Ad-hoc / breakdown visits: not tied to a maintenance routine. The vendor and
-- team are chosen directly on the visit, so routine_id becomes optional and the
-- visit carries its own vendor_id, a description/reason, a breakdown flag, and a
-- per-visit technical-review setting (routine visits inherit this from the
-- routine; for ad-hoc visits it lives on the visit).

ALTER TABLE maintenance_visits ALTER COLUMN routine_id DROP NOT NULL;

ALTER TABLE maintenance_visits
    ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES vendors(id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS is_adhoc BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS adhoc_description TEXT,
    ADD COLUMN IF NOT EXISTS adhoc_reason TEXT,
    ADD COLUMN IF NOT EXISTS requires_technical_review BOOLEAN;

COMMENT ON COLUMN maintenance_visits.vendor_id IS 'Vendor for ad-hoc visits (routine visits derive the vendor from their routine)';
COMMENT ON COLUMN maintenance_visits.is_adhoc IS 'True for ad-hoc/breakdown visits created outside a routine';
COMMENT ON COLUMN maintenance_visits.requires_technical_review IS 'Per-visit technical-review setting for ad-hoc visits; NULL for routine visits (which use the routine setting)';
