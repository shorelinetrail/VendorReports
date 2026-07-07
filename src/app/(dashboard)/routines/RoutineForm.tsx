'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import { useAction } from '@/lib/use-action';
import { saveRoutine, type RoutineInput } from '@/lib/actions/routines';
import type { UserRole } from '@/types/database';

export interface VendorOption {
  id: string;
  name: string;
  is_active: boolean;
}

export interface UserSelectOption {
  id: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
}

export const EMPTY_ROUTINE: RoutineInput = {
  plan_number: '',
  description: '',
  vendor_id: '',
  interval_months: 12,
  start_date: '',
  call_horizon_months: 1,
  vendor_coordinator_id: '',
  maintenance_engineer_id: '',
  technical_engineer_id: '',
  is_active: true,
  requires_technical_review: true,
};

interface RoutineFormProps {
  open: boolean;
  onClose: () => void;
  editingId: string | null;
  initial: RoutineInput;
  vendors: VendorOption[];
  users: UserSelectOption[];
}

export default function RoutineForm({ open, onClose, editingId, initial, vendors, users }: RoutineFormProps) {
  const [form, setForm] = useState<RoutineInput>(initial);
  const { pending, run } = useAction();

  // Users for a role slot: active users of that role (admins included), plus
  // the currently-assigned user even if deactivated, so edits don't silently
  // drop them from the dropdown.
  const usersForRole = (role: UserRole, currentId: string) =>
    users
      .filter((u) => ((u.role === role || u.role === 'admin') && u.is_active) || u.id === currentId)
      .map((u) => ({ value: u.id, label: u.full_name }));

  const vendorOptions = vendors
    .filter((v) => v.is_active || v.id === form.vendor_id)
    .map((v) => ({ value: v.id, label: v.name }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingId ? 'Edit Maintenance Routine' : 'Add Maintenance Routine'}
      size="lg"
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => saveRoutine(editingId, form), { onSuccess: onClose });
        }}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          <Input
            label="Plan Number"
            name="plan_number"
            required
            value={form.plan_number}
            onChange={(e) => setForm({ ...form, plan_number: e.target.value })}
            placeholder="e.g., MP-001"
          />
          <Select
            label="Vendor"
            name="vendor_id"
            required
            value={form.vendor_id}
            onChange={(e) => setForm({ ...form, vendor_id: e.target.value })}
            placeholder="Select vendor"
            options={vendorOptions}
          />
        </div>
        <Textarea
          label="Description"
          name="description"
          required
          rows={3}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder="Describe the maintenance plan…"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <Input
            label="Interval (months)"
            name="interval_months"
            type="number"
            min={1}
            required
            value={form.interval_months}
            onChange={(e) => setForm({ ...form, interval_months: parseInt(e.target.value, 10) || 1 })}
          />
          <Input
            label="Start Date"
            name="start_date"
            type="date"
            required
            value={form.start_date}
            onChange={(e) => setForm({ ...form, start_date: e.target.value })}
          />
          <Input
            label="Call Horizon (months)"
            name="call_horizon_months"
            type="number"
            min={0}
            required
            value={form.call_horizon_months}
            onChange={(e) => setForm({ ...form, call_horizon_months: parseInt(e.target.value, 10) || 0 })}
            helperText="Months ahead to create visits"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <Select
            label="Vendor Coordinator"
            name="vendor_coordinator_id"
            required
            value={form.vendor_coordinator_id}
            onChange={(e) => setForm({ ...form, vendor_coordinator_id: e.target.value })}
            placeholder="Select coordinator"
            options={usersForRole('vendor_coordinator', form.vendor_coordinator_id)}
          />
          <Select
            label="Maintenance Engineer"
            name="maintenance_engineer_id"
            required
            value={form.maintenance_engineer_id}
            onChange={(e) => setForm({ ...form, maintenance_engineer_id: e.target.value })}
            placeholder="Select engineer"
            options={usersForRole('maintenance_engineer', form.maintenance_engineer_id)}
          />
          <Select
            label="Technical Engineer"
            name="technical_engineer_id"
            required
            value={form.technical_engineer_id}
            onChange={(e) => setForm({ ...form, technical_engineer_id: e.target.value })}
            placeholder="Select engineer"
            options={usersForRole('technical_engineer', form.technical_engineer_id)}
          />
        </div>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            Active
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={form.requires_technical_review}
              onChange={(e) => setForm({ ...form, requires_technical_review: e.target.checked })}
              className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            Requires Technical Review
          </label>
        </div>
        <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row sm:gap-3">
          <Button type="button" variant="secondary" onClick={onClose} className="w-full sm:w-auto">
            Cancel
          </Button>
          <Button type="submit" loading={pending} className="w-full sm:w-auto">
            {editingId ? 'Update Routine' : 'Create Routine'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
