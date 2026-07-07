/** Cross-visit recommendations view. Actions post to the /visits/:id/... endpoints. */
import { Hono } from 'hono';
import { all } from '../db';
import { fmtDate, todayStr } from '../dates';
import { activeUsers, requireRole } from '../auth';
import { page, Card, PageHeader, EmptyState, StatCard, Modal, ModalButtons, Field, ActionButton, recBadge } from '../ui';
import { REVIEW_DECISION_LABELS, ROLE_LABELS, type App, type Recommendation } from '../types';

const routes = new Hono<App>();

type RecRow = Recommendation & {
  plan_number: string; vendor_name: string; created_by_name: string; reviewed_by_name: string | null;
  maintenance_engineer_id: string; technical_engineer_id: string; visit_status: string;
};

const FILTERS = [
  { value: 'active', label: 'All active' },
  { value: 'open', label: 'Open' },
  { value: 'in_review', label: 'In review' },
  { value: 'approved', label: 'Approved' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'Everything' },
];

routes.get('/', requireRole('admin', 'maintenance_engineer', 'technical_engineer'), async (c) => {
  const user = c.get('user');
  const filter = c.req.query('status') ?? 'active';
  const today = todayStr();

  const recs = await all<RecRow>(
    c.env.DB,
    `SELECT rec.*, r.plan_number, ve.name AS vendor_name, cb.full_name AS created_by_name, rb.full_name AS reviewed_by_name,
            v.maintenance_engineer_id, v.technical_engineer_id, v.status AS visit_status
     FROM recommendations rec
     JOIN visits v ON v.id = rec.visit_id
     JOIN routines r ON r.id = v.routine_id
     JOIN vendors ve ON ve.id = r.vendor_id
     JOIN users cb ON cb.id = rec.created_by_id
     LEFT JOIN users rb ON rb.id = rec.reviewed_by_id
     ORDER BY rec.created_at DESC`
  );

  const isOverdue = (r: RecRow) => !!r.due_date && r.due_date < today && !['completed', 'cancelled'].includes(r.status);
  const counts = {
    open: recs.filter((r) => r.status === 'open').length,
    in_review: recs.filter((r) => r.status === 'in_review').length,
    approved: recs.filter((r) => r.status === 'approved').length,
    overdue: recs.filter(isOverdue).length,
  };
  const visible = recs.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'active') return ['open', 'in_review', 'approved'].includes(r.status);
    return r.status === filter;
  });
  const canReview = user.role === 'admin' || user.role === 'technical_engineer';
  const reviewable = visible.filter((r) => r.status === 'in_review' && canReview);
  const users = reviewable.length > 0 ? await activeUsers(c.env.DB) : [];
  // Complete/cancel belong to the visit's maintenance engineer (or an admin);
  // reviewing is the technical engineer's only recommendation action.
  const canAct = (r: RecRow) => user.role === 'admin' || user.id === r.maintenance_engineer_id;
  const isEngineer = (r: RecRow) =>
    user.role === 'admin' || user.id === r.maintenance_engineer_id || user.id === r.technical_engineer_id;
  const canEdit = (r: RecRow) => !['completed', 'cancelled'].includes(r.status) && isEngineer(r);
  const canReopen = (r: RecRow) =>
    ['completed', 'cancelled'].includes(r.status) && isEngineer(r) &&
    !['completed', 'cancelled'].includes(r.visit_status);
  const sapMissing = (r: RecRow) => r.review_decision === 'request_sap' && !r.sap_notification_number;

  return page(c, 'Recommendations', (
    <>
      <PageHeader title="Recommendations" sub="Action items raised from maintenance reports, across all visits" />

      <div class="stats">
        <StatCard label="Open" value={counts.open} href="/recommendations?status=open" icon="file" tone="amber" />
        <StatCard label="In Review" value={counts.in_review} href="/recommendations?status=in_review" icon="eye" tone="blue" />
        <StatCard label="Approved" value={counts.approved} href="/recommendations?status=approved" icon="check" tone="green" />
        <StatCard label="Overdue" value={counts.overdue} href="/recommendations?status=active" icon="alert" tone="red" />
      </div>

      <Card pad={false}>
        <form class="filterbar" method="get" action="/recommendations">
          <select name="status" data-autosubmit aria-label="Filter recommendations">
            {FILTERS.map((f) => <option value={f.value} selected={filter === f.value}>{f.label}</option>)}
          </select>
          <span class="muted">{visible.length} recommendation{visible.length === 1 ? '' : 's'}</span>
        </form>
        {visible.length === 0 ? (
          <EmptyState title="No recommendations found" hint="Recommendations are created from a visit's report." />
        ) : (
          <div class="tbl-wrap">
            <table class="tbl">
              <thead>
                <tr><th>Description</th><th>Plan / Vendor</th><th>SAP #</th><th>Due</th><th>Status</th><th>Created By</th><th class="actions">Actions</th></tr>
              </thead>
              <tbody>
                {visible.map((r) => (
                  <tr>
                    <td>
                      <div class="desc-clip">{r.description}</div>
                      {r.review_decision && <div class="muted">Decision: {REVIEW_DECISION_LABELS[r.review_decision]}</div>}
                      {r.technical_review_response && <div class="muted">“{r.technical_review_response}”</div>}
                    </td>
                    <td>
                      <a class="rowlink" href={`/visits/${r.visit_id}`}>{r.plan_number}</a>
                      <div class="muted">{r.vendor_name}</div>
                    </td>
                    <td>{r.sap_notification_number ?? '—'}</td>
                    <td class={isOverdue(r) ? 'text-red' : ''}>{fmtDate(r.due_date)}</td>
                    <td>{recBadge(r.status)}</td>
                    <td>{r.created_by_name}</td>
                    <td class="actions">
                      <a class="btn btn--sm" href={`/visits/${r.visit_id}`}>Open Visit</a>
                      {canEdit(r) && <button class="btn btn--sm" data-modal={`edit-${r.id}`}>Edit</button>}
                      {r.status === 'in_review' && canReview && (
                        <button class="btn btn--sm btn--primary" data-modal={`review-${r.id}`}>Review</button>
                      )}
                      {['open', 'approved'].includes(r.status) && canAct(r) && (
                        <>
                          {sapMissing(r)
                            ? <a class="btn btn--sm btn--primary" href={`/visits/${r.visit_id}`}>Add SAP Details</a>
                            : <ActionButton action={`/visits/${r.visit_id}/recommendations/${r.id}/complete`} label="Complete" class="btn btn--sm btn--green" />}
                          <button class="btn btn--sm btn--danger" data-modal={`cancel-${r.id}`}>Cancel</button>
                        </>
                      )}
                      {canReopen(r) && (
                        <ActionButton action={`/visits/${r.visit_id}/recommendations/${r.id}/reopen`} label="Reopen"
                          class="btn btn--sm" confirm="Reopen this recommendation? The visit can't be closed until it is resolved again." />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {reviewable.map((rec) => (
        <Modal id={`review-${rec.id}`} title="Submit Technical Review">
          <form method="post" action={`/visits/${rec.visit_id}/recommendations/${rec.id}/review`}>
            <div class="context"><strong>{rec.plan_number} — {rec.vendor_name}</strong><br />{rec.description}</div>
            <Field label="Decision">
              <select name="decision" required>
                <option value="">Choose a decision…</option>
                <option value="no_action">No further action required</option>
                <option value="request_sap">Request SAP notification</option>
                <option value="other_action">Other action required</option>
              </select>
            </Field>
            <div data-show-when="decision:other_action" hidden>
              <Field label="Action description">
                <textarea name="action_description" rows={2} data-req placeholder="Describe the required action…"></textarea>
              </Field>
            </div>
            <div data-show-when="decision:request_sap|other_action" hidden>
              <Field label="Assign action to (optional)">
                <select name="assign_to">
                  <option value="">Unassigned</option>
                  {users.map((u) => <option value={u.id}>{u.full_name} ({ROLE_LABELS[u.role]})</option>)}
                </select>
              </Field>
            </div>
            <Field label="Comments / justification">
              <textarea name="response" rows={3} placeholder="Review response…"></textarea>
            </Field>
            <ModalButtons submit="Submit Review" />
          </form>
        </Modal>
      ))}

      {visible.filter(canEdit).map((rec) => (
        <Modal id={`edit-${rec.id}`} title="Edit Recommendation">
          <form method="post" action={`/visits/${rec.visit_id}/recommendations/${rec.id}/edit`}>
            <div class="context"><strong>{rec.plan_number} — {rec.vendor_name}</strong></div>
            <Field label="Description">
              <textarea name="description" rows={4} required>{rec.description}</textarea>
            </Field>
            <div class="form-grid">
              <Field label="SAP notification # (optional)"><input name="sap_notification_number" value={rec.sap_notification_number ?? ''} /></Field>
              <Field label="Due date (optional)"><input type="date" name="due_date" value={rec.due_date ?? ''} /></Field>
            </div>
            <ModalButtons submit="Save Changes" />
          </form>
        </Modal>
      ))}

      {visible.filter((r) => ['open', 'approved'].includes(r.status) && canAct(r)).map((rec) => (
        <Modal id={`cancel-${rec.id}`} title="Cancel Recommendation">
          <form method="post" action={`/visits/${rec.visit_id}/recommendations/${rec.id}/cancel`}>
            <div class="context">{rec.description}</div>
            <Field label="Cancellation reason">
              <textarea name="reason" rows={2} required placeholder="Why is this recommendation being cancelled?"></textarea>
            </Field>
            <ModalButtons submit="Cancel Recommendation" danger />
          </form>
        </Modal>
      ))}
    </>
  ));
});

export default routes;
