'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle, Eye, Trash2, Upload } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useAction } from '@/lib/use-action';
import { confirmVisitDate, deleteVisit } from '@/lib/actions/visits';
import { uploadReport } from '@/lib/actions/reports';
import { formatDateLong } from '@/lib/labels';

interface VisitRowActionsProps {
  visitId: string;
  planNumber: string;
  scheduledDate: string;
  canConfirm: boolean;
  canUpload: boolean;
  canDelete: boolean;
}

export default function VisitRowActions({
  visitId,
  planNumber,
  scheduledDate,
  canConfirm,
  canUpload,
  canDelete,
}: VisitRowActionsProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmedDate, setConfirmedDate] = useState(scheduledDate);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const { pending, run } = useAction();

  return (
    <div className="flex items-center justify-end gap-1">
      <Link href={`/visits/${visitId}`}>
        <Button variant="ghost" size="sm" title="View visit" aria-label={`View visit ${planNumber}`}>
          <Eye className="h-4 w-4" />
        </Button>
      </Link>
      {canConfirm && (
        <Button
          variant="ghost"
          size="sm"
          title="Confirm date"
          aria-label="Confirm visit date"
          onClick={() => setConfirmOpen(true)}
        >
          <CheckCircle className="h-4 w-4 text-green-500" />
        </Button>
      )}
      {canUpload && (
        <Button
          variant="ghost"
          size="sm"
          title="Upload report"
          aria-label="Upload report"
          onClick={() => setUploadOpen(true)}
        >
          <Upload className="h-4 w-4 text-blue-500" />
        </Button>
      )}
      {canDelete && (
        <Button
          variant="ghost"
          size="sm"
          title="Delete visit"
          aria-label="Delete visit"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="h-4 w-4 text-red-500" />
        </Button>
      )}

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Confirm Visit Date">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => confirmVisitDate(visitId, confirmedDate), { onSuccess: () => setConfirmOpen(false) });
          }}
        >
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-sm text-gray-500">Scheduled Date</p>
            <p className="font-medium">{formatDateLong(scheduledDate)}</p>
          </div>
          <Input
            label="Confirmed Visit Date"
            name="confirmed_date"
            type="date"
            required
            value={confirmedDate}
            onChange={(e) => setConfirmedDate(e.target.value)}
          />
          <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row sm:gap-3">
            <Button type="button" variant="secondary" onClick={() => setConfirmOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!confirmedDate} className="w-full sm:w-auto">
              Confirm Date
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={uploadOpen} onClose={() => setUploadOpen(false)} title="Upload Maintenance Report">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) return;
            const formData = new FormData();
            formData.set('visitId', visitId);
            formData.set('file', file);
            formData.set('notes', notes);
            run(() => uploadReport(formData), {
              onSuccess: () => {
                setUploadOpen(false);
                setFile(null);
                setNotes('');
              },
            });
          }}
        >
          <Input
            label="Report File"
            name="report"
            type="file"
            required
            accept=".pdf,.doc,.docx,.xls,.xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <Textarea
            label="Notes (optional)"
            name="notes"
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add any notes about this report…"
          />
          <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row sm:gap-3">
            <Button type="button" variant="secondary" onClick={() => setUploadOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!file} className="w-full sm:w-auto">
              Upload Report
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete Visit"
        message={
          <>
            Delete visit <strong>{planNumber}</strong> scheduled for {formatDateLong(scheduledDate)}? Its tasks,
            recommendations, and uploaded reports will also be permanently deleted.
          </>
        }
        confirmLabel="Delete Visit"
        variant="danger"
        pending={pending}
        onConfirm={() => run(() => deleteVisit(visitId), { onSuccess: () => setDeleteOpen(false) })}
      />
    </div>
  );
}
