'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Upload, Eye, CheckCircle, XCircle, AlertTriangle } from 'lucide-react';
import { format, addMonths, isBefore } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { completeVisitTasks, createUploadReportTask, createRecommendationsTask } from '@/lib/workflow/tasks';
import { MaintenanceVisit, MaintenanceRoutine, VisitStatus, Vendor, User } from '@/types/database';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import Badge from '@/components/ui/Badge';
import Alert from '@/components/ui/Alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import Link from 'next/link';

interface VisitWithDetails extends Omit<MaintenanceVisit, 'routine' | 'vendor' | 'vendor_coordinator' | 'maintenance_engineer' | 'technical_engineer'> {
  routine: (MaintenanceRoutine & {
    vendor: { name: string };
  }) | null;
  vendor: { name: string } | null;
  vendor_coordinator: { full_name: string };
  maintenance_engineer: { full_name: string };
  technical_engineer: { full_name: string };
}

export default function VisitsPage() {
  const router = useRouter();
  const { userProfile, hasRole } = useAuth();
  const [visits, setVisits] = useState<VisitWithDetails[]>([]);
  const [routines, setRoutines] = useState<MaintenanceRoutine[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [breakdownModalOpen, setBreakdownModalOpen] = useState(false);
  const [breakdownData, setBreakdownData] = useState({
    vendor_id: '', scheduled_date: '', description: '', reason: '',
    vendor_coordinator_id: '', maintenance_engineer_id: '', technical_engineer_id: '',
    requires_technical_review: true,
  });
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [selectedVisit, setSelectedVisit] = useState<VisitWithDetails | null>(null);
  const [selectedRoutine, setSelectedRoutine] = useState<string>('');
  const [scheduledDate, setScheduledDate] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const supabase = createClient();

  const canManage = hasRole(['admin', 'vendor_coordinator']);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [visitsRes, routinesRes, vendorsRes, usersRes] = await Promise.all([
        supabase
          .from('maintenance_visits')
          .select(`
            *,
            routine:maintenance_routines(
              *,
              vendor:vendors(name)
            ),
            vendor:vendors!maintenance_visits_vendor_id_fkey(name),
            vendor_coordinator:users!maintenance_visits_vendor_coordinator_id_fkey(full_name),
            maintenance_engineer:users!maintenance_visits_maintenance_engineer_id_fkey(full_name),
            technical_engineer:users!maintenance_visits_technical_engineer_id_fkey(full_name)
          `)
          .order('scheduled_date', { ascending: false }),
        supabase
          .from('maintenance_routines')
          .select('*')
          .eq('is_active', true)
          .order('plan_number'),
        supabase.from('vendors').select('*').eq('is_active', true).order('name'),
        supabase.from('users').select('*').order('full_name'),
      ]);

      if (visitsRes.data) setVisits(visitsRes.data as unknown as VisitWithDetails[]);
      if (routinesRes.data) setRoutines(routinesRes.data);
      if (vendorsRes.data) setVendors(vendorsRes.data);
      if (usersRes.data) setUsers(usersRes.data);
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const routine = routines.find((r) => r.id === selectedRoutine);
      if (!routine) throw new Error('Routine not found');

      const { error } = await supabase.from('maintenance_visits').insert({
        routine_id: selectedRoutine,
        scheduled_date: scheduledDate,
        status: 'scheduled' as VisitStatus,
        vendor_coordinator_id: routine.vendor_coordinator_id,
        maintenance_engineer_id: routine.maintenance_engineer_id,
        technical_engineer_id: routine.technical_engineer_id,
      });

      if (error) throw error;

      setSuccess('Visit created successfully');
      await fetchData();
      setTimeout(() => {
        setCreateModalOpen(false);
        setSelectedRoutine('');
        setScheduledDate('');
      }, 1000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateBreakdown = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const response = await fetch('/api/visits/breakdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(breakdownData),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to create breakdown visit');

      setSuccess('Breakdown visit created');
      await fetchData();
      setTimeout(() => {
        setBreakdownModalOpen(false);
        setBreakdownData({
          vendor_id: '', scheduled_date: '', description: '', reason: '',
          vendor_coordinator_id: '', maintenance_engineer_id: '', technical_engineer_id: '',
          requires_technical_review: true,
        });
        if (result.id) router.push(`/visits/${result.id}`);
      }, 800);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const usersByRole = (role: string) =>
    users.filter(u => (u.role === role || u.role === 'admin') && u.is_active !== false);

  const handleUploadReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVisit || !file || !userProfile) return;

    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const fileExt = file.name.split('.').pop();
      // First path segment is the visit id so the storage RLS policy can scope
      // uploads to the visit's assigned coordinator.
      const filePath = `${selectedVisit.id}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('reports')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { error: insertError } = await supabase
        .from('visit_reports')
        .insert({
          visit_id: selectedVisit.id,
          file_path: filePath,
          file_name: file.name,
          uploaded_by_id: userProfile.id,
          uploaded_at: new Date().toISOString(),
          notes: null,
        });

      if (insertError) throw insertError;

      // Advance the visit to report_uploaded if it was awaiting a report.
      if (selectedVisit.status === 'date_confirmed') {
        const { error: updateError } = await supabase
          .from('maintenance_visits')
          .update({ status: 'report_uploaded' as VisitStatus })
          .eq('id', selectedVisit.id);

        if (updateError) throw updateError;

        await completeVisitTasks(supabase, selectedVisit.id, ['upload_report']);
        await createRecommendationsTask(supabase, selectedVisit.id, selectedVisit.maintenance_engineer_id);
      }

      setSuccess('Report uploaded successfully');
      await fetchData();
      setTimeout(() => {
        setUploadModalOpen(false);
        setSelectedVisit(null);
        setFile(null);
      }, 1000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmDate = async (visit: VisitWithDetails) => {
    const confirmedDate = prompt('Enter confirmed visit date (YYYY-MM-DD):', visit.scheduled_date);
    if (!confirmedDate) return;

    try {
      const { error } = await supabase
        .from('maintenance_visits')
        .update({
          confirmed_date: confirmedDate,
          confirmed_at: new Date().toISOString(),
          status: 'date_confirmed' as VisitStatus,
        })
        .eq('id', visit.id);

      if (error) throw error;

      await completeVisitTasks(supabase, visit.id, ['confirm_visit_date']);
      await createUploadReportTask(supabase, visit.id, visit.vendor_coordinator_id, new Date(confirmedDate));

      await fetchData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const handleUpdateStatus = async (visitId: string, status: VisitStatus) => {
    try {
      const { error } = await supabase
        .from('maintenance_visits')
        .update({ status })
        .eq('id', visitId);

      if (error) throw error;
      await fetchData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  // Cancel a visit (soft) rather than destructively deleting it and its history.
  const handleCancelVisit = async (visit: VisitWithDetails) => {
    const reason = prompt(`Cancel the visit for ${visit.routine?.plan_number}?\n\nIt will be archived (its history is kept). Optionally enter a reason:`);
    if (reason === null) return;

    try {
      const { error } = await supabase
        .from('maintenance_visits')
        .update({
          status: 'cancelled' as VisitStatus,
          cancelled_at: new Date().toISOString(),
          cancellation_reason: reason || null,
        })
        .eq('id', visit.id)
        .not('status', 'in', '("completed","cancelled")');

      if (error) throw error;

      await supabase
        .from('tasks')
        .update({ status: 'cancelled' })
        .eq('visit_id', visit.id)
        .in('status', ['pending', 'in_progress', 'overdue']);

      await fetchData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const getStatusVariant = (status: string): 'pending' | 'in_progress' | 'completed' | 'cancelled' => {
    const variants: Record<string, 'pending' | 'in_progress' | 'completed' | 'cancelled'> = {
      scheduled: 'pending',
      date_confirmed: 'in_progress',
      report_uploaded: 'in_progress',
      recommendations_created: 'in_progress',
      in_review: 'in_progress',
      completed: 'completed',
      cancelled: 'cancelled',
    };
    return variants[status] || 'pending';
  };

  const filteredVisits = statusFilter === 'all'
    ? visits
    : visits.filter((v) => v.status === statusFilter);

  const statusOptions = [
    { value: 'all', label: 'All Statuses' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'date_confirmed', label: 'Date Confirmed' },
    { value: 'report_uploaded', label: 'Report Uploaded' },
    { value: 'recommendations_created', label: 'Recommendations Created' },
    { value: 'in_review', label: 'In Review' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

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
          <h1 className="text-2xl font-bold text-gray-900">Maintenance Visits</h1>
          <p className="text-gray-600">Track and manage scheduled maintenance visits</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => { setError(null); setSuccess(null); setBreakdownModalOpen(true); }}>
            <AlertTriangle className="w-4 h-4 mr-2" />
            Report Breakdown
          </Button>
          {canManage && (
            <Button onClick={() => setCreateModalOpen(true)}>
              <Plus className="w-4 h-4 mr-2" />
              Create Visit
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-4">
            <div className="w-64">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                options={statusOptions}
              />
            </div>
            <span className="text-sm text-gray-500">
              Showing {filteredVisits.length} of {visits.length} visits
            </span>
          </div>
        </CardContent>
      </Card>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Plan Number</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>Scheduled Date</TableHead>
            <TableHead>Confirmed Date</TableHead>
            <TableHead>Notification #</TableHead>
            <TableHead>Status</TableHead>
            <TableHead align="right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredVisits.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-gray-500">
                No visits found.
              </TableCell>
            </TableRow>
          ) : (
            filteredVisits.map((visit) => (
              <TableRow key={visit.id} onClick={() => router.push(`/visits/${visit.id}`)}>
                <TableCell className="font-medium">
                  <span className="text-primary-600">{visit.routine?.plan_number || (visit.is_adhoc ? 'Breakdown' : '-')}</span>
                  {visit.is_adhoc && <Badge variant="warning" size="sm" className="ml-2">Breakdown</Badge>}
                  {(visit.routine?.description || visit.adhoc_description) && (
                    <p className="text-xs text-gray-500 font-normal whitespace-normal max-w-xs">{visit.routine?.description || visit.adhoc_description}</p>
                  )}
                </TableCell>
                <TableCell>{visit.routine?.vendor?.name || visit.vendor?.name || '-'}</TableCell>
                <TableCell>{format(new Date(visit.scheduled_date), 'MMM d, yyyy')}</TableCell>
                <TableCell>
                  {visit.confirmed_date
                    ? format(new Date(visit.confirmed_date), 'MMM d, yyyy')
                    : '-'}
                </TableCell>
                <TableCell>{visit.notification_number || '-'}</TableCell>
                <TableCell>
                  <Badge variant={getStatusVariant(visit.status)}>
                    {visit.status.replace(/_/g, ' ')}
                  </Badge>
                </TableCell>
                <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end space-x-2">
                    <Link href={`/visits/${visit.id}`}>
                      <Button variant="ghost" size="sm">
                        <Eye className="w-4 h-4" />
                      </Button>
                    </Link>
                    {visit.status === 'scheduled' && (userProfile?.id === visit.vendor_coordinator_id || hasRole('admin')) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleConfirmDate(visit)}
                        title="Confirm Date"
                      >
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      </Button>
                    )}
                    {visit.status === 'date_confirmed' && (userProfile?.id === visit.vendor_coordinator_id || userProfile?.id === visit.maintenance_engineer_id || userProfile?.id === visit.technical_engineer_id || hasRole('admin')) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedVisit(visit);
                          setUploadModalOpen(true);
                        }}
                        title="Upload Report"
                      >
                        <Upload className="w-4 h-4 text-blue-500" />
                      </Button>
                    )}
                    {hasRole('admin') && visit.status !== 'completed' && visit.status !== 'cancelled' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCancelVisit(visit)}
                        title="Cancel Visit"
                      >
                        <XCircle className="w-4 h-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* Report Breakdown Modal */}
      <Modal
        isOpen={breakdownModalOpen}
        onClose={() => setBreakdownModalOpen(false)}
        title="Report a Breakdown (Ad-hoc Visit)"
        size="lg"
      >
        <form onSubmit={handleCreateBreakdown} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <p className="text-sm text-gray-600">
            Create a one-off visit that isn&apos;t part of a maintenance plan. The date is taken as
            confirmed, so it goes straight to report upload.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select
              label="Vendor"
              name="vendor_id"
              value={breakdownData.vendor_id}
              onChange={(e) => setBreakdownData({ ...breakdownData, vendor_id: e.target.value })}
              required
              placeholder="Select vendor"
              options={vendors.map(v => ({ value: v.id, label: v.name }))}
            />
            <Input
              label="Visit Date"
              name="scheduled_date"
              type="date"
              value={breakdownData.scheduled_date}
              onChange={(e) => setBreakdownData({ ...breakdownData, scheduled_date: e.target.value })}
              required
            />
          </div>

          <Input
            label="Description"
            name="description"
            value={breakdownData.description}
            onChange={(e) => setBreakdownData({ ...breakdownData, description: e.target.value })}
            required
            placeholder="e.g., Pump P-101 bearing failure"
          />

          <Textarea
            label="Reason / details"
            name="reason"
            value={breakdownData.reason}
            onChange={(e) => setBreakdownData({ ...breakdownData, reason: e.target.value })}
            placeholder="Describe the breakdown..."
            rows={2}
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Select
              label="Vendor Coordinator"
              name="vendor_coordinator_id"
              value={breakdownData.vendor_coordinator_id}
              onChange={(e) => setBreakdownData({ ...breakdownData, vendor_coordinator_id: e.target.value })}
              required
              placeholder="Select"
              options={usersByRole('vendor_coordinator').map(u => ({ value: u.id, label: u.full_name }))}
            />
            <Select
              label="Maintenance Engineer"
              name="maintenance_engineer_id"
              value={breakdownData.maintenance_engineer_id}
              onChange={(e) => setBreakdownData({ ...breakdownData, maintenance_engineer_id: e.target.value })}
              required
              placeholder="Select"
              options={usersByRole('maintenance_engineer').map(u => ({ value: u.id, label: u.full_name }))}
            />
            <Select
              label="Technical Engineer"
              name="technical_engineer_id"
              value={breakdownData.technical_engineer_id}
              onChange={(e) => setBreakdownData({ ...breakdownData, technical_engineer_id: e.target.value })}
              required
              placeholder="Select"
              options={usersByRole('technical_engineer').map(u => ({ value: u.id, label: u.full_name }))}
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="bd_requires_review"
              checked={breakdownData.requires_technical_review}
              onChange={(e) => setBreakdownData({ ...breakdownData, requires_technical_review: e.target.checked })}
              className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
            />
            <label htmlFor="bd_requires_review" className="ml-2 block text-sm text-gray-900">
              Recommendations require technical review
            </label>
          </div>

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setBreakdownModalOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={submitting} className="w-full sm:w-auto">
              Create Breakdown Visit
            </Button>
          </div>
        </form>
      </Modal>

      {/* Create Visit Modal */}
      <Modal
        isOpen={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title="Create Maintenance Visit"
      >
        <form onSubmit={handleCreateVisit} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <Select
            label="Maintenance Routine"
            name="routine_id"
            value={selectedRoutine}
            onChange={(e) => setSelectedRoutine(e.target.value)}
            required
            options={routines.map((r) => ({
              value: r.id,
              label: `${r.plan_number} - ${r.description}`,
            }))}
            placeholder="Select routine"
          />

          <Input
            label="Scheduled Date"
            name="scheduled_date"
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            required
          />

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Create Visit
            </Button>
          </div>
        </form>
      </Modal>

      {/* Upload Report Modal */}
      <Modal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        title="Upload Maintenance Report"
      >
        <form onSubmit={handleUploadReport} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <div>
            <p className="text-sm text-gray-600 mb-4">
              Upload the maintenance report for visit:{' '}
              <strong>{selectedVisit?.routine?.plan_number}</strong>
            </p>

            <Input
              label="Report File"
              name="report"
              type="file"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              required
              accept=".pdf,.doc,.docx,.xls,.xlsx"
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setUploadModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!file}>
              Upload Report
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
