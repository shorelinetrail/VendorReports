-- The base policy "Assigned users can manage their tasks" only lets the
-- assignee (or an admin) update a task. The workflow needs a visit's team to
-- advance each other's tasks -- e.g. confirming a date completes the
-- coordinator's task, and closing a visit sweeps the whole team's open tasks.
-- Add an additive UPDATE policy scoped to the visit's assigned team.
DROP POLICY IF EXISTS "Team can update tasks on their visits" ON tasks;
CREATE POLICY "Team can update tasks on their visits" ON tasks FOR UPDATE TO authenticated
    USING (
        assigned_to_id = auth.uid()
        OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
        OR EXISTS (
            SELECT 1 FROM maintenance_visits v
            WHERE v.id = tasks.visit_id
              AND (
                v.vendor_coordinator_id = auth.uid()
                OR v.maintenance_engineer_id = auth.uid()
                OR v.technical_engineer_id = auth.uid()
              )
        )
    )
    WITH CHECK (
        assigned_to_id = auth.uid()
        OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
        OR EXISTS (
            SELECT 1 FROM maintenance_visits v
            WHERE v.id = tasks.visit_id
              AND (
                v.vendor_coordinator_id = auth.uid()
                OR v.maintenance_engineer_id = auth.uid()
                OR v.technical_engineer_id = auth.uid()
              )
        )
    );
