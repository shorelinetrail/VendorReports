'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Upload, Eye, CheckCircle, Trash2 } from 'lucide-react';
import { format, addMonths, isBefore } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { completeVisitTasks, createUploadReportTask, createRecommendationsTask } from '@/lib/workflow/tasks';
import { MaintenanceVisit, MaintenanceRoutine, VisitStatus } from '@/types/database';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import Alert from '@/components/ui/Alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import Link from 'next/link';

interface VisitWithDetails extends Omit<MaintenanceVisit, 'routine' | 'vendor_coordinator' | 'maintenance_engineer' | 'technical_engineer'> {
  routine: MaintenanceRoutine & {
    vendor: { name: string };
  };
  vendor_coordinator: { full_name: string };
  maintenance_engineer: { full_name: string };
  technical_engineer: { full_name: string };
}

export default function VisitsPage() {
  const router = useRouter();
  const { userProfile, hasRole } = useAuth();
  const [visits, setVisits] = useState<VisitWithDetails[]>([]);
  const [routines, setRoutines] = useState<MaintenanceRoutine[]>([]);
  const [loading, setLoading] = useState(true);
  const [createModalOpen, setCreateModalOpen] = useState(false);
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
      const [visitsRes, routinesRes] = await Promise.all([
        supabase
          .from('maintenance_visits')
          .select(`
            *,
            routine:maintenance_routines(
              *,
              vendor:vendors(name)
            ),
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
      ]);

      if (visitsRes.data) setVisits(visitsRes.data as unknown as VisitWithDetails[]);
      if (routinesRes.data) setRoutines(routinesRes.data);
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

  const handleDeleteVisit = async (visit: VisitWithDetails) => {
    if (!confirm(`Are you sure you want to delete visit for ${visit.routine?.plan_number}?\n\nThis will also delete all associated tasks and recommendations. This action cannot be undone.`)) {
      return;
    }

    try {
      // Delete associated recommendations first
      await supabase
        .from('recommendations')
        .delete()
        .eq('visit_id', visit.id);

      // Delete associated tasks
      await supabase
        .from('tasks')
        .delete()
        .eq('visit_id', visit.id);

      // Delete the visit
      const { error } = await supabase
        .from('maintenance_visits')
        .delete()
        .eq('id', visit.id);

      if (error) throw error;
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
        {canManage && (
          <Button onClick={() => setCreateModalOpen(true)}>
            <Plus className="w-4 h-4 mr-2" />
            Create Visit
          </Button>
        )}
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
                  <span className="text-primary-600">{visit.routine?.plan_number}</span>
                  {visit.routine?.description && (
                    <p className="text-xs text-gray-500 font-normal whitespace-normal max-w-xs">{visit.routine.description}</p>
                  )}
                </TableCell>
                <TableCell>{visit.routine?.vendor?.name}</TableCell>
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
                    {hasRole('admin') && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteVisit(visit)}
                        title="Delete Visit"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

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
