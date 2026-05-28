'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Eye, Upload, Download, Archive, ArchiveRestore } from 'lucide-react';
import { format, addMonths } from 'date-fns';
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
  requires_technical_review: boolean;
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
  requires_technical_review: true,
};

interface RoutineVisit {
  routine_id: string;
  scheduled_date: string;
  status: string;
}

export default function RoutinesPage() {
  const { hasRole } = useAuth();
  const [routines, setRoutines] = useState<MaintenanceRoutine[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [routineVisits, setRoutineVisits] = useState<Record<string, RoutineVisit[]>>({});
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<RoutineFormData>(initialFormData);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bulkUploadModalOpen, setBulkUploadModalOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkUploadResults, setBulkUploadResults] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const supabase = createClient();

  const canManage = hasRole(['admin', 'vendor_coordinator']);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [routinesRes, vendorsRes, usersRes, visitsRes] = await Promise.all([
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
        supabase
          .from('maintenance_visits')
          .select('routine_id, scheduled_date, status')
          .order('scheduled_date', { ascending: false }),
      ]);

      if (routinesRes.data) setRoutines(routinesRes.data);
      if (vendorsRes.data) setVendors(vendorsRes.data);
      if (usersRes.data) setUsers(usersRes.data);

      // Group visits by routine_id
      if (visitsRes.data) {
        const grouped: Record<string, RoutineVisit[]> = {};
        visitsRes.data.forEach((visit: RoutineVisit) => {
          if (!grouped[visit.routine_id]) {
            grouped[visit.routine_id] = [];
          }
          grouped[visit.routine_id].push(visit);
        });
        setRoutineVisits(grouped);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Calculate next due date for a routine based on visits
  const getNextDueDate = (routine: MaintenanceRoutine): Date => {
    const visits = routineVisits[routine.id] || [];

    // Find the latest completed or scheduled visit
    const latestVisit = visits.find(v => v.status === 'completed') || visits[0];

    if (latestVisit) {
      // If there's a completed visit, next due is that date + interval
      // If it's just scheduled, show that scheduled date
      if (latestVisit.status === 'completed') {
        return addMonths(new Date(latestVisit.scheduled_date), routine.interval_months);
      }
      // Return the next scheduled visit date
      return new Date(latestVisit.scheduled_date);
    }

    // No visits yet, use start_date
    return new Date(routine.start_date);
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
        requires_technical_review: routine.requires_technical_review ?? true,
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

  // Archive (deactivate) a routine rather than destructively deleting it and
  // its history. Inactive routines are skipped by the visit generator.
  const handleToggleActive = async (routine: MaintenanceRoutine) => {
    const deactivating = routine.is_active;
    if (deactivating && !confirm('Archive this routine?\n\nIt will be marked inactive and no new visits will be generated for it. Existing visits, tasks, and recommendations are kept. You can reactivate it later.')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('maintenance_routines')
        .update({ is_active: !routine.is_active })
        .eq('id', routine.id);

      if (error) throw error;
      await fetchData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const getUsersByRole = (role: string) => {
    return users
      .filter((u) => (u.role === role || u.role === 'admin') && u.is_active !== false)
      .map((u) => ({ value: u.id, label: u.full_name }));
  };

  const handleDownloadTemplate = () => {
    const headers = [
      'plan_number',
      'description',
      'vendor_name',
      'interval_months',
      'start_date',
      'call_horizon_months',
      'vendor_coordinator_email',
      'maintenance_engineer_email',
      'technical_engineer_email',
      'is_active',
      'requires_technical_review',
    ];

    const exampleRow = [
      'MP-001',
      'Annual maintenance for equipment XYZ',
      vendors[0]?.name || 'Vendor Name',
      '12',
      format(new Date(), 'yyyy-MM-dd'),
      '1',
      users.find(u => u.role === 'vendor_coordinator')?.email || 'coordinator@example.com',
      users.find(u => u.role === 'maintenance_engineer')?.email || 'engineer@example.com',
      users.find(u => u.role === 'technical_engineer')?.email || 'tech@example.com',
      'true',
      'true',
    ];

    const csv = [headers.join(','), exampleRow.join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'maintenance-plans-template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBulkUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkFile) return;

    setError(null);
    setSuccess(null);
    setSubmitting(true);
    setBulkUploadResults(null);

    try {
      const text = await bulkFile.text();
      const lines = text.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());

      const results = { success: 0, failed: 0, errors: [] as string[] };

      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.trim());
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = values[idx] || '';
        });

        try {
          // Look up vendor by name
          const vendor = vendors.find(v => v.name.toLowerCase() === row.vendor_name?.toLowerCase());
          if (!vendor) {
            results.errors.push(`Row ${i + 1}: Vendor "${row.vendor_name}" not found`);
            results.failed++;
            continue;
          }

          // Look up users by email
          const coordinator = users.find(u => u.email?.toLowerCase() === row.vendor_coordinator_email?.toLowerCase());
          const maintEngineer = users.find(u => u.email?.toLowerCase() === row.maintenance_engineer_email?.toLowerCase());
          const techEngineer = users.find(u => u.email?.toLowerCase() === row.technical_engineer_email?.toLowerCase());

          if (!coordinator) {
            results.errors.push(`Row ${i + 1}: Vendor coordinator "${row.vendor_coordinator_email}" not found`);
            results.failed++;
            continue;
          }
          if (!maintEngineer) {
            results.errors.push(`Row ${i + 1}: Maintenance engineer "${row.maintenance_engineer_email}" not found`);
            results.failed++;
            continue;
          }
          if (!techEngineer) {
            results.errors.push(`Row ${i + 1}: Technical engineer "${row.technical_engineer_email}" not found`);
            results.failed++;
            continue;
          }

          // Insert the routine
          const { error: insertError } = await supabase.from('maintenance_routines').insert({
            plan_number: row.plan_number,
            description: row.description,
            vendor_id: vendor.id,
            interval_months: parseInt(row.interval_months) || 12,
            start_date: row.start_date,
            call_horizon_months: parseInt(row.call_horizon_months) || 1,
            vendor_coordinator_id: coordinator.id,
            maintenance_engineer_id: maintEngineer.id,
            technical_engineer_id: techEngineer.id,
            is_active: row.is_active?.toLowerCase() !== 'false',
            requires_technical_review: row.requires_technical_review?.toLowerCase() !== 'false',
          });

          if (insertError) {
            results.errors.push(`Row ${i + 1}: ${insertError.message}`);
            results.failed++;
          } else {
            results.success++;
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          results.errors.push(`Row ${i + 1}: ${message}`);
          results.failed++;
        }
      }

      setBulkUploadResults(results);
      if (results.success > 0) {
        setSuccess(`Successfully imported ${results.success} maintenance plan(s)`);
        await fetchData();
      }
      if (results.failed > 0) {
        setError(`Failed to import ${results.failed} row(s). See details below.`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
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
          <div className="flex items-center space-x-3">
            <Button variant="secondary" onClick={() => setBulkUploadModalOpen(true)}>
              <Upload className="w-4 h-4 mr-2" />
              Bulk Upload
            </Button>
            <Button onClick={() => handleOpenModal()}>
              <Plus className="w-4 h-4 mr-2" />
              Add Routine
            </Button>
          </div>
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
                <TableCell>
                  {(() => {
                    const nextDue = getNextDueDate(routine);
                    const isPast = nextDue < new Date();
                    return (
                      <span className={isPast ? 'text-red-600 font-medium' : ''}>
                        {format(nextDue, 'MMM d, yyyy')}
                      </span>
                    );
                  })()}
                </TableCell>
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
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(routine)}
                          title={routine.is_active ? 'Archive (deactivate)' : 'Reactivate'}
                        >
                          {routine.is_active ? (
                            <Archive className="w-4 h-4 text-red-500" />
                          ) : (
                            <ArchiveRestore className="w-4 h-4 text-green-600" />
                          )}
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
              options={vendors
                .filter((v) => v.is_active !== false || v.id === formData.vendor_id)
                .map((v) => ({ value: v.id, label: v.name }))}
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

          <div className="flex items-center space-x-6">
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

            <div className="flex items-center">
              <input
                type="checkbox"
                id="requires_technical_review"
                checked={formData.requires_technical_review}
                onChange={(e) => setFormData({ ...formData, requires_technical_review: e.target.checked })}
                className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
              />
              <label htmlFor="requires_technical_review" className="ml-2 block text-sm text-gray-900">
                Requires Technical Review
              </label>
            </div>
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

      {/* Bulk Upload Modal */}
      <Modal
        isOpen={bulkUploadModalOpen}
        onClose={() => {
          setBulkUploadModalOpen(false);
          setBulkFile(null);
          setBulkUploadResults(null);
          setError(null);
          setSuccess(null);
        }}
        title="Bulk Upload Maintenance Plans"
        size="lg"
      >
        <form onSubmit={handleBulkUpload} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <div className="bg-gray-50 p-4 rounded-lg space-y-3">
            <p className="text-sm text-gray-600">
              Upload a CSV file with maintenance plans. Each row will create a new maintenance routine.
            </p>
            <Button type="button" variant="secondary" size="sm" onClick={handleDownloadTemplate}>
              <Download className="w-4 h-4 mr-2" />
              Download Template
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-gray-700">Required Columns:</p>
            <ul className="text-xs text-gray-500 list-disc list-inside space-y-1">
              <li><strong>plan_number</strong> - Unique identifier (e.g., MP-001)</li>
              <li><strong>description</strong> - Description of the maintenance plan</li>
              <li><strong>vendor_name</strong> - Name of the vendor (must exist in system)</li>
              <li><strong>interval_months</strong> - Maintenance interval in months</li>
              <li><strong>start_date</strong> - Start date (YYYY-MM-DD format)</li>
              <li><strong>call_horizon_months</strong> - Months before due date to create visit</li>
              <li><strong>vendor_coordinator_email</strong> - Email of vendor coordinator</li>
              <li><strong>maintenance_engineer_email</strong> - Email of maintenance engineer</li>
              <li><strong>technical_engineer_email</strong> - Email of technical engineer</li>
              <li><strong>is_active</strong> - true/false</li>
              <li><strong>requires_technical_review</strong> - true/false</li>
            </ul>
          </div>

          <Input
            label="CSV File"
            name="csv_file"
            type="file"
            accept=".csv"
            onChange={(e) => setBulkFile(e.target.files?.[0] || null)}
            required
          />

          {bulkUploadResults && bulkUploadResults.errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 max-h-48 overflow-y-auto">
              <p className="text-sm font-medium text-red-800 mb-2">
                Import Errors ({bulkUploadResults.errors.length}):
              </p>
              <ul className="text-xs text-red-700 space-y-1">
                {bulkUploadResults.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setBulkUploadModalOpen(false);
                setBulkFile(null);
                setBulkUploadResults(null);
                setError(null);
                setSuccess(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!bulkFile}>
              <Upload className="w-4 h-4 mr-2" />
              Upload & Import
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
