'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Select from '@/components/ui/Select';
import Input from '@/components/ui/Input';
import { useAction } from '@/lib/use-action';
import { createVisit } from '@/lib/actions/visits';

interface CreateVisitButtonProps {
  routines: { id: string; plan_number: string; description: string }[];
}

export default function CreateVisitButton({ routines }: CreateVisitButtonProps) {
  const [open, setOpen] = useState(false);
  const [routineId, setRoutineId] = useState('');
  const [date, setDate] = useState('');
  const { pending, run } = useAction();

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" />
        Create Visit
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Create Visit">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createVisit(routineId, date), {
              onSuccess: () => {
                setOpen(false);
                setRoutineId('');
                setDate('');
              },
            });
          }}
        >
          <Select
            label="Maintenance Routine"
            name="routine"
            required
            value={routineId}
            onChange={(e) => setRoutineId(e.target.value)}
            placeholder="Select routine"
            options={routines.map((r) => ({ value: r.id, label: `${r.plan_number} - ${r.description}` }))}
          />
          <Input
            label="Scheduled Date"
            name="scheduled_date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
          <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row sm:gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!routineId || !date} className="w-full sm:w-auto">
              Create Visit
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
