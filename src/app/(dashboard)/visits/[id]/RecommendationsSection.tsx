'use client';

import { useState } from 'react';
import { CheckCircle, Edit3, FileText, Plus, Send, XCircle } from 'lucide-react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Textarea from '@/components/ui/Textarea';
import EmptyState from '@/components/ui/EmptyState';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useAction } from '@/lib/use-action';
import {
  cancelRecommendation,
  completeRecommendation,
  createRecommendation,
  saveSapDetails,
  sendForReview,
  submitReview,
} from '@/lib/actions/recommendations';
import {
  formatDate,
  REC_STATUS_LABELS,
  REC_STATUS_VARIANTS,
  REVIEW_DECISION_LABELS,
  ROLE_LABELS,
} from '@/lib/labels';
import type { ReviewDecisionType } from '@/types/database';
import type { RecommendationDetail, UserOption, VisitDetail, VisitPermissions } from './types';

export default function RecommendationsSection({
  visit,
  recommendations,
  permissions,
  users,
}: {
  visit: VisitDetail;
  recommendations: RecommendationDetail[];
  permissions: VisitPermissions;
  users: UserOption[];
}) {
  const { pending, run } = useAction();
  const requiresReview = visit.routine?.requires_technical_review ?? true;
  const canManageRecs = permissions.isMaintenanceEngineer || permissions.isAdmin;

  // Add modal
  const [addOpen, setAddOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [sapNumber, setSapNumber] = useState('');
  const [dueDate, setDueDate] = useState('');

  // Review modal
  const [reviewTarget, setReviewTarget] = useState<RecommendationDetail | null>(null);
  const [decision, setDecision] = useState<ReviewDecisionType | ''>('');
  const [response, setResponse] = useState('');
  const [actionDescription, setActionDescription] = useState('');
  const [assignToId, setAssignToId] = useState('');

  // SAP modal
  const [sapTarget, setSapTarget] = useState<RecommendationDetail | null>(null);
  const [sapDraft, setSapDraft] = useState({ number: '', dueDate: '' });

  // Cancel modal
  const [cancelTarget, setCancelTarget] = useState<RecommendationDetail | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  function rowActions(rec: RecommendationDetail) {
    const needsSap = rec.review_decision === 'request_sap' && !rec.sap_notification_number;
    return (
      <div className="flex items-center justify-end gap-1">
        {rec.status === 'open' && !rec.sent_for_review && canManageRecs && (
          <Button
            variant="ghost"
            size="sm"
            title="Send for technical review"
            aria-label="Send for technical review"
            disabled={pending}
            onClick={() => run(() => sendForReview(rec.id))}
          >
            <Send className="h-4 w-4 text-blue-500" />
          </Button>
        )}
        {rec.sent_for_review && rec.status === 'in_review' && permissions.canReview && (
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
        {rec.status === 'approved' && needsSap && canManageRecs && (
          <Button
            variant="ghost"
            size="sm"
            className="text-amber-600"
            title="Add SAP details (required)"
            aria-label="Add SAP details"
            onClick={() => {
              setSapTarget(rec);
              setSapDraft({ number: rec.sap_notification_number ?? '', dueDate: rec.due_date ?? '' });
            }}
          >
            <Edit3 className="h-4 w-4" />
          </Button>
        )}
        {(rec.status === 'open' || rec.status === 'approved') && canManageRecs && (
          <>
            <Button
              variant="ghost"
              size="sm"
              title={needsSap ? 'Add SAP details first' : 'Mark complete'}
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
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2 sm:pb-4">
        <CardTitle className="text-base sm:text-lg">
          Recommendations <span className="ml-1 text-sm font-normal text-gray-500">({recommendations.length})</span>
        </CardTitle>
        {permissions.canCreateRecommendation && (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            Add Recommendation
          </Button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {recommendations.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No recommendations yet"
            description={
              permissions.canCreateRecommendation
                ? 'Add action items raised by the maintenance report.'
                : 'Recommendations raised from the maintenance report will appear here.'
            }
          />
        ) : (
          <Table className="border-0">
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
                  <TableCell className="max-w-xs !whitespace-normal">
                    <p>{rec.description}</p>
                    {rec.review_decision && (
                      <div className="mt-2 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={rec.review_decision === 'no_action' ? 'completed' : 'in_progress'} size="sm">
                            {REVIEW_DECISION_LABELS[rec.review_decision]}
                          </Badge>
                          {rec.action_assigned_to && (
                            <span className="text-xs text-gray-500">→ {rec.action_assigned_to.full_name}</span>
                          )}
                        </div>
                        {rec.review_action_description && (
                          <p className="text-xs text-gray-600">{rec.review_action_description}</p>
                        )}
                        {rec.technical_review_response && (
                          <p className="text-xs italic text-gray-500">&quot;{rec.technical_review_response}&quot;</p>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{rec.sap_notification_number ?? '-'}</TableCell>
                  <TableCell>{formatDate(rec.due_date)}</TableCell>
                  <TableCell>
                    <Badge variant={REC_STATUS_VARIANTS[rec.status]}>{REC_STATUS_LABELS[rec.status]}</Badge>
                  </TableCell>
                  <TableCell>{rec.created_by?.full_name}</TableCell>
                  <TableCell align="right">{rowActions(rec)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Add recommendation */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add Recommendation" size="lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                createRecommendation({
                  visitId: visit.id,
                  description,
                  sapNotificationNumber: requiresReview ? undefined : sapNumber,
                  dueDate: requiresReview ? undefined : dueDate,
                }),
              {
                onSuccess: () => {
                  setAddOpen(false);
                  setDescription('');
                  setSapNumber('');
                  setDueDate('');
                },
              },
            );
          }}
        >
          {requiresReview && (
            <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">
              This recommendation will be sent to the Technical Engineer for review before SAP notification details
              can be added.
            </div>
          )}
          <Textarea
            label="Description"
            name="description"
            required
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the recommendation…"
          />
          {!requiresReview && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
              <Input
                label="SAP Notification Number"
                name="sap_notification_number"
                value={sapNumber}
                onChange={(e) => setSapNumber(e.target.value)}
                placeholder="Optional"
              />
              <Input
                label="Due Date"
                name="due_date"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
          )}
          <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row sm:gap-3">
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={pending} disabled={!description.trim()} className="w-full sm:w-auto">
              {requiresReview ? 'Send for Review' : 'Create'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Technical review */}
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
              decision === 'no_action'
                ? 'Provide justification for no further action…'
                : 'Add any additional comments…'
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

      {/* SAP details */}
      <Modal open={sapTarget !== null} onClose={() => setSapTarget(null)} title="Add SAP Notification Details">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!sapTarget) return;
            run(() => saveSapDetails(sapTarget.id, sapDraft.number, sapDraft.dueDate), {
              onSuccess: () => setSapTarget(null),
            });
          }}
        >
          <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            The Technical Engineer has requested an SAP notification for this recommendation. Provide the SAP
            notification number and due date.
          </div>
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-sm text-gray-500">Recommendation</p>
            <p className="font-medium">{sapTarget?.description}</p>
          </div>
          <Input
            label="SAP Notification Number"
            name="sap_notification_number"
            required
            value={sapDraft.number}
            onChange={(e) => setSapDraft({ ...sapDraft, number: e.target.value })}
            placeholder="Enter SAP notification number"
          />
          <Input
            label="Due Date"
            name="due_date"
            type="date"
            required
            value={sapDraft.dueDate}
            onChange={(e) => setSapDraft({ ...sapDraft, dueDate: e.target.value })}
          />
          <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row sm:gap-3">
            <Button type="button" variant="secondary" onClick={() => setSapTarget(null)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={pending} className="w-full sm:w-auto">
              Save SAP Details
            </Button>
          </div>
        </form>
      </Modal>

      {/* Cancel recommendation */}
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
    </Card>
  );
}
