-- When a technical review assigns an action to someone, that person must
-- record a response before the recommendation can be completed.
ALTER TABLE recommendations ADD COLUMN action_response TEXT;
ALTER TABLE recommendations ADD COLUMN action_responded_at TEXT;
