'use server';

import { revalidatePath } from 'next/cache';
import { requireAuth, hasRole } from '@/lib/auth';
import { ok, err, type ActionResult } from '@/lib/action-result';
import type { VisitStatus } from '@/types/database';

const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx'];
const MAX_SIZE = 10 * 1024 * 1024; // matches the storage bucket limit

export async function uploadReport(formData: FormData): Promise<ActionResult> {
  const { supabase, profile } = await requireAuth();

  const visitId = String(formData.get('visitId') ?? '');
  const notes = String(formData.get('notes') ?? '').trim();
  const file = formData.get('file');
  if (!visitId || !(file instanceof File) || file.size === 0) return err('Choose a file to upload');
  if (file.size > MAX_SIZE) return err('File is larger than 10 MB');

  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return err(`Unsupported file type .${ext} — use PDF, Word, or Excel`);
  }

  const { data: visit } = await supabase
    .from('maintenance_visits')
    .select('id, status, vendor_coordinator_id')
    .eq('id', visitId)
    .single();
  if (!visit) return err('Visit not found');
  if (visit.status === 'completed' || visit.status === 'cancelled') return err('Visit is closed');
  if (visit.vendor_coordinator_id !== profile.id && !hasRole(profile, 'admin')) {
    return err('Only the assigned vendor coordinator can upload reports');
  }

  // First path segment is the visit id so the storage RLS policy can scope
  // uploads to the visit's assigned coordinator.
  const filePath = `${visitId}/${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('reports').upload(filePath, file);
  if (uploadError) return err(uploadError.message);

  const { error: insertError } = await supabase.from('visit_reports').insert({
    visit_id: visitId,
    file_path: filePath,
    file_name: file.name,
    uploaded_by_id: profile.id,
    uploaded_at: new Date().toISOString(),
    notes: notes || null,
  });
  if (insertError) {
    await supabase.storage.from('reports').remove([filePath]);
    return err(insertError.message);
  }

  if (visit.status === 'date_confirmed') {
    await supabase
      .from('maintenance_visits')
      .update({ status: 'report_uploaded' satisfies VisitStatus })
      .eq('id', visitId);
  }

  revalidatePath('/', 'layout');
  return ok('Report uploaded');
}

export async function deleteReport(reportId: string): Promise<ActionResult> {
  const { supabase, profile } = await requireAuth();
  if (!hasRole(profile, 'admin')) return err('Only admins can delete reports');

  const { data: report } = await supabase
    .from('visit_reports')
    .select('id, visit_id, file_path')
    .eq('id', reportId)
    .single();
  if (!report) return err('Report not found');

  const { error: storageError } = await supabase.storage.from('reports').remove([report.file_path]);
  if (storageError) console.warn('Could not delete file from storage:', storageError.message);

  const { error } = await supabase.from('visit_reports').delete().eq('id', reportId);
  if (error) return err(error.message);

  // If that was the last report and the visit hadn't progressed further,
  // roll back so a new report can be uploaded.
  const { count } = await supabase
    .from('visit_reports')
    .select('id', { count: 'exact', head: true })
    .eq('visit_id', report.visit_id);
  if ((count ?? 0) === 0) {
    await supabase
      .from('maintenance_visits')
      .update({ status: 'date_confirmed' satisfies VisitStatus })
      .eq('id', report.visit_id)
      .eq('status', 'report_uploaded');
  }

  revalidatePath('/', 'layout');
  return ok('Report deleted');
}

export async function getReportDownloadUrl(
  reportId: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { supabase } = await requireAuth();

  const { data: report } = await supabase
    .from('visit_reports')
    .select('file_path, file_name')
    .eq('id', reportId)
    .single();
  if (!report) return { ok: false, error: 'Report not found' };

  const { data, error } = await supabase.storage
    .from('reports')
    .createSignedUrl(report.file_path, 60, { download: report.file_name });
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not create download link' };

  return { ok: true, url: data.signedUrl };
}
