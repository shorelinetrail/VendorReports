-- Tighten write policies so users can only modify rows they are assigned to,
-- mirroring the per-visit checks the UI already performs. Read access is left
-- broad (all authenticated users can view).

-- ----- maintenance_visits -----
DROP POLICY IF EXISTS "Admins and coordinators can manage visits" ON maintenance_visits;
DROP POLICY IF EXISTS "Assigned users can update visits" ON maintenance_visits;

-- Admins can do anything.
CREATE POLICY "Admins manage visits" ON maintenance_visits FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Vendor coordinators may create visits (the generator uses the service role
-- and bypasses RLS, so this only covers manual creation in the UI).
CREATE POLICY "Coordinators insert visits" ON maintenance_visits FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'vendor_coordinator')));

-- Assigned team members may update their own visits.
CREATE POLICY "Assigned users update their visits" ON maintenance_visits FOR UPDATE TO authenticated
    USING (
        vendor_coordinator_id = auth.uid()
        OR maintenance_engineer_id = auth.uid()
        OR technical_engineer_id = auth.uid()
    )
    WITH CHECK (
        vendor_coordinator_id = auth.uid()
        OR maintenance_engineer_id = auth.uid()
        OR technical_engineer_id = auth.uid()
    );

-- ----- recommendations -----
DROP POLICY IF EXISTS "Engineers can manage recommendations" ON recommendations;

CREATE POLICY "Admins manage recommendations" ON recommendations FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Only the maintenance/technical engineer assigned to the parent visit may
-- create or modify its recommendations.
CREATE POLICY "Assigned engineers manage recommendations" ON recommendations FOR ALL TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM maintenance_visits v
            WHERE v.id = recommendations.visit_id
              AND (v.maintenance_engineer_id = auth.uid() OR v.technical_engineer_id = auth.uid())
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM maintenance_visits v
            WHERE v.id = recommendations.visit_id
              AND (v.maintenance_engineer_id = auth.uid() OR v.technical_engineer_id = auth.uid())
        )
    );

-- ----- visit_reports -----
-- Migration 005 created this table without RLS. Enable it and scope writes to
-- the assigned vendor coordinator (uploads) and admins (everything).
ALTER TABLE visit_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view visit reports" ON visit_reports;
CREATE POLICY "Authenticated users can view visit reports" ON visit_reports FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Admins manage visit reports" ON visit_reports;
CREATE POLICY "Admins manage visit reports" ON visit_reports FOR ALL TO authenticated
    USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'))
    WITH CHECK (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Assigned coordinator uploads visit reports" ON visit_reports;
CREATE POLICY "Assigned coordinator uploads visit reports" ON visit_reports FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM maintenance_visits v
            WHERE v.id = visit_reports.visit_id
              AND v.vendor_coordinator_id = auth.uid()
        )
    );

-- ----- tasks -----
-- The existing "Assigned users can manage their tasks" policy only lets a user
-- insert tasks assigned to themselves. The workflow needs a team member to
-- create a task for another member on a shared visit (e.g. a maintenance
-- engineer raising a technical_review task for the technical engineer). Add an
-- additive INSERT policy scoped to the visit's assigned team.
DROP POLICY IF EXISTS "Team can create tasks on their visits" ON tasks;
CREATE POLICY "Team can create tasks on their visits" ON tasks FOR INSERT TO authenticated
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
