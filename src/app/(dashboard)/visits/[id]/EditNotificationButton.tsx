'use client';

import { useState } from 'react';
import { Edit3 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import { useAction } from '@/lib/use-action';
import { saveNotificationNumber } from '@/lib/actions/visits';

export default function EditNotificationButton({ visitId, value }: { visitId: string; value: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const { pending, run } = useAction();

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setOpen(true);
        }}
        title="Edit notification number"
        aria-label="Edit notification number"
        className="text-primary-600 hover:text-primary-700"
      >
        <Edit3 className="h-3.5 w-3.5" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Edit Notification Number">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveNotificationNumber(visitId, draft), { onSuccess: () => setOpen(false) });
          }}
        >
          <p className="text-sm text-gray-600">
            The notification number is unique to this visit (the maintenance plan covers all of its visits).
          </p>
          <Input
            label="Notification Number"
            name="notification_number"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g., NOT-2026-0042"
          />
          <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row sm:gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={pending} className="w-full sm:w-auto">
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
