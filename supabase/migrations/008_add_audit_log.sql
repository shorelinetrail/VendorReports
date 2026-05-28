-- Append-only audit/event table.
-- Captures every INSERT/UPDATE/DELETE on the core domain tables, who did it
-- (auth.uid(), NULL for service-role/cron actions), and the before/after row.

CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id TEXT,
    action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    actor_id UUID,
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_table_record ON audit_log(table_name, record_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id);

-- Generic trigger function. SECURITY DEFINER so it can write to audit_log even
-- though clients have no INSERT policy on it (entries cannot be forged or edited).
CREATE OR REPLACE FUNCTION record_audit_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor UUID;
BEGIN
    BEGIN
        v_actor := auth.uid();
    EXCEPTION WHEN OTHERS THEN
        v_actor := NULL;
    END;

    IF (TG_OP = 'DELETE') THEN
        INSERT INTO audit_log(table_name, record_id, action, actor_id, old_data, new_data)
        VALUES (TG_TABLE_NAME, OLD.id::text, TG_OP, v_actor, to_jsonb(OLD), NULL);
        RETURN OLD;
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO audit_log(table_name, record_id, action, actor_id, old_data, new_data)
        VALUES (TG_TABLE_NAME, NEW.id::text, TG_OP, v_actor, to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    ELSE
        INSERT INTO audit_log(table_name, record_id, action, actor_id, old_data, new_data)
        VALUES (TG_TABLE_NAME, NEW.id::text, TG_OP, v_actor, NULL, to_jsonb(NEW));
        RETURN NEW;
    END IF;
END;
$$;

-- Attach to every core table.
DROP TRIGGER IF EXISTS audit_users ON users;
CREATE TRIGGER audit_users AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION record_audit_event();

DROP TRIGGER IF EXISTS audit_vendors ON vendors;
CREATE TRIGGER audit_vendors AFTER INSERT OR UPDATE OR DELETE ON vendors
    FOR EACH ROW EXECUTE FUNCTION record_audit_event();

DROP TRIGGER IF EXISTS audit_maintenance_routines ON maintenance_routines;
CREATE TRIGGER audit_maintenance_routines AFTER INSERT OR UPDATE OR DELETE ON maintenance_routines
    FOR EACH ROW EXECUTE FUNCTION record_audit_event();

DROP TRIGGER IF EXISTS audit_maintenance_visits ON maintenance_visits;
CREATE TRIGGER audit_maintenance_visits AFTER INSERT OR UPDATE OR DELETE ON maintenance_visits
    FOR EACH ROW EXECUTE FUNCTION record_audit_event();

DROP TRIGGER IF EXISTS audit_tasks ON tasks;
CREATE TRIGGER audit_tasks AFTER INSERT OR UPDATE OR DELETE ON tasks
    FOR EACH ROW EXECUTE FUNCTION record_audit_event();

DROP TRIGGER IF EXISTS audit_recommendations ON recommendations;
CREATE TRIGGER audit_recommendations AFTER INSERT OR UPDATE OR DELETE ON recommendations
    FOR EACH ROW EXECUTE FUNCTION record_audit_event();

DROP TRIGGER IF EXISTS audit_system_config ON system_config;
CREATE TRIGGER audit_system_config AFTER INSERT OR UPDATE OR DELETE ON system_config
    FOR EACH ROW EXECUTE FUNCTION record_audit_event();

DROP TRIGGER IF EXISTS audit_visit_reports ON visit_reports;
CREATE TRIGGER audit_visit_reports AFTER INSERT OR UPDATE OR DELETE ON visit_reports
    FOR EACH ROW EXECUTE FUNCTION record_audit_event();

-- Enforce append-only: block any UPDATE/DELETE on audit_log itself.
CREATE OR REPLACE FUNCTION prevent_audit_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only; % is not permitted', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_mutation();

-- RLS: only admins may read the audit log. No INSERT/UPDATE/DELETE policies,
-- so the only way rows are created is via the SECURITY DEFINER trigger above.
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view audit log" ON audit_log;
CREATE POLICY "Admins can view audit log" ON audit_log FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);
