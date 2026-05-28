'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, Upload, FileText, Download, CheckCircle, XCircle, Plus, Check, RefreshCw, RotateCcw, Clock, FileX, Trash2, Users, Edit3 } from 'lucide-react';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  completeVisitTasks,
  createUploadReportTask,
  createRecommendationsTask,
  createCloseVisitTask,
} from '@/lib/workflow/tasks';
import { MaintenanceVisit, Recommendation, Task, VisitStatus, RecommendationStatus, VisitReport, User, ReviewDecisionType } from '@/types/database';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Select from '@/components/ui/Select';
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

interface RecommendationWithCreator extends Omit<Recommendation, 'created_by' | 'reviewed_by' | 'action_assigned_to'> {
  created_by: { full_name: string };
  reviewed_by?: { full_name: string } | null;
  action_assigned_to?: { id: string; full_name: string } | null;
}

interface VisitReportWithUploader extends Omit<VisitReport, 'uploaded_by' | 'visit'> {
  uploaded_by: { full_name: string };
}

export default function VisitDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { userProfile, hasRole } = useAuth();
  const [visit, setVisit] = useState<VisitDetails | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationWithCreator[]>([]);
  const [visitReports, setVisitReports] = useState<VisitReportWithUploader[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [recommendationModalOpen, setRecommendationModalOpen] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [selectedRecommendation, setSelectedRecommendation] = useState<RecommendationWithCreator | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reportNotes, setReportNotes] = useState('');
  const [newRecommendation, setNewRecommendation] = useState({
    description: '',
    sap_notification_number: '',
    due_date: '',
  });
  const [reviewResponse, setReviewResponse] = useState('');
  const [reviewDecision, setReviewDecision] = useState<ReviewDecisionType | ''>('');
  const [reviewActionDescription, setReviewActionDescription] = useState('');
  const [reviewAssignToId, setReviewAssignToId] = useState('');
  const [rescheduleModalOpen, setRescheduleModalOpen] = useState(false);
  const [rescheduleData, setRescheduleData] = useState({ new_date: '', reason: '' });
  const [confirmDateModalOpen, setConfirmDateModalOpen] = useState(false);
  const [confirmDateValue, setConfirmDateValue] = useState('');
  const [notificationModalOpen, setNotificationModalOpen] = useState(false);
  const [notificationValue, setNotificationValue] = useState('');
  const [noReportModalOpen, setNoReportModalOpen] = useState(false);
  const [noReportReason, setNoReportReason] = useState('');
  const [reassignModalOpen, setReassignModalOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [reassignData, setReassignData] = useState({
    vendor_coordinator_id: '',
    maintenance_engineer_id: '',
    technical_engineer_id: '',
  });
  const [sapDetailsModalOpen, setSapDetailsModalOpen] = useState(false);
  const [selectedRecForSap, setSelectedRecForSap] = useState<RecommendationWithCreator | null>(null);
  const [sapDetails, setSapDetails] = useState({ sap_notification_number: '', due_date: '' });
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Memoize supabase client to prevent recreation on each render
  const supabase = useMemo(() => createClient(), []);

  const visitId = params.id as string;

  useEffect(() => {
    if (visitId) {
      fetchVisitData();
    }
  }, [visitId]);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    const { data } = await supabase
      .from('users')
      .select('*')
      .order('full_name');
    if (data) setUsers(data);
  };

  const fetchVisitData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [visitRes, recommendationsRes, tasksRes, reportsRes] = await Promise.all([
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
            reviewed_by:users!recommendations_reviewed_by_id_fkey(full_name),
            action_assigned_to:users!recommendations_action_assigned_to_id_fkey(id, full_name)
          `)
          .eq('visit_id', visitId)
          .order('created_at', { ascending: false }),
        supabase
          .from('tasks')
          .select('*')
          .eq('visit_id', visitId)
          .order('due_date', { ascending: true }),
        supabase
          .from('visit_reports')
          .select(`
            *,
            uploaded_by:users!visit_reports_uploaded_by_id_fkey(full_name)
          `)
          .eq('visit_id', visitId)
          .order('uploaded_at', { ascending: false }),
      ]);

      if (visitRes.error) {
        console.error('Error fetching visit:', visitRes.error);
        setError(visitRes.error.message);
        return;
      }

      if (visitRes.data) setVisit(visitRes.data as unknown as VisitDetails);
      if (recommendationsRes.data) setRecommendations(recommendationsRes.data as unknown as RecommendationWithCreator[]);
      if (tasksRes.data) setTasks(tasksRes.data);
      if (reportsRes.data) setVisitReports(reportsRes.data as unknown as VisitReportWithUploader[]);
    } catch (err) {
      console.error('Error fetching visit data:', err);
      setError(err instanceof Error ? err.message : 'An error occurred loading visit data');
    } finally {
      setLoading(false);
    }
  };

  const openConfirmDateModal = () => {
    setConfirmDateValue(visit?.confirmed_date || visit?.scheduled_date || '');
    setError(null);
    setSuccess(null);
    setConfirmDateModalOpen(true);
  };

  const handleConfirmDate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmDateValue) return;

    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const { error } = await supabase
        .from('maintenance_visits')
        .update({
          confirmed_date: confirmDateValue,
          confirmed_at: new Date().toISOString(),
          status: 'date_confirmed' as VisitStatus,
        })
        .eq('id', visitId);

      if (error) throw error;

      // Close the confirmation task and queue the report upload task.
      await completeVisitTasks(supabase, visitId, ['confirm_visit_date']);
      await createUploadReportTask(supabase, visitId, visit?.vendor_coordinator_id, new Date(confirmDateValue));

      await fetchVisitData();
      setConfirmDateModalOpen(false);
      setSuccess('Visit date confirmed');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const openNotificationModal = () => {
    setNotificationValue(visit?.notification_number || '');
    setError(null);
    setSuccess(null);
    setNotificationModalOpen(true);
  };

  const handleSaveNotification = async (e: React.FormEvent) => {
    e.preventDefault();

    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const { error } = await supabase
        .from('maintenance_visits')
        .update({ notification_number: notificationValue.trim() || null })
        .eq('id', visitId);

      if (error) throw error;
      await fetchVisitData();
      setNotificationModalOpen(false);
      setSuccess('Notification number saved');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUploadReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !visit || !userProfile) return;

    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const fileExt = file.name.split('.').pop();
      // First path segment is the visit id so the storage RLS policy can scope
      // uploads to the visit's assigned coordinator.
      const filePath = `${visitId}/${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('reports')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Insert into visit_reports table
      const { error: insertError } = await supabase
        .from('visit_reports')
        .insert({
          visit_id: visitId,
          file_path: filePath,
          file_name: file.name,
          uploaded_by_id: userProfile.id,
          uploaded_at: new Date().toISOString(),
          notes: reportNotes || null,
        });

      if (insertError) throw insertError;

      // Advance the visit to report_uploaded if it was awaiting a report.
      if (visit.status === 'date_confirmed') {
        const { error: updateError } = await supabase
          .from('maintenance_visits')
          .update({ status: 'report_uploaded' as VisitStatus })
          .eq('id', visitId);

        if (updateError) throw updateError;

        // Close the upload task and queue the recommendations task.
        await completeVisitTasks(supabase, visitId, ['upload_report']);
        await createRecommendationsTask(supabase, visitId, visit.maintenance_engineer_id);
      }

      await fetchVisitData();
      setUploadModalOpen(false);
      setFile(null);
      setReportNotes('');
      setSuccess('Report uploaded successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadReport = async (filePath: string, fileName?: string) => {
    if (!filePath) return;

    try {
      const { data, error } = await supabase.storage
        .from('reports')
        .download(filePath);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || filePath.split('/').pop() || 'report';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const handleDeleteReport = async (reportId: string, filePath: string) => {
    if (!confirm('Are you sure you want to delete this report?')) return;

    try {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('reports')
        .remove([filePath]);

      if (storageError) {
        console.warn('Could not delete file from storage:', storageError);
      }

      // Delete from visit_reports table
      const { error: deleteError } = await supabase
        .from('visit_reports')
        .delete()
        .eq('id', reportId);

      if (deleteError) throw deleteError;

      // If this was the only/last report and the visit hadn't progressed past
      // report upload, roll the status back so a new report can be added.
      if (visitReports.length === 1 && visit && visit.status === 'report_uploaded') {
        await supabase
          .from('maintenance_visits')
          .update({ status: 'date_confirmed' as VisitStatus })
          .eq('id', visitId);
      }

      await fetchVisitData();
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

      // The engineer has acted on the report; close the create-recommendations task.
      await completeVisitTasks(supabase, visitId, ['create_recommendations']);

      await fetchVisitData();
      setRecommendationModalOpen(false);
      setNewRecommendation({ description: '', sap_notification_number: '', due_date: '' });
      setSuccess(requiresReview
        ? 'Recommendation created and sent for technical review'
        : 'Recommendation created successfully'
      );
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
    if (!selectedRecommendation || !userProfile || !reviewDecision) return;

    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      // Determine status based on decision
      // If no_action, mark as completed. Otherwise, mark as approved (needs action)
      const newStatus: RecommendationStatus = reviewDecision === 'no_action' ? 'completed' : 'approved';

      const { error } = await supabase
        .from('recommendations')
        .update({
          technical_review_response: reviewResponse,
          review_decision: reviewDecision as ReviewDecisionType,
          review_action_description: reviewDecision === 'other_action' ? reviewActionDescription : null,
          action_assigned_to_id: reviewDecision !== 'no_action' ? reviewAssignToId || null : null,
          reviewed_by_id: userProfile.id,
          reviewed_at: new Date().toISOString(),
          status: newStatus,
          completed_at: reviewDecision === 'no_action' ? new Date().toISOString() : null,
        })
        .eq('id', selectedRecommendation.id);

      if (error) throw error;

      // Mark only this recommendation's technical review task as completed
      // (tasks are linked to a recommendation via their notes).
      await supabase
        .from('tasks')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('visit_id', visitId)
        .eq('task_type', 'technical_review')
        .eq('notes', `Review recommendation: ${selectedRecommendation.id}`)
        .in('status', ['pending', 'in_progress', 'overdue']);

      // If this review resolved the recommendation (no action) and it was the
      // last open one, queue the close-visit task.
      if (newStatus === 'completed') {
        const allResolved = recommendations.length > 0 && recommendations.every(r =>
          r.id === selectedRecommendation.id ? true : (r.status === 'completed' || r.status === 'cancelled')
        );
        if (allResolved && visit) {
          await createCloseVisitTask(supabase, visitId, visit.maintenance_engineer_id);
        }
      }

      await fetchVisitData();
      setReviewModalOpen(false);
      setSelectedRecommendation(null);
      setReviewResponse('');
      setReviewDecision('');
      setReviewActionDescription('');
      setReviewAssignToId('');
      setSuccess('Review submitted successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // If resolving this recommendation leaves none open, queue the close-visit task.
  const maybeQueueCloseTask = async (changedRecId: string) => {
    const allResolved = recommendations.length > 0 && recommendations.every(r =>
      r.id === changedRecId ? true : (r.status === 'completed' || r.status === 'cancelled')
    );
    if (allResolved && visit) {
      await createCloseVisitTask(supabase, visitId, visit.maintenance_engineer_id);
    }
  };

  const handleCompleteRecommendation = async (recommendationId: string) => {
    // Find the recommendation to check if SAP details are required
    const rec = recommendations.find(r => r.id === recommendationId);
    if (rec?.review_decision === 'request_sap' && !rec.sap_notification_number) {
      alert('SAP notification number and due date are required before completing this recommendation.');
      return;
    }

    try {
      const { error } = await supabase
        .from('recommendations')
        .update({
          status: 'completed' as RecommendationStatus,
          completed_at: new Date().toISOString(),
        })
        .eq('id', recommendationId);

      if (error) throw error;
      await maybeQueueCloseTask(recommendationId);
      await fetchVisitData();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const openSapDetailsModal = (rec: RecommendationWithCreator) => {
    setSelectedRecForSap(rec);
    setSapDetails({
      sap_notification_number: rec.sap_notification_number || '',
      due_date: rec.due_date || '',
    });
    setSapDetailsModalOpen(true);
  };

  const handleSaveSapDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRecForSap) return;

    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const { error: updateError } = await supabase
        .from('recommendations')
        .update({
          sap_notification_number: sapDetails.sap_notification_number,
          due_date: sapDetails.due_date,
        })
        .eq('id', selectedRecForSap.id);

      if (updateError) throw updateError;

      await fetchVisitData();
      setSapDetailsModalOpen(false);
      setSelectedRecForSap(null);
      setSapDetails({ sap_notification_number: '', due_date: '' });
      setSuccess('SAP details saved successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
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
      await maybeQueueCloseTask(recommendationId);
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

      // Sweep any remaining open workflow tasks closed so none linger as overdue.
      await completeVisitTasks(supabase, visitId, [
        'confirm_visit_date',
        'upload_report',
        'create_recommendations',
        'technical_review',
        'close_visit',
      ]);

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
        .in('status', ['pending', 'in_progress', 'overdue']);

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

      await fetchVisitData();
      setRescheduleModalOpen(false);
      setRescheduleData({ new_date: '', reason: '' });
      setSuccess('Visit rescheduled successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNoReportAvailable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noReportReason.trim()) return;

    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const { error: updateError } = await supabase
        .from('maintenance_visits')
        .update({
          no_report_reason: noReportReason,
          status: 'report_uploaded' as VisitStatus,
        })
        .eq('id', visitId);

      if (updateError) throw updateError;

      // Close the upload task and queue the recommendations task.
      await completeVisitTasks(supabase, visitId, ['upload_report']);
      if (visit) await createRecommendationsTask(supabase, visitId, visit.maintenance_engineer_id);

      await fetchVisitData();
      setNoReportModalOpen(false);
      setNoReportReason('');
      setSuccess('Marked as no report available');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const openReassignModal = () => {
    if (visit) {
      setReassignData({
        vendor_coordinator_id: visit.vendor_coordinator_id,
        maintenance_engineer_id: visit.maintenance_engineer_id,
        technical_engineer_id: visit.technical_engineer_id,
      });
      setReassignModalOpen(true);
    }
  };

  const handleReassignTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!visit) return;

    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const { error: updateError } = await supabase
        .from('maintenance_visits')
        .update({
          vendor_coordinator_id: reassignData.vendor_coordinator_id,
          maintenance_engineer_id: reassignData.maintenance_engineer_id,
          technical_engineer_id: reassignData.technical_engineer_id,
        })
        .eq('id', visitId);

      if (updateError) throw updateError;

      await fetchVisitData();
      setReassignModalOpen(false);
      setSuccess('Team members reassigned successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  // Memoized workflow configuration (static data)
  const workflowSteps = useMemo(() => [
    { step: 1, label: 'Scheduled', description: 'Visit date set' },
    { step: 2, label: 'Date Confirmed', description: 'Vendor coordinator confirmed' },
    { step: 3, label: 'Report Uploaded', description: 'Maintenance report received' },
    { step: 4, label: 'Recommendations', description: 'Engineer created recommendations' },
    { step: 5, label: 'In Review', description: 'Technical review in progress' },
    { step: 6, label: 'Completed', description: 'Visit closed' },
  ], []);

  // Memoized current step calculation
  const currentStep = useMemo(() => {
    if (!visit) return 1;
    const steps: Record<VisitStatus, number> = {
      scheduled: 1,
      date_confirmed: 2,
      report_uploaded: 3,
      recommendations_created: 4,
      in_review: 5,
      completed: 6,
      cancelled: 0,
    };
    return steps[visit.status] || 1;
  }, [visit?.status]);

  // Memoized waiting for calculation
  const waitingFor = useMemo(() => {
    if (!visit || visit.status === 'completed' || visit.status === 'cancelled') return null;

    switch (visit.status) {
      case 'scheduled':
        return { name: visit.vendor_coordinator?.full_name || 'Vendor Coordinator', role: 'Vendor Coordinator', action: 'to confirm visit date' };
      case 'date_confirmed':
        return { name: visit.vendor_coordinator?.full_name || 'Vendor Coordinator', role: 'Vendor Coordinator', action: 'to upload maintenance report' };
      case 'report_uploaded':
        return { name: visit.maintenance_engineer?.full_name || 'Maintenance Engineer', role: 'Maintenance Engineer', action: 'to create recommendations' };
      case 'recommendations_created':
        return { name: visit.maintenance_engineer?.full_name || 'Maintenance Engineer', role: 'Maintenance Engineer', action: 'to complete or close visit' };
      case 'in_review':
        return { name: visit.technical_engineer?.full_name || 'Technical Engineer', role: 'Technical Engineer', action: 'to review recommendations' };
      default:
        return null;
    }
  }, [visit?.status, visit?.vendor_coordinator?.full_name, visit?.maintenance_engineer?.full_name, visit?.technical_engineer?.full_name]);

  // Memoized status variant helper
  const getStatusVariant = useCallback((status: string): 'pending' | 'in_progress' | 'completed' | 'cancelled' => {
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
  }, []);

  // Memoized permission checks
  const { canConfirmDate, canUploadReport, canCreateRecommendation, canReview, canReschedule, canCloseVisit, canReopenVisit, hasReports } = useMemo(() => {
    if (!visit) {
      return {
        canConfirmDate: false,
        canUploadReport: false,
        hasReports: false,
        canCreateRecommendation: false,
        canReview: false,
        canReschedule: false,
        canCloseVisit: false,
        canReopenVisit: false,
      };
    }

    const isAdmin = hasRole('admin');
    const isVendorCoord = userProfile?.id === visit.vendor_coordinator_id;
    const isMaintEng = userProfile?.id === visit.maintenance_engineer_id;
    const isTechEng = userProfile?.id === visit.technical_engineer_id;
    const isNotClosed = visit.status !== 'completed' && visit.status !== 'cancelled';

    const _hasReports = visitReports.length > 0 || !!visit.no_report_reason;
    // No recommendation is still awaiting action (true when there are none).
    const noOpenRecs = recommendations.every(r => r.status === 'completed' || r.status === 'cancelled');

    return {
      canConfirmDate: isVendorCoord || isAdmin,
      canUploadReport: (isVendorCoord || isAdmin) && (visit.status === 'date_confirmed' || (visitReports.length > 0 && isNotClosed)),
      hasReports: _hasReports,
      canCreateRecommendation: (isMaintEng || isAdmin) && _hasReports && isNotClosed,
      canReview: isTechEng || isAdmin,
      // Reschedule only makes sense before a report exists for the visit.
      canReschedule: (isVendorCoord || isAdmin) && (visit.status === 'scheduled' || visit.status === 'date_confirmed'),
      // Closable once a report (or no-report reason) is recorded and nothing is
      // left open — including the common case of a visit with no recommendations.
      canCloseVisit: (isMaintEng || isAdmin) && isNotClosed && _hasReports && noOpenRecs,
      canReopenVisit: isAdmin && visit.status === 'completed',
    };
  }, [visit, visitReports.length, recommendations, userProfile?.id, hasRole]);

  // Memoized activity log
  const activities = useMemo(() => {
    if (!visit) return [];

    const items: { date: string; event: string; details?: string }[] = [];

    // Visit created
    if (visit.created_at) {
      const originalScheduledDate = visit.rescheduled_from || visit.scheduled_date;
      items.push({
        date: visit.created_at,
        event: 'Visit created',
        details: `Scheduled for ${format(new Date(originalScheduledDate), 'MMM d, yyyy')}`,
      });
    }

    // Date confirmed
    if (visit.confirmed_date) {
      items.push({
        date: visit.confirmed_at || visit.updated_at,
        event: 'Visit date confirmed',
        details: `Confirmed for ${format(new Date(visit.confirmed_date), 'MMM d, yyyy')}`,
      });
    }

    // Rescheduled
    if (visit.rescheduled_at) {
      let details = `From ${visit.rescheduled_from ? format(new Date(visit.rescheduled_from), 'MMM d') : 'previous date'} to ${format(new Date(visit.scheduled_date), 'MMM d, yyyy')}`;
      if (visit.reschedule_reason) {
        details += `. ${visit.reschedule_reason}`;
      }
      items.push({ date: visit.rescheduled_at, event: 'Visit rescheduled', details });
    }

    // Reports uploaded
    visitReports.forEach(report => {
      let details = report.file_name;
      if (report.uploaded_by?.full_name) details += ` (${report.uploaded_by.full_name})`;
      if (report.notes) details += `. ${report.notes}`;
      items.push({ date: report.uploaded_at, event: 'Report uploaded', details });
    });

    // No report reason
    if (visit.no_report_reason && visitReports.length === 0) {
      items.push({ date: visit.updated_at, event: 'No report available', details: visit.no_report_reason });
    }

    // Recommendations
    recommendations.forEach(rec => {
      items.push({
        date: rec.created_at,
        event: 'Recommendation created',
        details: rec.description.substring(0, 80) + (rec.description.length > 80 ? '...' : ''),
      });
      if (rec.reviewed_at) {
        items.push({
          date: rec.reviewed_at,
          event: 'Recommendation reviewed',
          details: `By ${rec.reviewed_by?.full_name || 'Technical Engineer'}`,
        });
      }
      if (rec.completed_at) {
        items.push({
          date: rec.completed_at,
          event: 'Recommendation completed',
          details: rec.description.substring(0, 40) + (rec.description.length > 40 ? '...' : ''),
        });
      }
      if (rec.cancelled_at) {
        items.push({ date: rec.cancelled_at, event: 'Recommendation cancelled', details: rec.cancellation_reason || undefined });
      }
    });

    // Tasks completed
    const taskLabels: Record<string, string> = {
      confirm_visit_date: 'Date confirmation task',
      upload_report: 'Report upload task',
      create_recommendations: 'Recommendations task',
      review_recommendations: 'Review task',
      technical_review: 'Technical review task',
      close_visit: 'Close visit task',
    };
    tasks.filter(t => t.completed_at).forEach(task => {
      items.push({ date: task.completed_at!, event: `${taskLabels[task.task_type] || task.task_type} completed` });
    });

    // Sort by date descending
    return items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [visit, visitReports, recommendations, tasks]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-start sm:items-center gap-3 sm:gap-4">
        <Link href="/visits" className="flex-shrink-0">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 sm:mr-2" />
            <span className="hidden sm:inline">Back</span>
          </Button>
        </Link>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">
            Visit: {visit.routine?.plan_number}
          </h1>
          <p className="text-sm sm:text-base text-gray-600 line-clamp-2">{visit.routine?.description}</p>
        </div>
      </div>

      {/* Workflow Progress Stepper */}
      {visit.status !== 'cancelled' && (
        <Card>
          <CardContent className="py-4 sm:py-6 px-2 sm:px-6">
            <div className="overflow-x-auto -mx-2 px-2 pb-2">
              <div className="flex items-center justify-between min-w-[500px] sm:min-w-0">
                {workflowSteps.map((step, index) => {
                  // When visit is completed, all steps should show as done (green with checkmark)
                  const isCompleted = visit.status === 'completed';
                  const isStepDone = isCompleted ? true : currentStep > step.step;
                  const isCurrentStep = !isCompleted && currentStep === step.step;

                  return (
                    <div key={step.step} className="flex items-center flex-1">
                      <div className="flex flex-col items-center">
                        <div
                          className={`w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center text-xs sm:text-sm font-medium border-2 transition-colors ${
                            isStepDone
                              ? 'bg-green-500 border-green-500 text-white'
                              : isCurrentStep
                              ? 'bg-blue-500 border-blue-500 text-white'
                              : 'bg-white border-gray-300 text-gray-400'
                          }`}
                        >
                          {isStepDone ? (
                            <Check className="w-4 h-4 sm:w-5 sm:h-5" />
                          ) : (
                            step.step
                          )}
                        </div>
                        <div className="mt-1 sm:mt-2 text-center max-w-[60px] sm:max-w-none">
                          <p
                            className={`text-[10px] sm:text-xs font-medium leading-tight ${
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
                          className={`flex-1 h-0.5 sm:h-1 mx-1 sm:mx-2 ${
                            isCompleted || currentStep > step.step ? 'bg-green-500' : 'bg-gray-200'
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
            {waitingFor && (
              <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-gray-200">
                <div className="flex items-center justify-center text-xs sm:text-sm flex-wrap gap-1 text-center">
                  <Clock className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <span className="text-gray-600">Waiting for</span>
                  <span className="font-medium text-gray-900">{waitingFor.name}</span>
                  <span className="text-gray-600">{waitingFor.action}</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Visit Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2 sm:pb-4">
            <CardTitle className="text-base sm:text-lg">Visit Information</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div>
                <p className="text-xs sm:text-sm text-gray-500">Vendor</p>
                <p className="font-medium text-sm sm:text-base">{visit.routine?.vendor?.name}</p>
              </div>
              <div>
                <p className="text-xs sm:text-sm text-gray-500">Status</p>
                <Badge variant={getStatusVariant(visit.status)}>
                  {visit.status.replace(/_/g, ' ')}
                </Badge>
              </div>
              <div>
                <p className="text-xs sm:text-sm text-gray-500">Scheduled Date</p>
                <p className="font-medium text-sm sm:text-base">{format(new Date(visit.scheduled_date), 'MMM d, yyyy')}</p>
              </div>
              <div>
                <p className="text-xs sm:text-sm text-gray-500">Confirmed Date</p>
                <p className="font-medium text-sm sm:text-base">
                  {visit.confirmed_date
                    ? format(new Date(visit.confirmed_date), 'MMM d, yyyy')
                    : 'Not confirmed'}
                </p>
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-xs sm:text-sm text-gray-500">Notification Number</p>
                  {canReschedule && (
                    <button
                      type="button"
                      onClick={openNotificationModal}
                      className="text-primary-600 hover:text-primary-700"
                      title="Edit notification number"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <p className="font-medium text-sm sm:text-base">{visit.notification_number || '-'}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-xs sm:text-sm text-gray-500 mb-2">Reports ({visitReports.length})</p>
                {visitReports.length > 0 ? (
                  <div className="space-y-2">
                    {visitReports.map((report) => (
                      <div key={report.id} className="flex items-start sm:items-center justify-between bg-gray-50 rounded-lg p-2 gap-2">
                        <div className="flex items-start sm:items-center gap-2 sm:gap-3 flex-1 min-w-0">
                          <FileText className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400 flex-shrink-0 mt-0.5 sm:mt-0" />
                          <div className="min-w-0">
                            <p className="font-medium text-xs sm:text-sm truncate">{report.file_name}</p>
                            <p className="text-[10px] sm:text-xs text-gray-500">
                              <span className="hidden sm:inline">Uploaded by {report.uploaded_by?.full_name} on </span>
                              <span className="sm:hidden">{report.uploaded_by?.full_name} - </span>
                              {format(new Date(report.uploaded_at), 'MMM d, yyyy')}
                            </p>
                            {report.notes && (
                              <p className="text-[10px] sm:text-xs text-gray-500 mt-1 line-clamp-2">{report.notes}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleDownloadReport(report.file_path, report.file_name)}
                            title="Download"
                            className="h-8 w-8 p-0"
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                          {hasRole('admin') && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleDeleteReport(report.id, report.file_path)}
                              title="Delete"
                              className="h-8 w-8 p-0"
                            >
                              <Trash2 className="w-4 h-4 text-red-500" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : visit.no_report_reason ? (
                  <div>
                    <p className="text-amber-600 font-medium text-sm">No report available</p>
                    <p className="text-xs sm:text-sm text-gray-500">{visit.no_report_reason}</p>
                  </div>
                ) : (
                  <p className="text-gray-400 text-sm">No reports uploaded</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 sm:pb-4">
            <CardTitle className="text-base sm:text-lg">Assigned Team</CardTitle>
            {hasRole('admin') && visit.status !== 'completed' && visit.status !== 'cancelled' && (
              <Button variant="ghost" size="sm" onClick={openReassignModal} className="h-8 px-2">
                <Users className="w-4 h-4 sm:mr-1" />
                <span className="hidden sm:inline">Reassign</span>
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-3 sm:space-y-4">
            <div>
              <p className="text-xs sm:text-sm text-gray-500">Vendor Coordinator</p>
              <p className="font-medium text-sm sm:text-base">{visit.vendor_coordinator?.full_name}</p>
              <p className="text-xs sm:text-sm text-gray-400 truncate">{visit.vendor_coordinator?.email}</p>
            </div>
            <div>
              <p className="text-xs sm:text-sm text-gray-500">Maintenance Engineer</p>
              <p className="font-medium text-sm sm:text-base">{visit.maintenance_engineer?.full_name}</p>
              <p className="text-xs sm:text-sm text-gray-400 truncate">{visit.maintenance_engineer?.email}</p>
            </div>
            <div>
              <p className="text-xs sm:text-sm text-gray-500">Technical Engineer</p>
              <p className="font-medium text-sm sm:text-base">{visit.technical_engineer?.full_name}</p>
              <p className="text-xs sm:text-sm text-gray-400 truncate">{visit.technical_engineer?.email}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Workflow Actions */}
      <Card>
        <CardHeader className="pb-2 sm:pb-4">
          <CardTitle className="text-base sm:text-lg">Workflow Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2 sm:gap-3">
            {visit.status === 'scheduled' && canConfirmDate && (
              <Button onClick={openConfirmDateModal} size="sm" className="text-xs sm:text-sm">
                <Calendar className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Confirm Visit Date</span>
                <span className="sm:hidden ml-1">Confirm</span>
              </Button>
            )}
            {canUploadReport && (
              <>
                <Button onClick={() => setUploadModalOpen(true)} size="sm" className="text-xs sm:text-sm">
                  <Upload className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">Upload Report</span>
                  <span className="sm:hidden ml-1">Upload</span>
                </Button>
                <Button variant="secondary" onClick={() => setNoReportModalOpen(true)} size="sm" className="text-xs sm:text-sm">
                  <FileX className="w-4 h-4 sm:mr-2" />
                  <span className="hidden sm:inline">No Report Available</span>
                  <span className="sm:hidden ml-1">No Report</span>
                </Button>
              </>
            )}
            {canCreateRecommendation && (
              <Button onClick={() => setRecommendationModalOpen(true)} size="sm" className="text-xs sm:text-sm">
                <Plus className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Add Recommendation</span>
                <span className="sm:hidden ml-1">Add Rec.</span>
              </Button>
            )}
            {canReschedule && (
              <Button variant="secondary" onClick={() => setRescheduleModalOpen(true)} size="sm" className="text-xs sm:text-sm">
                <RefreshCw className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Reschedule Visit</span>
                <span className="sm:hidden ml-1">Reschedule</span>
              </Button>
            )}
            {canCloseVisit && (
              <Button onClick={handleCloseVisit} className="bg-green-600 hover:bg-green-700 text-xs sm:text-sm" size="sm">
                <CheckCircle className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Close Visit</span>
                <span className="sm:hidden ml-1">Close</span>
              </Button>
            )}
            {visit.status === 'completed' && (
              <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                <div className="flex items-center text-green-600">
                  <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5 mr-1 sm:mr-2" />
                  <span className="font-medium text-sm sm:text-base">Completed</span>
                </div>
                {canReopenVisit && (
                  <Button variant="secondary" onClick={handleReopenVisit} size="sm" className="text-xs sm:text-sm">
                    <RotateCcw className="w-4 h-4 sm:mr-2" />
                    <span className="hidden sm:inline">Reopen Visit</span>
                    <span className="sm:hidden ml-1">Reopen</span>
                  </Button>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Recommendations */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2 sm:pb-4">
          <CardTitle className="text-base sm:text-lg">Recommendations</CardTitle>
          <span className="text-xs sm:text-sm text-gray-500">{recommendations.length} items</span>
        </CardHeader>
        <CardContent>
          {recommendations.length === 0 ? (
            <p className="text-gray-500 text-center py-4 text-sm">No recommendations yet.</p>
          ) : (
            <>
              {/* Mobile Card View */}
              <div className="sm:hidden space-y-3">
                {recommendations.map((rec) => (
                  <div key={rec.id} className="bg-gray-50 rounded-lg p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium line-clamp-2 flex-1">{rec.description}</p>
                      <Badge variant={getStatusVariant(rec.status)} className="flex-shrink-0 text-[10px]">
                        {rec.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    {rec.review_decision && (
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={rec.review_decision === 'no_action' ? 'completed' : 'in_progress'} className="text-[10px]">
                            {rec.review_decision === 'no_action' && 'No Action'}
                            {rec.review_decision === 'request_sap' && 'SAP Requested'}
                            {rec.review_decision === 'other_action' && 'Action Required'}
                          </Badge>
                          {rec.action_assigned_to && (
                            <span className="text-[10px] text-gray-500">→ {rec.action_assigned_to.full_name}</span>
                          )}
                        </div>
                        {rec.review_action_description && (
                          <p className="text-[10px] text-gray-600">{rec.review_action_description}</p>
                        )}
                        {rec.technical_review_response && (
                          <p className="text-[10px] text-gray-500 italic line-clamp-2">&quot;{rec.technical_review_response}&quot;</p>
                        )}
                      </div>
                    )}
                    <div className="flex items-center justify-between text-[10px] text-gray-500 pt-1 border-t border-gray-200">
                      <div className="flex gap-3">
                        {rec.sap_notification_number && <span>SAP: {rec.sap_notification_number}</span>}
                        {rec.due_date && <span>Due: {format(new Date(rec.due_date), 'MMM d')}</span>}
                      </div>
                      <span>By {rec.created_by?.full_name}</span>
                    </div>
                    <div className="flex items-center justify-end gap-1 pt-1">
                      {rec.status === 'open' && !rec.sent_for_review && (userProfile?.id === visit.maintenance_engineer_id || hasRole('admin')) && (
                        <Button variant="ghost" size="sm" onClick={() => handleSendForReview(rec.id)} className="h-7 px-2 text-[10px]">
                          <FileText className="w-3 h-3 text-blue-500 mr-1" />Review
                        </Button>
                      )}
                      {rec.sent_for_review && rec.status === 'in_review' && canReview && (
                        <Button variant="ghost" size="sm" onClick={() => { setSelectedRecommendation(rec); setReviewModalOpen(true); }} className="h-7 px-2 text-[10px]">
                          <FileText className="w-3 h-3 text-purple-500 mr-1" />Review
                        </Button>
                      )}
                      {rec.status === 'approved' && rec.review_decision === 'request_sap' && !rec.sap_notification_number && (userProfile?.id === visit.maintenance_engineer_id || hasRole('admin')) && (
                        <Button variant="ghost" size="sm" onClick={() => openSapDetailsModal(rec)} className="h-7 px-2 text-[10px] text-amber-600">
                          <Edit3 className="w-3 h-3 mr-1" />SAP
                        </Button>
                      )}
                      {(rec.status === 'open' || rec.status === 'approved') && (userProfile?.id === visit.maintenance_engineer_id || hasRole('admin')) && (
                        <>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCompleteRecommendation(rec.id)}
                            disabled={rec.review_decision === 'request_sap' && !rec.sap_notification_number}
                            className="h-7 w-7 p-0"
                          >
                            <CheckCircle className={`w-4 h-4 ${rec.review_decision === 'request_sap' && !rec.sap_notification_number ? 'text-gray-300' : 'text-green-500'}`} />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleCancelRecommendation(rec.id)} className="h-7 w-7 p-0">
                            <XCircle className="w-4 h-4 text-red-500" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {/* Desktop Table View */}
              <div className="hidden sm:block">
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
                          {rec.review_decision && (
                            <div className="mt-2 space-y-1">
                              <div className="flex items-center gap-2">
                                <Badge variant={rec.review_decision === 'no_action' ? 'completed' : 'in_progress'}>
                                  {rec.review_decision === 'no_action' && 'No Action'}
                                  {rec.review_decision === 'request_sap' && 'SAP Notification Requested'}
                                  {rec.review_decision === 'other_action' && 'Action Required'}
                                </Badge>
                                {rec.action_assigned_to && (
                                  <span className="text-xs text-gray-500">
                                    → {rec.action_assigned_to.full_name}
                                  </span>
                                )}
                              </div>
                              {rec.review_action_description && (
                                <p className="text-xs text-gray-600">{rec.review_action_description}</p>
                              )}
                              {rec.technical_review_response && (
                                <p className="text-xs text-gray-500 italic">&quot;{rec.technical_review_response}&quot;</p>
                              )}
                            </div>
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
                            {rec.status === 'approved' && rec.review_decision === 'request_sap' && !rec.sap_notification_number && (userProfile?.id === visit.maintenance_engineer_id || hasRole('admin')) && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => openSapDetailsModal(rec)}
                                title="Add SAP Details (Required)"
                                className="text-amber-600"
                              >
                                <Edit3 className="w-4 h-4" />
                              </Button>
                            )}
                            {(rec.status === 'open' || rec.status === 'approved') && (userProfile?.id === visit.maintenance_engineer_id || hasRole('admin')) && (
                              <>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleCompleteRecommendation(rec.id)}
                                  title={rec.review_decision === 'request_sap' && !rec.sap_notification_number ? 'Add SAP details first' : 'Mark Complete'}
                                  disabled={rec.review_decision === 'request_sap' && !rec.sap_notification_number}
                                >
                                  <CheckCircle className={`w-4 h-4 ${rec.review_decision === 'request_sap' && !rec.sap_notification_number ? 'text-gray-300' : 'text-green-500'}`} />
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
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Activity Log */}
      <Card>
        <CardHeader className="pb-2 sm:pb-4">
          <CardTitle className="flex items-center text-base sm:text-lg">
            <Clock className="w-4 h-4 sm:w-5 sm:h-5 mr-2" />
            Activity Log
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 sm:space-y-4">
            {activities.length === 0 ? (
              <p className="text-gray-500 text-center py-4 text-sm">No activity recorded yet.</p>
            ) : (
              <div className="relative">
                <div className="absolute left-3 sm:left-4 top-0 bottom-0 w-0.5 bg-gray-200" />
                <div className="space-y-3 sm:space-y-4">
                  {activities.map((activity, idx) => (
                    <div key={idx} className="relative pl-8 sm:pl-10">
                      <div className="absolute left-1.5 sm:left-2.5 w-3 h-3 bg-primary-500 rounded-full border-2 border-white" />
                      <div className="bg-gray-50 rounded-lg p-2 sm:p-3">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-0.5 sm:gap-2">
                          <p className="font-medium text-gray-900 text-sm">{activity.event}</p>
                          <p className="text-[10px] sm:text-sm text-gray-500">
                            {format(new Date(activity.date), 'MMM d, h:mm a')}
                          </p>
                        </div>
                        {activity.details && (
                          <p className="text-xs sm:text-sm text-gray-600 mt-1 line-clamp-2">{activity.details}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Upload Report Modal */}
      <Modal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        title={visitReports.length > 0 ? 'Upload Additional Report' : 'Upload Maintenance Report'}
      >
        <form onSubmit={handleUploadReport} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          {visitReports.length > 0 && (
            <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-800">
              This visit already has {visitReports.length} report{visitReports.length > 1 ? 's' : ''}. You can upload additional reports if needed.
            </div>
          )}

          <Input
            label="Report File"
            name="report"
            type="file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
            required
            accept=".pdf,.doc,.docx,.xls,.xlsx"
          />

          <Textarea
            label="Notes (optional)"
            name="notes"
            value={reportNotes}
            onChange={(e) => setReportNotes(e.target.value)}
            placeholder="Add any notes about this report..."
            rows={2}
          />

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setUploadModalOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!file} className="w-full sm:w-auto">
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

          {visit?.routine?.requires_technical_review && (
            <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-800">
              This recommendation will be sent to the Technical Engineer for review before SAP notification details can be added.
            </div>
          )}

          <Textarea
            label="Description"
            name="description"
            value={newRecommendation.description}
            onChange={(e) => setNewRecommendation({ ...newRecommendation, description: e.target.value })}
            required
            placeholder="Describe the recommendation..."
            rows={4}
          />

          {!visit?.routine?.requires_technical_review && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
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
          )}

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setRecommendationModalOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={submitting} className="w-full sm:w-auto">
              {visit?.routine?.requires_technical_review ? 'Send for Review' : 'Create'}
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

          <Select
            label="Decision"
            name="review_decision"
            value={reviewDecision}
            onChange={(e) => setReviewDecision(e.target.value as ReviewDecisionType | '')}
            required
            placeholder="Select your decision"
            options={[
              { value: 'no_action', label: 'No Further Action Required' },
              { value: 'request_sap', label: 'Request SAP Notification' },
              { value: 'other_action', label: 'Other Action Required' },
            ]}
          />

          {reviewDecision === 'other_action' && (
            <Textarea
              label="Action Description"
              name="action_description"
              value={reviewActionDescription}
              onChange={(e) => setReviewActionDescription(e.target.value)}
              required
              placeholder="Describe the action required..."
              rows={2}
            />
          )}

          {reviewDecision && reviewDecision !== 'no_action' && (
            <Select
              label="Assign Action To"
              name="assign_to"
              value={reviewAssignToId}
              onChange={(e) => setReviewAssignToId(e.target.value)}
              placeholder="Select who should take action"
              options={users.map(user => ({ value: user.id, label: `${user.full_name} (${user.role.replace(/_/g, ' ')})` }))}
            />
          )}

          <Textarea
            label={reviewDecision === 'no_action' ? 'Justification' : 'Comments'}
            name="review_response"
            value={reviewResponse}
            onChange={(e) => setReviewResponse(e.target.value)}
            required
            placeholder={reviewDecision === 'no_action'
              ? 'Provide justification for no further action...'
              : 'Add any additional comments...'}
            rows={3}
          />

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setReviewModalOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!reviewDecision} className="w-full sm:w-auto">
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

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setRescheduleModalOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={submitting} className="w-full sm:w-auto">
              Reschedule
            </Button>
          </div>
        </form>
      </Modal>

      {/* No Report Available Modal */}
      <Modal
        isOpen={noReportModalOpen}
        onClose={() => setNoReportModalOpen(false)}
        title="No Report Available"
      >
        <form onSubmit={handleNoReportAvailable} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <p className="text-sm text-gray-600">
            Please provide a reason why no maintenance report is available for this visit.
          </p>

          <Textarea
            label="Reason"
            name="no_report_reason"
            value={noReportReason}
            onChange={(e) => setNoReportReason(e.target.value)}
            required
            placeholder="e.g., Visit was cancelled by vendor, No work performed, etc."
            rows={3}
          />

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setNoReportModalOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!noReportReason.trim()} className="w-full sm:w-auto">
              Confirm
            </Button>
          </div>
        </form>
      </Modal>

      {/* Reassign Team Modal */}
      <Modal
        isOpen={reassignModalOpen}
        onClose={() => setReassignModalOpen(false)}
        title="Reassign Team Members"
        size="lg"
      >
        <form onSubmit={handleReassignTeam} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <Select
            label="Vendor Coordinator"
            name="vendor_coordinator_id"
            value={reassignData.vendor_coordinator_id}
            onChange={(e) => setReassignData({ ...reassignData, vendor_coordinator_id: e.target.value })}
            required
            placeholder="Select Vendor Coordinator"
            options={users
              .filter(u => u.role === 'vendor_coordinator' || u.role === 'admin')
              .map(user => ({ value: user.id, label: user.full_name }))}
          />

          <Select
            label="Maintenance Engineer"
            name="maintenance_engineer_id"
            value={reassignData.maintenance_engineer_id}
            onChange={(e) => setReassignData({ ...reassignData, maintenance_engineer_id: e.target.value })}
            required
            placeholder="Select Maintenance Engineer"
            options={users
              .filter(u => u.role === 'maintenance_engineer' || u.role === 'admin')
              .map(user => ({ value: user.id, label: user.full_name }))}
          />

          <Select
            label="Technical Engineer"
            name="technical_engineer_id"
            value={reassignData.technical_engineer_id}
            onChange={(e) => setReassignData({ ...reassignData, technical_engineer_id: e.target.value })}
            required
            placeholder="Select Technical Engineer"
            options={users
              .filter(u => u.role === 'technical_engineer' || u.role === 'admin')
              .map(user => ({ value: user.id, label: user.full_name }))}
          />

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setReassignModalOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={submitting} className="w-full sm:w-auto">
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* SAP Details Modal */}
      <Modal
        isOpen={sapDetailsModalOpen}
        onClose={() => setSapDetailsModalOpen(false)}
        title="Add SAP Notification Details"
      >
        <form onSubmit={handleSaveSapDetails} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <div className="bg-amber-50 p-3 rounded-lg text-sm text-amber-800">
            The Technical Engineer has requested an SAP notification for this recommendation. Please provide the SAP notification number and due date.
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-500">Recommendation</p>
            <p className="font-medium">{selectedRecForSap?.description}</p>
          </div>

          <Input
            label="SAP Notification Number"
            name="sap_notification_number"
            value={sapDetails.sap_notification_number}
            onChange={(e) => setSapDetails({ ...sapDetails, sap_notification_number: e.target.value })}
            required
            placeholder="Enter SAP notification number"
          />

          <Input
            label="Due Date"
            name="due_date"
            type="date"
            value={sapDetails.due_date}
            onChange={(e) => setSapDetails({ ...sapDetails, due_date: e.target.value })}
            required
          />

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setSapDetailsModalOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={submitting} className="w-full sm:w-auto">
              Save SAP Details
            </Button>
          </div>
        </form>
      </Modal>

      {/* Confirm Visit Date Modal */}
      <Modal
        isOpen={confirmDateModalOpen}
        onClose={() => setConfirmDateModalOpen(false)}
        title="Confirm Visit Date"
      >
        <form onSubmit={handleConfirmDate} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <div className="bg-gray-50 p-4 rounded-lg">
            <p className="text-sm text-gray-500">Scheduled Date</p>
            <p className="font-medium">
              {visit?.scheduled_date && format(new Date(visit.scheduled_date), 'MMMM d, yyyy')}
            </p>
          </div>

          <Input
            label="Confirmed Visit Date"
            name="confirmed_date"
            type="date"
            value={confirmDateValue}
            onChange={(e) => setConfirmDateValue(e.target.value)}
            required
          />

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setConfirmDateModalOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!confirmDateValue} className="w-full sm:w-auto">
              Confirm Date
            </Button>
          </div>
        </form>
      </Modal>

      {/* Notification Number Modal */}
      <Modal
        isOpen={notificationModalOpen}
        onClose={() => setNotificationModalOpen(false)}
        title="Edit Notification Number"
      >
        <form onSubmit={handleSaveNotification} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <p className="text-sm text-gray-600">
            The notification number is unique to this visit (the maintenance plan covers all of its visits).
          </p>

          <Input
            label="Notification Number"
            name="notification_number"
            value={notificationValue}
            onChange={(e) => setNotificationValue(e.target.value)}
            placeholder="e.g., NOT-2026-0042"
          />

          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setNotificationModalOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={submitting} className="w-full sm:w-auto">
              Save
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
