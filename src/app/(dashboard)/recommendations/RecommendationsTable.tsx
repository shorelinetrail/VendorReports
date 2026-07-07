'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle, Eye, FileText, XCircle } from 'lucide-react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import EmptyState from '@/components/ui/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useAction } from '@/lib/use-action';
import { cancelRecommendation, completeRecommendation, submitReview } from '@/lib/actions/recommendations';
import {
  formatDate,
  isOverdue,
  REC_STATUS_LABELS,
  REC_STATUS_VARIANTS,
  ROLE_LABELS,
} from '@/lib/labels';
import type { ReviewDecisionType, UserRole } from '@/types/database';

export interface RecommendationListRow {
  id: string;
  description: string;
  sap_notification_number: string | null;
  due_date: string | null;
  status: string;
  sent_for_review: boolean;
  review_decision: ReviewDecisionType | null;
  technical_review_response: string | null;
  visit: {
    id: string;
    maintenance_engineer_id: string;
    technical_engineer_id: string;
    routine: { plan_number: string; vendor: { name: string } | null } | null;
  } | null;
  created_by: { full_name: string } | null;
}

interface Props {
  recommendations: RecommendationListRow[];
  users: { id: string; full_name: string; role: UserRole }[];
  profileId: string;
  isAdmin: boolean;
}

export default function RecommendationsTable({ recommendations, users, profileId, isAdmin }: Props) {
  const { pending, run } = useAction();

  const [reviewTarget, setReviewTarget] = useState<RecommendationListRow | null>(null);
  const [decision, setDecision] = useState<ReviewDecisionType | ''>('');
  const [response, setResponse] = useState('');
  const [actionDescription, setActionDescription] = useState('');
  const [assignToId, setAssignToId] = useState('');

  const [cancelTarget, setCancelTarget] = useState<RecommendationListRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  if (recommendations.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No recommendations found"
        description="No recommendations match this filter."
      />
    );
  }

  return (
    <>
      <Table className="border-0">
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
          {recommendations.map((rec) => {
            const overdue = isOverdue(rec.due_date, rec.status);
            const canReview =
              rec.sent_for_review &&
              rec.status === 'in_review' &&
              (isAdmin || rec.visit?.technical_engineer_id === profileId);
            const canResolve =
              (rec.status === 'open' || rec.status === 'approved') &&
              (isAdmin || rec.visit?.maintenance_engineer_id === profileId);
            const needsSap = rec.review_decision === 'request_sap' && !rec.sap_notification_number;

            return (
              <TableRow key={rec.id}>
                <TableCell className="max-w-xs !whitespace-normal">
                  <p className="font-medium">{rec.description}</p>
                  {rec.technical_review_response && (
                    <p className="mt-1 truncate text-xs text-gray-500">Review: {rec.technical_review_response}</p>
                  )}
                </TableCell>
                <TableCell>
                  {rec.visit ? (
                    <Link href={`/visits/${rec.visit.id}`} className="text-primary-600 hover:text-primary-700">
                      <span className="block font-medium">{rec.visit.routine?.plan_number}</span>
                      <span className="block text-xs text-gray-500">{rec.visit.routine?.vendor?.name}</span>
                    </Link>
                  ) : (
                    '-'
                  )}
                </TableCell>
                <TableCell>{rec.sap_notification_number ?? '-'}</TableCell>
                <TableCell className={overdue ? 'font-medium text-red-600' : ''}>{formatDate(rec.due_date)}</TableCell>
                <TableCell>
                  <Badge variant={REC_STATUS_VARIANTS[rec.status as keyof typeof REC_STATUS_VARIANTS] ?? 'default'}>
                    {REC_STATUS_LABELS[rec.status as keyof typeof REC_STATUS_LABELS] ?? rec.status}
                  </Badge>
                </TableCell>
                <TableCell>{rec.created_by?.full_name}</TableCell>
                <TableCell align="right">
                  <div className="flex items-center justify-end gap-1">
                    {rec.visit && (
                      <Link href={`/visits/${rec.visit.id}`}>
                        <Button variant="ghost" size="sm" title="View visit" aria-label="View visit">
                          <Eye className="h-4 w-4" />
                        </Button>
                      </Link>
                    )}
                    {canReview && (
                      <Button
                        variant="ghost"
                        size="sm"
                        title="Submit review"
                        aria-label="Submit review"
                        onClick={() => {
                          setReviewTarget(rec);
                          setDecision('');
                          setResponse('');
                          setActionDescription('');
                          setAssignToId('');
                        }}
                      >
                        <FileText className="h-4 w-4 text-purple-500" />
                      </Button>
                    )}
                    {canResolve && (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          title={needsSap ? 'Add SAP details on the visit page first' : 'Mark complete'}
                          aria-label="Mark recommendation complete"
                          disabled={pending || needsSap}
                          onClick={() => run(() => completeRecommendation(rec.id))}
                        >
                          <CheckCircle className={`h-4 w-4 ${needsSap ? 'text-gray-300' : 'text-green-500'}`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          title="Cancel recommendation"
                          aria-label="Cancel recommendation"
                          onClick={() => {
                            setCancelTarget(rec);
                            setCancelReason('');
                          }}
                        >
                          <XCircle className="h-4 w-4 text-red-500" />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Technical review — same decision flow as the visit page */}
      <Modal open={reviewTarget !== null} onClose={() => setReviewTarget(null)} title="Submit Technical Review" size="lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!reviewTarget || !decision) return;
            run(
              () =>
                submitReview({
                  recId: reviewTarget.id,
                  decision,
                  response,
                  actionDescription,
                  assignToId: assignToId || undefined,
                }),
              { onSuccess: () => setReviewTarget(null) },
            );
          }}
        >
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-sm text-gray-500">Recommendation</p>
            <p className="font-medium">{reviewTarget?.description}</p>
            <p className="mt-1 text-xs text-gray-500">
              {reviewTarget?.visit?.routine?.plan_number} — {reviewTarget?.visit?.routine?.vendor?.name}
            </p>
          </div>
          <Select
            label="Decision"
            name="review_decision"
            required
            value={decision}
            onChange={(e) => setDecision(e.target.value as ReviewDecisionType | '')}
            placeholder="Select your decision"
            options={[
              { value: 'no_action', label: 'No Further Action Required' },
              { value: 'request_sap', label: 'Request SAP Notification' },
              { value: 'other_action', label: 'Other Action Required' },
            ]}
          />
          {decision === 'other_action' && (
            <Textarea
              label="Action Description"
              name="action_description"
              required
              rows={2}
              value={actionDescription}
              onChange={(e) => setActionDescription(e.target.value)}
              placeholder="Describe the action required…"
            />
          )}
          {decision && decision !== 'no_action' && (
            <Select
              label="Assign Action To"
              name="assign_to"
              value={assignToId}
              onChange={(e) => setAssignToId(e.target.value)}
              placeholder="Select who should take action"
              options={users.map((u) => ({ value: u.id, label: `${u.full_name} (${ROLE_LABELS[u.role]})` }))}
            />
          )}
          <Textarea
            label={decision === 'no_action' ? 'Justification' : 'Comments'}
            name="review_response"
            required
            rows={3}
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder={
              decision === 'no_action' ? 'Provide justification for no further action…' : 'Add any additional comments…'
            }
          />
          <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row sm:gap-3">
            <Button type="button" variant="secondary" onClick={() => setReviewTarget(null)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!decision || !response.trim()} className="w-full sm:w-auto">
              Submit Review
            </Button>
          </div>
        </form>
      </Modal>

      {/* Cancel with reason */}
      <Modal open={cancelTarget !== null} onClose={() => setCancelTarget(null)} title="Cancel Recommendation">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!cancelTarget) return;
            run(() => cancelRecommendation(cancelTarget.id, cancelReason), {
              onSuccess: () => setCancelTarget(null),
            });
          }}
        >
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-sm text-gray-500">Recommendation</p>
            <p className="font-medium">{cancelTarget?.description}</p>
          </div>
          <Textarea
            label="Cancellation Reason"
            name="cancellation_reason"
            required
            rows={3}
            value={cancelReason}
            onChange={(e) => setCancelReason(e.target.value)}
            placeholder="Explain why this recommendation is being cancelled…"
          />
          <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row sm:gap-3">
            <Button type="button" variant="secondary" onClick={() => setCancelTarget(null)} className="w-full sm:w-auto">
              Keep Recommendation
            </Button>
            <Button type="submit" variant="danger" loading={pending} disabled={!cancelReason.trim()} className="w-full sm:w-auto">
              Cancel Recommendation
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
