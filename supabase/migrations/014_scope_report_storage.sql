-- Tighten the 'reports' storage bucket.
--
-- Previously any authenticated user could upload any object to the bucket
-- (migration 001). Uploads now use an object key of "<visit_id>/<file>", so we
-- can require that the uploader is the visit's assigned vendor coordinator (or
-- an admin). View stays broad (all authenticated); delete stays admin-only.
-- Existing objects keyed as "reports/<file>" remain downloadable via their
-- stored file_path; this only governs new uploads.

DROP POLICY IF EXISTS "Authenticated users can upload reports" ON storage.objects;

CREATE POLICY "Coordinators upload reports for their visits" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
    bucket_id = 'reports'
    AND (
        EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin')
        OR EXISTS (
            SELECT 1 FROM public.maintenance_visits v
            WHERE v.id::text = (storage.foldername(name))[1]
              AND v.vendor_coordinator_id = auth.uid()
        )
    )
);

-- Restrict file size (10 MB, matching next.config bodySizeLimit) and the
-- document types the upload UI accepts.
UPDATE storage.buckets
SET
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY[
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    ]
WHERE id = 'reports';
