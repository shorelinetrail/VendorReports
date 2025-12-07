'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, Upload, FileText, Download, CheckCircle, XCircle, Plus, Check, RefreshCw, RotateCcw, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { MaintenanceVisit, Recommendation, Task, VisitStatus, RecommendationStatus } from '@/types/database';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Badge from '@/components/ui/Badge';
import Alert from '@/components/ui/Alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import Link from 'next/link';

interface VisitDetails extends Omit<MaintenanceVisit, 'routine' | 'vendor_coordinator' | 'maintenance_engineer' | 'technical_engineer'> {
  routine: {
    id: string;
    plan_number: string;
    description: string;
    requires_technical_review: boolean;
    vendor: { id: string; name: string };
  };
  vendor_coordinator: { id: string; full_name: string; email: string };
  maintenance_engineer: { id: string; full_name: string; email: string };
  technical_engineer: { id: string; full_name: string; email: string };
  // Reschedule fields (from migration 003)
  reschedule_reason?: string | null;
  rescheduled_at?: string | null;
  rescheduled_from?: string | null;
}

interface RecommendationWithCreator extends Omit<Recommendation, 'created_by' | 'reviewed_by'> {
  created_by: { full_name: string };
  reviewed_by?: { full_name: string } | null;
}

export default function VisitDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { userProfile, hasRole } = useAuth();
  const [visit, setVisit] = useState<VisitDetails | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationWithCreator[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [recommendationModalOpen, setRecommendationModalOpen] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [selectedRecommendation, setSelectedRecommendation] = useState<RecommendationWithCreator | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [newRecommendation, setNewRecommendation] = useState({
    description: '',
    sap_notification_number: '',
    due_date: '',
  });
  const [reviewResponse, setReviewResponse] = useState('');
  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false);
  const [rescheduleData, setRescheduleData] = useState({ new_date: '', reason: '' });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const supabase = createClient();

  const visitId = params.id as string;

  useEffect(() => {
    if (visitId) {
      fetchVisitData();
    }
  }, [visitId]);

  const fetchVisitData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [visitRes, recommendationsRes, tasksRes] = await Promise.all([
        supabase
          .from('maintenance_visits')
          .select(`
            *,
            routine:maintenance_routines(
              id,
              plan_number,
              description,
              requires_technical_review,
              vendor:vendors(id, name)
            ),
            vendor_coordinator:users!maintenance_visits_vendor_coordinator_id_fkey(id, full_name, email),
            maintenance_engineer:users!maintenance_visits_maintenance_engineer_id_fkey(id, full_name, email),
            technical_engineer:users!maintenance_visits_technical_engineer_id_fkey(id, full_name, email)
          `)
          .eq('id', visitId)
          .single(),
        supabase
          .from('recommendations')
          .select(`
            *,
            created_by:users!recommendations_created_by_id_fkey(full_name),
            reviewed_by:users!recommendations_reviewed_by_id_fkey(full_name)
          `)
          .eq('visit_id', visitId)
          .order('created_at', { ascending: false }),
        supabase
          .from('tasks')
          .select('*')
          .eq('visit_id', visitId)
          .order('due_date', { ascending: true }),
      ]);

      if (visitRes.error) {
        console.error('Error fetching visit:', visitRes.error);
        setError(visitRes.error.message);
        return;
      }

      if (visitRes.data) setVisit(visitRes.data as unknown as VisitDetails);
      if (recommendationsRes.data) setRecommendations(recommendationsRes.data as unknown as RecommendationWithCreator[]);
      if (tasksRes.data) setTasks(tasksRes.data);
    } catch (err) {
      console.error('Error fetching visit data:', err);
      setError(err instanceof Error ? err.message : 'An error occurred loading visit data');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmDate = async () => {
    const confirmedDate = prompt('Enter confirmed visit date (YYYY-MM-DD):', visit?.scheduled_date);
    if (!confirmedDate) return;

    try {
      const { error } = await supabase
        .from('maintenance_visits')
        .update({
          confirmed_date: confirmedDate,
          status: 'date_confirmed' as VisitStatus,
        })
        .eq('id', visitId);

      if (error) throw error;
      await fetchVisitData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const handleUploadReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !visit) return;

    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const fileExt = file.name.split('.').pop();
      const fileName = `${visitId}-${Date.now()}.${fileExt}`;
      const filePath = `reports/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('reports')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { error: updateError } = await supabase
        .from('maintenance_visits')
        .update({
          report_file_path: filePath,
          report_uploaded_at: new Date().toISOString(),
          status: 'report_uploaded' as VisitStatus,
        })
        .eq('id', visitId);

      if (updateError) throw updateError;

      setSuccess('Report uploaded successfully');
      await fetchVisitData();
      setTimeout(() => {
        setUploadModalOpen(false);
        setFile(null);
      }, 1000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadReport = async () => {
    if (!visit?.report_file_path) return;

    try {
      const { data, error } = await supabase.storage
        .from('reports')
        .download(visit.report_file_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = visit.report_file_path.split('/').pop() || 'report';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const handleCreateRecommendation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userProfile || !visit) return;

    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      // Determine initial status based on whether technical review is required
      const requiresReview = visit.routine?.requires_technical_review ?? true;
      const initialStatus = requiresReview ? 'in_review' : 'open';

      const { data: newRec, error } = await supabase.from('recommendations').insert({
        visit_id: visitId,
        description: newRecommendation.description,
        sap_notification_number: newRecommendation.sap_notification_number || null,
        due_date: newRecommendation.due_date || null,
        created_by_id: userProfile.id,
        status: initialStatus as RecommendationStatus,
        sent_for_review: requiresReview,
      }).select('id').single();

      if (error) throw error;

      // Update visit status
      if (recommendations.length === 0 || requiresReview) {
        await supabase
          .from('maintenance_visits')
          .update({ status: requiresReview ? 'in_review' : 'recommendations_created' as VisitStatus })
          .eq('id', visitId);
      }

      // If technical review is required, create a task for the technical engineer
      if (requiresReview && visit.technical_engineer_id && newRec) {
        const { data: configData } = await supabase
          .from('system_config')
          .select('config_value')
          .eq('config_key', 'technical_review_days')
          .single();

        const reviewDays = parseInt(configData?.config_value || '7', 10);
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + reviewDays);

        await supabase.from('tasks').insert({
          visit_id: visitId,
          task_type: 'technical_review',
          assigned_to_id: visit.technical_engineer_id,
          status: 'pending',
          due_date: dueDate.toISOString().split('T')[0],
          notes: `Review recommendation: ${newRec.id}`,
        });
      }

      setSuccess(requiresReview
        ? 'Recommendation created and sent for technical review'
        : 'Recommendation created successfully'
      );
      await fetchVisitData();
      setTimeout(() => {
        setRecommendationModalOpen(false);
        setNewRecommendation({ description: '', sap_notification_number: '', due_date: '' });
      }, 1000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendForReview = async (recommendationId: string) => {
    try {
      const { error } = await supabase
        .from('recommendations')
        .update({
          sent_for_review: true,
          status: 'in_review' as RecommendationStatus,
        })
        .eq('id', recommendationId);

      if (error) throw error;

      // Update visit status
      await supabase
        .from('maintenance_visits')
        .update({ status: 'in_review' as VisitStatus })
        .eq('id', visitId);

      // Create a task for the technical engineer to review
      if (visit?.technical_engineer_id) {
        // Get the technical review days setting
        const { data: configData } = await supabase
          .from('system_config')
          .select('config_value')
          .eq('config_key', 'technical_review_days')
          .single();

        const reviewDays = parseInt(configData?.config_value || '7', 10);
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + reviewDays);

        await supabase.from('tasks').insert({
          visit_id: visitId,
          task_type: 'technical_review',
          assigned_to_id: visit.technical_engineer_id,
          status: 'pending',
          due_date: dueDate.toISOString().split('T')[0],
          notes: `Review recommendation: ${recommendationId}`,
        });
      }

      await fetchVisitData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecommendation || !userProfile) return;

    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const { error } = await supabase
        .from('recommendations')
        .update({
          technical_review_response: reviewResponse,
          reviewed_by_id: userProfile.id,
          reviewed_at: new Date().toISOString(),
          status: 'approved' as RecommendationStatus,
        })
        .eq('id', selectedRecommendation.id);

      if (error) throw error;

      // Mark the technical review task as completed
      await supabase
        .from('tasks')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('visit_id', visitId)
        .eq('task_type', 'technical_review')
        .eq('assigned_to_id', userProfile.id)
        .eq('status', 'pending');

      setSuccess('Review submitted successfully');
      await fetchVisitData();
      setTimeout(() => {
        setReviewModalOpen(false);
        setSelectedRecommendation(null);
        setReviewResponse('');
      }, 1000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteRecommendation = async (recommendationId: string) => {
    try {
      const { error } = await supabase
        .from('recommendations')
        .update({
          status: 'completed' as RecommendationStatus,
          completed_at: new Date().toISOString(),
        })
        .eq('id', recommendationId);

      if (error) throw error;
      await fetchVisitData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const handleCancelRecommendation = async (recommendationId: string) => {
    const reason = prompt('Enter cancellation reason:');
    if (!reason) return;

    try {
      const { error } = await supabase
        .from('recommendations')
        .update({
          status: 'cancelled' as RecommendationStatus,
          cancelled_at: new Date().toISOString(),
          cancellation_reason: reason,
        })
        .eq('id', recommendationId);

      if (error) throw error;
      await fetchVisitData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const handleCloseVisit = async () => {
    if (!confirm('Are you sure you want to close this visit? This action cannot be undone.')) {
      return;
    }

    try {
      // Update visit status to completed
      const { error: visitError } = await supabase
        .from('maintenance_visits')
        .update({ status: 'completed' as VisitStatus })
        .eq('id', visitId);

      if (visitError) throw visitError;

      // Mark any pending close_visit task as completed
      if (userProfile) {
        await supabase
          .from('tasks')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString(),
          })
          .eq('visit_id', visitId)
          .eq('task_type', 'close_visit')
          .in('status', ['pending', 'in_progress']);
      }

      await fetchVisitData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const handleReopenVisit = async () => {
    if (!confirm('Are you sure you want to reopen this visit? This will allow adding new recommendations.')) {
      return;
    }

    try {
      // Determine the appropriate status based on recommendations
      const hasInReviewRecs = recommendations.some(r => r.status === 'in_review');
      const newStatus: VisitStatus = hasInReviewRecs ? 'in_review' : 'recommendations_created';

      const { error: visitError } = await supabase
        .from('maintenance_visits')
        .update({ status: newStatus })
        .eq('id', visitId);

      if (visitError) throw visitError;

      await fetchVisitData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const handleRescheduleVisit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!visit) return;

    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      // Store the old date for the notes
      const oldDate = visit.scheduled_date;

      // Update visit with new scheduled date and reset status
      const { error: updateError } = await supabase
        .from('maintenance_visits')
        .update({
          scheduled_date: rescheduleData.new_date,
          confirmed_date: null,
          status: 'scheduled' as VisitStatus,
          reschedule_reason: rescheduleData.reason,
          rescheduled_at: new Date().toISOString(),
          rescheduled_from: oldDate,
        })
        .eq('id', visitId);

      if (updateError) throw updateError;

      // Cancel any pending confirm_visit_date tasks and create a new one
      await supabase
        .from('tasks')
        .update({ status: 'cancelled' })
        .eq('visit_id', visitId)
        .eq('task_type', 'confirm_visit_date')
        .in('status', ['pending', 'in_progress']);

      // Create new confirm date task
      if (visit.vendor_coordinator_id) {
        const { data: configData } = await supabase
          .from('system_config')
          .select('config_value')
          .eq('config_key', 'visit_confirmation_days')
          .single();

        const confirmDays = parseInt(configData?.config_value || '14', 10);
        const dueDate = new Date(rescheduleData.new_date);
        dueDate.setDate(dueDate.getDate() - confirmDays);

        await supabase.from('tasks').insert({
          visit_id: visitId,
          task_type: 'confirm_visit_date',
          assigned_to_id: visit.vendor_coordinator_id,
          status: 'pending',
          due_date: dueDate.toISOString().split('T')[0],
          notes: `Rescheduled from ${oldDate}. Reason: ${rescheduleData.reason}`,
        });
      }

      setSuccess('Visit rescheduled successfully');
      await fetchVisitData();
      setTimeout(() => {
        setRescheduleModalOpen(false);
        setRescheduleData({ new_date: '', reason: '' });
      }, 1000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // Calculate workflow step based on status
  const getWorkflowStep = (status: VisitStatus): number => {
    const steps: Record<VisitStatus, number> = {
      scheduled: 1,
      date_confirmed: 2,
      report_uploaded: 3,
      recommendations_created: 4,
      in_review: 5,
      completed: 6,
      cancelled: 0,
    };
    return steps[status] || 1;
  };

  const workflowSteps = [
    { step: 1, label: 'Scheduled', description: 'Visit date set' },
    { step: 2, label: 'Date Confirmed', description: 'Vendor coordinator confirmed' },
    { step: 3, label: 'Report Uploaded', description: 'Maintenance report received' },
    { step: 4, label: 'Recommendations', description: 'Engineer created recommendations' },
    { step: 5, label: 'In Review', description: 'Technical review in progress' },
    { step: 6, label: 'Completed', description: 'Visit closed' },
  ];

  const currentStep = visit ? getWorkflowStep(visit.status) : 1;

  const getStatusVariant = (status: string): 'pending' | 'in_progress' | 'completed' | 'cancelled' => {
    const variants: Record<string, 'pending' | 'in_progress' | 'completed' | 'cancelled'> = {
      scheduled: 'pending',
      date_confirmed: 'in_progress',
      report_uploaded: 'in_progress',
      recommendations_created: 'in_progress',
      in_review: 'in_progress',
      completed: 'completed',
      cancelled: 'cancelled',
      open: 'pending',
      approved: 'completed',
    };
    return variants[status] || 'pending';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!visit) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Visit not found</h2>
        {error && (
          <p className="text-red-600 mt-2">{error}</p>
        )}
        <p className="text-gray-500 mt-2 text-sm">Visit ID: {visitId}</p>
        <Link href="/visits">
          <Button variant="secondary" className="mt-4">
            Back to Visits
          </Button>
        </Link>
      </div>
    );
  }

  const canConfirmDate = userProfile?.id === visit.vendor_coordinator_id || hasRole('admin');
  const canUploadReport = (userProfile?.id === visit.vendor_coordinator_id || hasRole('admin')) && visit.status === 'date_confirmed';
  const canCreateRecommendation = (userProfile?.id === visit.maintenance_engineer_id || hasRole('admin'))
    && visit.report_file_path
    && visit.status !== 'completed'
    && visit.status !== 'cancelled';
  const canReview = userProfile?.id === visit.technical_engineer_id || hasRole('admin');
  const canReschedule = (userProfile?.id === visit.vendor_coordinator_id || hasRole('admin'))
    && visit.status !== 'completed'
    && visit.status !== 'cancelled';

  // Check if all recommendations are done and user can close the visit
  const allRecommendationsDone = recommendations.length > 0 && recommendations.every(
    r => r.status === 'completed' || r.status === 'cancelled'
  );
  const canCloseVisit = (userProfile?.id === visit.maintenance_engineer_id || hasRole('admin'))
    && visit.status !== 'completed'
    && visit.status !== 'cancelled'
    && allRecommendationsDone;

  // Check if admin can reopen a completed visit
  const canReopenVisit = hasRole('admin') && visit.status === 'completed';

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-4">
        <Link href="/visits">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Visit: {visit.routine?.plan_number}
          </h1>
          <p className="text-gray-600">{visit.routine?.description}</p>
        </div>
      </div>

      {/* Workflow Progress Stepper */}
      {visit.status !== 'cancelled' && (
        <Card>
          <CardContent className="py-6">
            <div className="flex items-center justify-between">
              {workflowSteps.map((step, index) => {
                // When visit is completed, all steps should show as done (green with checkmark)
                const isCompleted = visit.status === 'completed';
                const isStepDone = isCompleted ? true : currentStep > step.step;
                const isCurrentStep = !isCompleted && currentStep === step.step;

                return (
                  <div key={step.step} className="flex items-center flex-1">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium border-2 transition-colors ${
                          isStepDone
                            ? 'bg-green-500 border-green-500 text-white'
                            : isCurrentStep
                            ? 'bg-blue-500 border-blue-500 text-white'
                            : 'bg-white border-gray-300 text-gray-400'
                        }`}
                      >
                        {isStepDone ? (
                          <Check className="w-5 h-5" />
                        ) : (
                          step.step
                        )}
                      </div>
                      <div className="mt-2 text-center">
                        <p
                          className={`text-xs font-medium ${
                            isStepDone || isCurrentStep ? 'text-gray-900' : 'text-gray-400'
                          }`}
                        >
                          {step.label}
                        </p>
                        <p className="text-xs text-gray-500 hidden sm:block">{step.description}</p>
                      </div>
                    </div>
                    {index < workflowSteps.length - 1 && (
                      <div
                        className={`flex-1 h-1 mx-2 ${
                          isCompleted || currentStep > step.step ? 'bg-green-500' : 'bg-gray-200'
                        }`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Visit Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Visit Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Vendor</p>
                <p className="font-medium">{visit.routine?.vendor?.name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Status</p>
                <Badge variant={getStatusVariant(visit.status)}>
                  {visit.status.replace(/_/g, ' ')}
                </Badge>
              </div>
              <div>
                <p className="text-sm text-gray-500">Scheduled Date</p>
                <p className="font-medium">{format(new Date(visit.scheduled_date), 'MMMM d, yyyy')}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Confirmed Date</p>
                <p className="font-medium">
                  {visit.confirmed_date
                    ? format(new Date(visit.confirmed_date), 'MMMM d, yyyy')
                    : 'Not confirmed'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Notification Number</p>
                <p className="font-medium">{visit.notification_number || '-'}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Report</p>
                {visit.report_file_path ? (
                  <Button variant="ghost" size="sm" onClick={handleDownloadReport} className="p-0">
                    <Download className="w-4 h-4 mr-1" />
                    Download
                  </Button>
                ) : (
                  <p className="text-gray-400">Not uploaded</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assigned Team</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-gray-500">Vendor Coordinator</p>
              <p className="font-medium">{visit.vendor_coordinator?.full_name}</p>
              <p className="text-sm text-gray-400">{visit.vendor_coordinator?.email}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Maintenance Engineer</p>
              <p className="font-medium">{visit.maintenance_engineer?.full_name}</p>
              <p className="text-sm text-gray-400">{visit.maintenance_engineer?.email}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Technical Engineer</p>
              <p className="font-medium">{visit.technical_engineer?.full_name}</p>
              <p className="text-sm text-gray-400">{visit.technical_engineer?.email}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Workflow Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Workflow Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            {visit.status === 'scheduled' && canConfirmDate && (
              <Button onClick={handleConfirmDate}>
                <Calendar className="w-4 h-4 mr-2" />
                Confirm Visit Date
              </Button>
            )}
            {canUploadReport && (
              <Button onClick={() => setUploadModalOpen(true)}>
                <Upload className="w-4 h-4 mr-2" />
                Upload Report
              </Button>
            )}
            {canCreateRecommendation && (
              <Button onClick={() => setRecommendationModalOpen(true)}>
                <Plus className="w-4 h-4 mr-2" />
                Add Recommendation
              </Button>
            )}
            {canReschedule && (
              <Button variant="secondary" onClick={() => setRescheduleModalOpen(true)}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Reschedule Visit
              </Button>
            )}
            {canCloseVisit && (
              <Button onClick={handleCloseVisit} className="bg-green-600 hover:bg-green-700">
                <CheckCircle className="w-4 h-4 mr-2" />
                Close Visit
              </Button>
            )}
            {visit.status === 'completed' && (
              <div className="flex items-center space-x-4">
                <div className="flex items-center text-green-600">
                  <CheckCircle className="w-5 h-5 mr-2" />
                  <span className="font-medium">Visit Completed</span>
                </div>
                {canReopenVisit && (
                  <Button variant="secondary" onClick={handleReopenVisit}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    Reopen Visit
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recommendations */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recommendations</CardTitle>
          <span className="text-sm text-gray-500">{recommendations.length} items</span>
        </CardHeader>
        <CardContent>
          {recommendations.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No recommendations yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>SAP Notification</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead align="right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recommendations.map((rec) => (
                  <TableRow key={rec.id}>
                    <TableCell className="max-w-xs">
                      <p className="truncate">{rec.description}</p>
                      {rec.technical_review_response && (
                        <p className="text-sm text-gray-500 truncate mt-1">
                          Review: {rec.technical_review_response}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{rec.sap_notification_number || '-'}</TableCell>
                    <TableCell>
                      {rec.due_date ? format(new Date(rec.due_date), 'MMM d, yyyy') : '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(rec.status)}>
                        {rec.status.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>{rec.created_by?.full_name}</TableCell>
                    <TableCell align="right">
                      <div className="flex items-center justify-end space-x-2">
                        {rec.status === 'open' && !rec.sent_for_review && (userProfile?.id === visit.maintenance_engineer_id || hasRole('admin')) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleSendForReview(rec.id)}
                            title="Send for Review"
                          >
                            <FileText className="w-4 h-4 text-blue-500" />
                          </Button>
                        )}
                        {rec.sent_for_review && rec.status === 'in_review' && canReview && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedRecommendation(rec);
                              setReviewModalOpen(true);
                            }}
                            title="Submit Review"
                          >
                            <FileText className="w-4 h-4 text-purple-500" />
                          </Button>
                        )}
                        {(rec.status === 'open' || rec.status === 'approved') && (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCompleteRecommendation(rec.id)}
                              title="Mark Complete"
                            >
                              <CheckCircle className="w-4 h-4 text-green-500" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleCancelRecommendation(rec.id)}
                              title="Cancel"
                            >
                              <XCircle className="w-4 h-4 text-red-500" />
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Activity Log */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Clock className="w-5 h-5 mr-2" />
            Activity Log
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Build activity log from visit data */}
            {(() => {
              const activities: { date: string; event: string; details?: string }[] = [];

              // Visit created
              if (visit.created_at) {
                activities.push({
                  date: visit.created_at,
                  event: 'Visit created',
                  details: `Scheduled for ${format(new Date(visit.scheduled_date), 'MMMM d, yyyy')}`,
                });
              }

              // Date confirmed
              if (visit.confirmed_date) {
                activities.push({
                  date: visit.confirmed_date,
                  event: 'Visit date confirmed',
                  details: `Confirmed for ${format(new Date(visit.confirmed_date), 'MMMM d, yyyy')}`,
                });
              }

              // Rescheduled
              if (visit.rescheduled_at) {
                activities.push({
                  date: visit.rescheduled_at,
                  event: 'Visit rescheduled',
                  details: visit.reschedule_reason
                    ? `From ${visit.rescheduled_from ? format(new Date(visit.rescheduled_from), 'MMM d, yyyy') : 'previous date'}. Reason: ${visit.reschedule_reason}`
                    : undefined,
                });
              }

              // Report uploaded
              if (visit.report_uploaded_at) {
                activities.push({
                  date: visit.report_uploaded_at,
                  event: 'Maintenance report uploaded',
                });
              }

              // Recommendations created
              recommendations.forEach(rec => {
                activities.push({
                  date: rec.created_at,
                  event: 'Recommendation created',
                  details: rec.description.substring(0, 100) + (rec.description.length > 100 ? '...' : ''),
                });

                if (rec.reviewed_at) {
                  activities.push({
                    date: rec.reviewed_at,
                    event: 'Recommendation reviewed',
                    details: `By ${rec.reviewed_by?.full_name || 'Technical Engineer'}`,
                  });
                }

                if (rec.completed_at) {
                  activities.push({
                    date: rec.completed_at,
                    event: 'Recommendation completed',
                    details: rec.description.substring(0, 50) + (rec.description.length > 50 ? '...' : ''),
                  });
                }

                if (rec.cancelled_at) {
                  activities.push({
                    date: rec.cancelled_at,
                    event: 'Recommendation cancelled',
                    details: rec.cancellation_reason || undefined,
                  });
                }
              });

              // Tasks completed
              tasks.filter(t => t.completed_at).forEach(task => {
                const taskLabels: Record<string, string> = {
                  confirm_visit_date: 'Confirm visit date task',
                  upload_report: 'Upload report task',
                  create_recommendations: 'Create recommendations task',
                  review_recommendations: 'Review recommendations task',
                  technical_review: 'Technical review task',
                  close_visit: 'Close visit task',
                };
                activities.push({
                  date: task.completed_at!,
                  event: `${taskLabels[task.task_type] || task.task_type} completed`,
                });
              });

              // Sort by date descending (most recent first)
              activities.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

              if (activities.length === 0) {
                return <p className="text-gray-500 text-center py-4">No activity recorded yet.</p>;
              }

              return (
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />
                  <div className="space-y-4">
                    {activities.map((activity, idx) => (
                      <div key={idx} className="relative pl-10">
                        <div className="absolute left-2.5 w-3 h-3 bg-primary-500 rounded-full border-2 border-white" />
                        <div className="bg-gray-50 rounded-lg p-3">
                          <div className="flex items-center justify-between">
                            <p className="font-medium text-gray-900">{activity.event}</p>
                            <p className="text-sm text-gray-500">
                              {format(new Date(activity.date), 'MMM d, yyyy h:mm a')}
                            </p>
                          </div>
                          {activity.details && (
                            <p className="text-sm text-gray-600 mt-1">{activity.details}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </CardContent>
      </Card>

      {/* Upload Report Modal */}
      <Modal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        title="Upload Maintenance Report"
      >
        <form onSubmit={handleUploadReport} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <Input
            label="Report File"
            name="report"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            required
            accept=".pdf,.doc,.docx,.xls,.xlsx"
          />

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

      {/* Create Recommendation Modal */}
      <Modal
        isOpen={recommendationModalOpen}
        onClose={() => setRecommendationModalOpen(false)}
        title="Add Recommendation"
        size="lg"
      >
        <form onSubmit={handleCreateRecommendation} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <Textarea
            label="Description"
            name="description"
            value={newRecommendation.description}
            onChange={(e) => setNewRecommendation({ ...newRecommendation, description: e.target.value })}
            required
            placeholder="Describe the recommendation..."
            rows={4}
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="SAP Notification Number"
              name="sap_notification_number"
              value={newRecommendation.sap_notification_number}
              onChange={(e) => setNewRecommendation({ ...newRecommendation, sap_notification_number: e.target.value })}
              placeholder="Optional"
            />

            <Input
              label="Due Date"
              name="due_date"
              type="date"
              value={newRecommendation.due_date}
              onChange={(e) => setNewRecommendation({ ...newRecommendation, due_date: e.target.value })}
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setRecommendationModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Create Recommendation
            </Button>
          </div>
        </form>
      </Modal>

      {/* Technical Review Modal */}
      <Modal
        isOpen={reviewModalOpen}
        onClose={() => setReviewModalOpen(false)}
        title="Submit Technical Review"
        size="lg"
      >
        <form onSubmit={handleSubmitReview} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-500">Recommendation</p>
            <p className="font-medium">{selectedRecommendation?.description}</p>
          </div>

          <Textarea
            label="Review Response"
            name="review_response"
            value={reviewResponse}
            onChange={(e) => setReviewResponse(e.target.value)}
            required
            placeholder="Provide your technical review response..."
            rows={4}
          />

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setReviewModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Submit Review
            </Button>
          </div>
        </form>
      </Modal>

      {/* Reschedule Visit Modal */}
      <Modal
        isOpen={rescheduleModalOpen}
        onClose={() => setRescheduleModalOpen(false)}
        title="Reschedule Visit"
      >
        <form onSubmit={handleRescheduleVisit} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-500">Current Scheduled Date</p>
            <p className="font-medium">
              {visit?.scheduled_date && format(new Date(visit.scheduled_date), 'MMMM d, yyyy')}
            </p>
          </div>

          <Input
            label="New Scheduled Date"
            name="new_date"
            type="date"
            value={rescheduleData.new_date}
            onChange={(e) => setRescheduleData({ ...rescheduleData, new_date: e.target.value })}
            required
          />

          <Textarea
            label="Reason for Rescheduling"
            name="reason"
            value={rescheduleData.reason}
            onChange={(e) => setRescheduleData({ ...rescheduleData, reason: e.target.value })}
            required
            placeholder="Explain why the visit needs to be rescheduled..."
            rows={3}
          />

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setRescheduleModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Reschedule Visit
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
