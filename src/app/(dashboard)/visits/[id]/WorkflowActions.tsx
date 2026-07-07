'use client';

import { useState } from 'react';
import { Calendar, CheckCircle, FileX, RefreshCw, RotateCcw, Upload } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { useAction } from '@/lib/use-action';
import { closeVisit, confirmVisitDate, markNoReport, reopenVisit, rescheduleVisit } from '@/lib/actions/visits';
import { uploadReport } from '@/lib/actions/reports';
import { formatDateLong } from '@/lib/labels';
import type { VisitDetail, VisitPermissions } from './types';

type OpenModal = 'confirm' | 'upload' | 'noReport' | 'reschedule' | 'close' | 'reopen' | null;

export default function WorkflowActions({
  visit,
  permissions,
  reportCount,
}: {
  visit: VisitDetail;
  permissions: VisitPermissions;
  reportCount: number;
}) {
  const [openModal, setOpenModal] = useState<OpenModal>(null);
  const [confirmedDate, setConfirmedDate] = useState(visit.confirmed_date || visit.scheduled_date);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState('');
  const [noReportReason, setNoReportReason] = useState('');
  const [newDate, setNewDate] = useState('');
  const [rescheduleReason, setRescheduleReason] = useState('');
  const { pending, run } = useAction();

  const close = () => setOpenModal(null);

  const hasAnyAction =
    permissions.canConfirmDate ||
    permissions.canUploadReport ||
    permissions.canReschedule ||
    permissions.canCloseVisit ||
    visit.status === 'completed';

  if (!hasAnyAction) return null;

  return (
    <Card>
      <CardHeader className="pb-2 sm:pb-4">
        <CardTitle className="text-base sm:text-lg">Workflow Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2 sm:gap-3">
          {permissions.canConfirmDate && (
            <Button size="sm" onClick={() => setOpenModal('confirm')}>
              <Calendar className="mr-2 h-4 w-4" />
              Confirm Visit Date
            </Button>
          )}
          {permissions.canUploadReport && (
            <>
              <Button size="sm" onClick={() => setOpenModal('upload')}>
                <Upload className="mr-2 h-4 w-4" />
                Upload Report
              </Button>
              {!visit.no_report_reason && reportCount === 0 && (
                <Button size="sm" variant="secondary" onClick={() => setOpenModal('noReport')}>
                  <FileX className="mr-2 h-4 w-4" />
                  No Report Available
                </Button>
              )}
            </>
          )}
          {permissions.canReschedule && (
            <Button size="sm" variant="secondary" onClick={() => setOpenModal('reschedule')}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Reschedule Visit
            </Button>
          )}
          {permissions.canCloseVisit && (
            <Button size="sm" variant="success" onClick={() => setOpenModal('close')}>
              <CheckCircle className="mr-2 h-4 w-4" />
              Close Visit
            </Button>
          )}
          {visit.status === 'completed' && (
            <div className="flex flex-wrap items-center gap-2 sm:gap-4">
              <div className="flex items-center text-green-600">
                <CheckCircle className="mr-1 h-4 w-4 sm:mr-2 sm:h-5 sm:w-5" />
                <span className="text-sm font-medium sm:text-base">Completed</span>
              </div>
              {permissions.canReopenVisit && (
                <Button size="sm" variant="secondary" onClick={() => setOpenModal('reopen')}>
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reopen Visit
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>

      {/* Confirm date */}
      <Modal open={openModal === 'confirm'} onClose={close} title="Confirm Visit Date">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => confirmVisitDate(visit.id, confirmedDate), { onSuccess: close });
          }}
        >
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-sm text-gray-500">Scheduled Date</p>
            <p className="font-medium">{formatDateLong(visit.scheduled_date)}</p>
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
            <Button type="button" variant="secondary" onClick={close} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!confirmedDate} className="w-full sm:w-auto">
              Confirm Date
            </Button>
          </div>
        </form>
      </Modal>

      {/* Upload report */}
      <Modal
        open={openModal === 'upload'}
        onClose={close}
        title={reportCount > 0 ? 'Upload Additional Report' : 'Upload Maintenance Report'}
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!file) return;
            const formData = new FormData();
            formData.set('visitId', visit.id);
            formData.set('file', file);
            formData.set('notes', notes);
            run(() => uploadReport(formData), {
              onSuccess: () => {
                close();
                setFile(null);
                setNotes('');
              },
            });
          }}
        >
          {reportCount > 0 && (
            <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
              This visit already has {reportCount} report{reportCount > 1 ? 's' : ''}. You can upload additional
              reports if needed.
            </div>
          )}
          <Input
            label="Report File"
            name="report"
            type="file"
            required
            accept=".pdf,.doc,.docx,.xls,.xlsx"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            helperText="PDF, Word, or Excel — up to 10 MB"
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
            <Button type="button" variant="secondary" onClick={close} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!file} className="w-full sm:w-auto">
              Upload Report
            </Button>
          </div>
        </form>
      </Modal>

      {/* No report available */}
      <Modal open={openModal === 'noReport'} onClose={close} title="No Report Available">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => markNoReport(visit.id, noReportReason), {
              onSuccess: () => {
                close();
                setNoReportReason('');
              },
            });
          }}
        >
          <p className="text-sm text-gray-600">
            Provide a reason why no maintenance report is available for this visit.
          </p>
          <Textarea
            label="Reason"
            name="no_report_reason"
            required
            rows={3}
            value={noReportReason}
            onChange={(e) => setNoReportReason(e.target.value)}
            placeholder="e.g., Visit was cancelled by vendor, no work performed…"
          />
          <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row sm:gap-3">
            <Button type="button" variant="secondary" onClick={close} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!noReportReason.trim()} className="w-full sm:w-auto">
              Confirm
            </Button>
          </div>
        </form>
      </Modal>

      {/* Reschedule */}
      <Modal open={openModal === 'reschedule'} onClose={close} title="Reschedule Visit">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => rescheduleVisit(visit.id, newDate, rescheduleReason), {
              onSuccess: () => {
                close();
                setNewDate('');
                setRescheduleReason('');
              },
            });
          }}
        >
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-sm text-gray-500">Current Scheduled Date</p>
            <p className="font-medium">{formatDateLong(visit.scheduled_date)}</p>
          </div>
          <Input
            label="New Scheduled Date"
            name="new_date"
            type="date"
            required
            value={newDate}
            onChange={(e) => setNewDate(e.target.value)}
          />
          <Textarea
            label="Reason for Rescheduling"
            name="reason"
            required
            rows={3}
            value={rescheduleReason}
            onChange={(e) => setRescheduleReason(e.target.value)}
            placeholder="Explain why the visit needs to be rescheduled…"
          />
          <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row sm:gap-3">
            <Button type="button" variant="secondary" onClick={close} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!newDate || !rescheduleReason.trim()} className="w-full sm:w-auto">
              Reschedule
            </Button>
          </div>
        </form>
      </Modal>

      {/* Close visit */}
      <ConfirmDialog
        open={openModal === 'close'}
        onClose={close}
        title="Close Visit"
        message="Close this visit? All recommendations are resolved. An admin can reopen it later if needed."
        confirmLabel="Close Visit"
        variant="success"
        pending={pending}
        onConfirm={() => run(() => closeVisit(visit.id), { onSuccess: close })}
      />

      {/* Reopen visit */}
      <ConfirmDialog
        open={openModal === 'reopen'}
        onClose={close}
        title="Reopen Visit"
        message="Reopen this visit? Its status will move back to the recommendations stage so new recommendations can be added."
        confirmLabel="Reopen Visit"
        pending={pending}
        onConfirm={() => run(() => reopenVisit(visit.id), { onSuccess: close })}
      />
    </Card>
  );
}
