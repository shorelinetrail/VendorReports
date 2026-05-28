-- Allow any assigned team member (vendor coordinator, maintenance engineer or
-- technical engineer) -- not just the coordinator -- to upload reports for
-- their visit. Engineers are permitted to upload but are not assigned upload
-- tasks. Admins continue to be covered by the "Admins manage..." policies.

-- visit_reports row insert
DROP POLICY IF EXISTS "Assigned coordinator uploads visit reports" ON visit_reports;
DROP POLICY IF EXISTS "Assigned team uploads visit reports" ON visit_reports;
CREATE POLICY "Assigned team uploads visit reports" ON visit_reports FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM maintenance_visits v
            WHERE v.id = visit_reports.visit_id
              AND (
                v.vendor_coordinator_id = auth.uid()
                OR v.maintenance_engineer_id = auth.uid()
                OR v.technical_engineer_id = auth.uid()
              )
        )
    );

-- storage object insert (object key is "<visit_id>/<file>")
DROP POLICY IF EXISTS "Coordinators upload reports for their visits" ON storage.objects;
DROP POLICY IF EXISTS "Assigned team uploads reports for their visits" ON storage.objects;
CREATE POLICY "Assigned team uploads reports for their visits" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'reports'
    AND (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
        OR EXISTS (
            SELECT 1 FROM public.maintenance_visits v
            WHERE v.id::text = (storage.foldername(name))[1]
              AND (
                v.vendor_coordinator_id = auth.uid()
                OR v.maintenance_engineer_id = auth.uid()
                OR v.technical_engineer_id = auth.uid()
              )
        )
    )
);
