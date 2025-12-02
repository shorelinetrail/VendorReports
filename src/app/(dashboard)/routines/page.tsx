'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { MaintenanceRoutine, Vendor, User } from '@/types/database';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import Badge from '@/components/ui/Badge';
import Alert from '@/components/ui/Alert';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';

interface RoutineFormData {
  plan_number: string;
  description: string;
  vendor_id: string;
  interval_months: number;
  start_date: string;
  call_horizon_months: number;
  vendor_coordinator_id: string;
  maintenance_engineer_id: string;
  technical_engineer_id: string;
  is_active: boolean;
}

const initialFormData: RoutineFormData = {
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
};

export default function RoutinesPage() {
  const { hasRole } = useAuth();
  const [routines, setRoutines] = useState<MaintenanceRoutine[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<RoutineFormData>(initialFormData);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const supabase = createClient();

  const canManage = hasRole(['admin', 'vendor_coordinator']);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [routinesRes, vendorsRes, usersRes] = await Promise.all([
        supabase
          .from('maintenance_routines')
          .select(`
            *,
            vendor:vendors(*),
            vendor_coordinator:users!maintenance_routines_vendor_coordinator_id_fkey(*),
            maintenance_engineer:users!maintenance_routines_maintenance_engineer_id_fkey(*),
            technical_engineer:users!maintenance_routines_technical_engineer_id_fkey(*)
          `)
          .order('plan_number'),
        supabase.from('vendors').select('*').order('name'),
        supabase.from('users').select('*').order('full_name'),
      ]);

      if (routinesRes.data) setRoutines(routinesRes.data);
      if (vendorsRes.data) setVendors(vendorsRes.data);
      if (usersRes.data) setUsers(usersRes.data);
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (routine?: MaintenanceRoutine) => {
    if (routine) {
      setEditingId(routine.id);
      setFormData({
        plan_number: routine.plan_number,
        description: routine.description,
        vendor_id: routine.vendor_id,
        interval_months: routine.interval_months,
        start_date: routine.start_date,
        call_horizon_months: routine.call_horizon_months,
        vendor_coordinator_id: routine.vendor_coordinator_id,
        maintenance_engineer_id: routine.maintenance_engineer_id,
        technical_engineer_id: routine.technical_engineer_id,
        is_active: routine.is_active,
      });
    } else {
      setEditingId(null);
      setFormData(initialFormData);
    }
    setError(null);
    setSuccess(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      if (editingId) {
        const { error } = await supabase
          .from('maintenance_routines')
          .update(formData)
          .eq('id', editingId);

        if (error) throw error;
        setSuccess('Routine updated successfully');
      } else {
        const { error } = await supabase
          .from('maintenance_routines')
          .insert(formData);

        if (error) throw error;
        setSuccess('Routine created successfully');
      }

      await fetchData();
      setTimeout(() => {
        setModalOpen(false);
      }, 1000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this routine?')) return;

    try {
      const { error } = await supabase
        .from('maintenance_routines')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await fetchData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const getUsersByRole = (role: string) => {
    return users
      .filter((u) => u.role === role || u.role === 'admin')
      .map((u) => ({ value: u.id, label: u.full_name }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Maintenance Routines</h1>
          <p className="text-gray-600">Manage scheduled maintenance plans</p>
        </div>
        {canManage && (
          <Button onClick={() => handleOpenModal()}>
            <Plus className="w-4 h-4 mr-2" />
            Add Routine
          </Button>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Plan Number</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>Interval</TableHead>
            <TableHead>Next Due</TableHead>
            <TableHead>Status</TableHead>
            <TableHead align="right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {routines.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-gray-500">
                No maintenance routines found.
              </TableCell>
            </TableRow>
          ) : (
            routines.map((routine) => (
              <TableRow key={routine.id}>
                <TableCell className="font-medium">{routine.plan_number}</TableCell>
                <TableCell className="max-w-xs truncate">{routine.description}</TableCell>
                <TableCell>{routine.vendor?.name}</TableCell>
                <TableCell>{routine.interval_months} months</TableCell>
                <TableCell>{format(new Date(routine.start_date), 'MMM d, yyyy')}</TableCell>
                <TableCell>
                  <Badge variant={routine.is_active ? 'success' : 'cancelled'}>
                    {routine.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                <TableCell align="right">
                  <div className="flex items-center justify-end space-x-2">
                    <Button variant="ghost" size="sm" onClick={() => handleOpenModal(routine)}>
                      <Eye className="w-4 h-4" />
                    </Button>
                    {canManage && (
                      <>
                        <Button variant="ghost" size="sm" onClick={() => handleOpenModal(routine)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(routine.id)}>
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Edit Maintenance Routine' : 'Add Maintenance Routine'}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Plan Number"
              name="plan_number"
              value={formData.plan_number}
              onChange={(e) => setFormData({ ...formData, plan_number: e.target.value })}
              required
              placeholder="e.g., MP-001"
            />

            <Select
              label="Vendor"
              name="vendor_id"
              value={formData.vendor_id}
              onChange={(e) => setFormData({ ...formData, vendor_id: e.target.value })}
              required
              options={vendors.map((v) => ({ value: v.id, label: v.name }))}
              placeholder="Select vendor"
            />
          </div>

          <Textarea
            label="Description"
            name="description"
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            required
            placeholder="Describe the maintenance plan..."
            rows={3}
          />

          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Interval (months)"
              name="interval_months"
              type="number"
              min={1}
              value={formData.interval_months}
              onChange={(e) => setFormData({ ...formData, interval_months: parseInt(e.target.value) || 1 })}
              required
            />

            <Input
              label="Start Date"
              name="start_date"
              type="date"
              value={formData.start_date}
              onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
              required
            />

            <Input
              label="Call Horizon (months)"
              name="call_horizon_months"
              type="number"
              min={0}
              value={formData.call_horizon_months}
              onChange={(e) => setFormData({ ...formData, call_horizon_months: parseInt(e.target.value) || 0 })}
              required
              helperText="Months before due date to create visit"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Select
              label="Vendor Coordinator"
              name="vendor_coordinator_id"
              value={formData.vendor_coordinator_id}
              onChange={(e) => setFormData({ ...formData, vendor_coordinator_id: e.target.value })}
              required
              options={getUsersByRole('vendor_coordinator')}
              placeholder="Select coordinator"
            />

            <Select
              label="Maintenance Engineer"
              name="maintenance_engineer_id"
              value={formData.maintenance_engineer_id}
              onChange={(e) => setFormData({ ...formData, maintenance_engineer_id: e.target.value })}
              required
              options={getUsersByRole('maintenance_engineer')}
              placeholder="Select engineer"
            />

            <Select
              label="Technical Engineer"
              name="technical_engineer_id"
              value={formData.technical_engineer_id}
              onChange={(e) => setFormData({ ...formData, technical_engineer_id: e.target.value })}
              required
              options={getUsersByRole('technical_engineer')}
              placeholder="Select engineer"
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_active"
              checked={formData.is_active}
              onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
            />
            <label htmlFor="is_active" className="ml-2 block text-sm text-gray-900">
              Active
            </label>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {editingId ? 'Update' : 'Create'} Routine
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
