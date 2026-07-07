'use client';

import { useState } from 'react';
import { Users } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Select from '@/components/ui/Select';
import { useAction } from '@/lib/use-action';
import { reassignTeam } from '@/lib/actions/visits';
import type { UserOption } from './types';

interface Team {
  vendor_coordinator_id: string;
  maintenance_engineer_id: string;
  technical_engineer_id: string;
}

export default function ReassignButton({
  visitId,
  users,
  current,
}: {
  visitId: string;
  users: UserOption[];
  current: Team;
}) {
  const [open, setOpen] = useState(false);
  const [team, setTeam] = useState<Team>(current);
  const { pending, run } = useAction();

  const optionsFor = (role: string) =>
    users
      .filter((u) => u.role === role || u.role === 'admin')
      .map((u) => ({ value: u.id, label: u.full_name }));

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2"
        onClick={() => {
          setTeam(current);
          setOpen(true);
        }}
      >
        <Users className="h-4 w-4 sm:mr-1" />
        <span className="hidden sm:inline">Reassign</span>
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Reassign Team Members" size="lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => reassignTeam(visitId, team), { onSuccess: () => setOpen(false) });
          }}
        >
          <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
            Open tasks assigned to replaced team members are moved to their successors automatically.
          </div>
          <Select
            label="Vendor Coordinator"
            name="vendor_coordinator_id"
            required
            value={team.vendor_coordinator_id}
            onChange={(e) => setTeam({ ...team, vendor_coordinator_id: e.target.value })}
            placeholder="Select Vendor Coordinator"
            options={optionsFor('vendor_coordinator')}
          />
          <Select
            label="Maintenance Engineer"
            name="maintenance_engineer_id"
            required
            value={team.maintenance_engineer_id}
            onChange={(e) => setTeam({ ...team, maintenance_engineer_id: e.target.value })}
            placeholder="Select Maintenance Engineer"
            options={optionsFor('maintenance_engineer')}
          />
          <Select
            label="Technical Engineer"
            name="technical_engineer_id"
            required
            value={team.technical_engineer_id}
            onChange={(e) => setTeam({ ...team, technical_engineer_id: e.target.value })}
            placeholder="Select Technical Engineer"
            options={optionsFor('technical_engineer')}
          />
          <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row sm:gap-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={pending} className="w-full sm:w-auto">
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
