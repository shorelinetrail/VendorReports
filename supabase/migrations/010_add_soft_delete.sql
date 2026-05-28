-- Soft-delete support for entities with history. Routines already have
-- is_active; add the same to users and vendors so they can be archived
-- (deactivated) instead of hard-deleted.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE vendors ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
