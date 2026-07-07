'use client';

import { useState } from 'react';
import { Download, FileText, Trash2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toaster';
import { useAction } from '@/lib/use-action';
import { deleteReport, getReportDownloadUrl } from '@/lib/actions/reports';
import { formatDate } from '@/lib/labels';
import type { ReportDetail } from './types';

export default function ReportsList({
  reports,
  noReportReason,
  canDelete,
}: {
  reports: ReportDetail[];
  noReportReason: string | null;
  canDelete: boolean;
}) {
  const { toast } = useToast();
  const { pending, run } = useAction();
  const [deleteTarget, setDeleteTarget] = useState<ReportDetail | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  async function download(report: ReportDetail) {
    setDownloading(report.id);
    try {
      const result = await getReportDownloadUrl(report.id);
      if (result.ok) {
        window.location.assign(result.url);
      } else {
        toast(result.error, 'error');
      }
    } finally {
      setDownloading(null);
    }
  }

  if (reports.length === 0) {
    return noReportReason ? (
      <div>
        <p className="text-sm font-medium text-amber-600">No report available</p>
        <p className="text-xs text-gray-500 sm:text-sm">{noReportReason}</p>
      </div>
    ) : (
      <p className="text-sm text-gray-400">No reports uploaded</p>
    );
  }

  return (
    <div className="space-y-2">
      {reports.map((report) => (
        <div key={report.id} className="flex items-start justify-between gap-2 rounded-lg bg-gray-50 p-2 sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-2 sm:items-center sm:gap-3">
            <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-gray-400 sm:mt-0 sm:h-5 sm:w-5" />
            <div className="min-w-0">
              <p className="truncate text-xs font-medium sm:text-sm">{report.file_name}</p>
              <p className="text-[10px] text-gray-500 sm:text-xs">
                Uploaded by {report.uploaded_by?.full_name} on {formatDate(report.uploaded_at)}
              </p>
              {report.notes && <p className="mt-1 line-clamp-2 text-[10px] text-gray-500 sm:text-xs">{report.notes}</p>}
            </div>
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title="Download"
              aria-label={`Download ${report.file_name}`}
              loading={downloading === report.id}
              onClick={() => download(report)}
            >
              {downloading !== report.id && <Download className="h-4 w-4" />}
            </Button>
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                title="Delete"
                aria-label={`Delete ${report.file_name}`}
                onClick={() => setDeleteTarget(report)}
              >
                <Trash2 className="h-4 w-4 text-red-500" />
              </Button>
            )}
          </div>
        </div>
      ))}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete Report"
        message={
          <>
            Delete <strong>{deleteTarget?.file_name}</strong>? The file will be permanently removed.
          </>
        }
        confirmLabel="Delete Report"
        variant="danger"
        pending={pending}
        onConfirm={() => {
          if (!deleteTarget) return;
          run(() => deleteReport(deleteTarget.id), { onSuccess: () => setDeleteTarget(null) });
        }}
      />
    </div>
  );
}
