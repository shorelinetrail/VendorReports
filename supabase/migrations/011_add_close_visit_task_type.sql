-- The application references a 'close_visit' task type (TypeScript TaskType and
-- the visit close handler) but it was never added to the SQL enum in migration
-- 001. Add it so close_visit tasks can be inserted, not just updated.
ALTER TYPE task_type ADD VALUE IF NOT EXISTS 'close_visit';
