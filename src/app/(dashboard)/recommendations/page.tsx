'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, XCircle, Eye, FileText, AlertTriangle } from 'lucide-react';
import { format, isBefore } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Recommendation, RecommendationStatus } from '@/types/database';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Textarea from '@/components/ui/Textarea';
import Badge from '@/components/ui/Badge';
import Select from '@/components/ui/Select';
import Alert from '@/components/ui/Alert';
import { Card, CardContent } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import Link from 'next/link';

interface RecommendationWithDetails extends Omit<Recommendation, 'visit' | 'created_by' | 'reviewed_by'> {
  visit: {
    id: string;
    scheduled_date: string;
    routine: {
      plan_number: string;
      description: string;
      vendor: { name: string };
    };
  };
  created_by: { full_name: string };
  reviewed_by?: { full_name: string } | null;
}

export default function RecommendationsPage() {
  const { userProfile, hasRole } = useAuth();
  const [recommendations, setRecommendations] = useState<RecommendationWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('open');
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [selectedRecommendation, setSelectedRecommendation] = useState<RecommendationWithDetails | null>(null);
  const [reviewResponse, setReviewResponse] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const supabase = createClient();

  const isTechnicalEngineer = hasRole(['admin', 'technical_engineer']);

  useEffect(() => {
    fetchRecommendations();
  }, []);

  const fetchRecommendations = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('recommendations')
        .select(`
          *,
          visit:maintenance_visits(
            id,
            scheduled_date,
            routine:maintenance_routines(
              plan_number,
              description,
              vendor:vendors(name)
            )
          ),
          created_by:users!recommendations_created_by_id_fkey(full_name),
          reviewed_by:users!recommendations_reviewed_by_id_fkey(full_name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRecommendations(data as unknown as RecommendationWithDetails[]);
    } catch (err) {
      console.error('Error fetching recommendations:', err);
    } finally {
      setLoading(false);
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
        .eq('visit_id', selectedRecommendation.visit.id)
        .eq('task_type', 'technical_review')
        .eq('assigned_to_id', userProfile.id)
        .eq('status', 'pending');

      setSuccess('Review submitted successfully');
      await fetchRecommendations();
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

  const handleComplete = async (id: string) => {
    try {
      // Get the recommendation to find its visit
      const rec = recommendations.find(r => r.id === id);
      if (!rec) return;

      // Mark recommendation as completed
      const { error } = await supabase
        .from('recommendations')
        .update({
          status: 'completed' as RecommendationStatus,
          completed_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (error) throw error;

      // Check if all recommendations for this visit are now completed
      const { data: visitRecs, error: fetchError } = await supabase
        .from('recommendations')
        .select('id, status')
        .eq('visit_id', rec.visit.id);

      if (fetchError) throw fetchError;

      // If all recommendations are completed or cancelled, mark the visit as completed
      const allDone = visitRecs?.every(
        r => r.id === id || r.status === 'completed' || r.status === 'cancelled'
      );

      if (allDone && visitRecs && visitRecs.length > 0) {
        const { error: visitError } = await supabase
          .from('maintenance_visits')
          .update({ status: 'completed' })
          .eq('id', rec.visit.id);

        if (visitError) {
          console.warn('Could not update visit status:', visitError.message);
        }
      }

      await fetchRecommendations();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const handleCancel = async (id: string) => {
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
        .eq('id', id);

      if (error) throw error;
      await fetchRecommendations();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const getStatusVariant = (status: string): 'pending' | 'in_progress' | 'completed' | 'cancelled' => {
    const variants: Record<string, 'pending' | 'in_progress' | 'completed' | 'cancelled'> = {
      open: 'pending',
      in_review: 'in_progress',
      approved: 'completed',
      completed: 'completed',
      cancelled: 'cancelled',
    };
    return variants[status] || 'pending';
  };

  const filteredRecommendations = statusFilter === 'all'
    ? recommendations
    : recommendations.filter((r) => r.status === statusFilter);

  const statusOptions = [
    { value: 'all', label: 'All Statuses' },
    { value: 'open', label: 'Open' },
    { value: 'in_review', label: 'In Review' },
    { value: 'approved', label: 'Approved' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  const statusCounts = {
    open: recommendations.filter((r) => r.status === 'open').length,
    in_review: recommendations.filter((r) => r.status === 'in_review').length,
    approved: recommendations.filter((r) => r.status === 'approved').length,
    overdue: recommendations.filter((r) => r.due_date && isBefore(new Date(r.due_date), new Date()) && r.status !== 'completed' && r.status !== 'cancelled').length,
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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Recommendations</h1>
        <p className="text-gray-600">Track and manage maintenance recommendations</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <FileText className="w-8 h-8 text-yellow-500" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">Open</p>
                <p className="text-2xl font-bold">{statusCounts.open}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <Eye className="w-8 h-8 text-blue-500" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">In Review</p>
                <p className="text-2xl font-bold">{statusCounts.in_review}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <CheckCircle className="w-8 h-8 text-green-500" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">Approved</p>
                <p className="text-2xl font-bold">{statusCounts.approved}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <AlertTriangle className="w-8 h-8 text-red-500" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">Overdue</p>
                <p className="text-2xl font-bold">{statusCounts.overdue}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-4">
            <div className="w-48">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                options={statusOptions}
              />
            </div>
            <span className="text-sm text-gray-500">
              Showing {filteredRecommendations.length} recommendations
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Recommendations Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead>Plan / Vendor</TableHead>
            <TableHead>SAP Notification</TableHead>
            <TableHead>Due Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created By</TableHead>
            <TableHead align="right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredRecommendations.length === 0 ? (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-gray-500">
                No recommendations found.
              </TableCell>
            </TableRow>
          ) : (
            filteredRecommendations.map((rec) => {
              const isOverdue = rec.due_date && isBefore(new Date(rec.due_date), new Date()) && rec.status !== 'completed' && rec.status !== 'cancelled';
              return (
                <TableRow key={rec.id}>
                  <TableCell className="max-w-xs">
                    <p className="truncate font-medium">{rec.description}</p>
                    {rec.technical_review_response && (
                      <p className="text-sm text-gray-500 truncate">
                        Review: {rec.technical_review_response}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Link href={`/visits/${rec.visit?.id}`} className="text-primary-600 hover:underline">
                      {rec.visit?.routine?.plan_number}
                    </Link>
                    <p className="text-sm text-gray-500">{rec.visit?.routine?.vendor?.name}</p>
                  </TableCell>
                  <TableCell>{rec.sap_notification_number || '-'}</TableCell>
                  <TableCell>
                    {rec.due_date ? (
                      <span className={isOverdue ? 'text-red-600 font-medium' : ''}>
                        {format(new Date(rec.due_date), 'MMM d, yyyy')}
                      </span>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={getStatusVariant(rec.status)}>
                      {rec.status.replace(/_/g, ' ')}
                    </Badge>
                  </TableCell>
                  <TableCell>{rec.created_by?.full_name}</TableCell>
                  <TableCell align="right">
                    <div className="flex items-center justify-end space-x-2">
                      <Link href={`/visits/${rec.visit?.id}`}>
                        <Button variant="ghost" size="sm" title="View Visit">
                          <Eye className="w-4 h-4" />
                        </Button>
                      </Link>
                      {rec.sent_for_review && rec.status === 'in_review' && isTechnicalEngineer && (
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
                            onClick={() => handleComplete(rec.id)}
                            title="Mark Complete"
                          >
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCancel(rec.id)}
                            title="Cancel"
                          >
                            <XCircle className="w-4 h-4 text-red-500" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

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
            <p className="text-sm text-gray-500 mt-2">
              Plan: {selectedRecommendation?.visit?.routine?.plan_number} |
              Vendor: {selectedRecommendation?.visit?.routine?.vendor?.name}
            </p>
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
    </div>
  );
}
