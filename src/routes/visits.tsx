/**
 * Visits: list, detail, and every lifecycle transition.
 * Status machine: scheduled → date_confirmed → report_uploaded →
 * recommendations_created → in_review → completed (reschedule resets to
 * scheduled; cancelled is terminal). Permissions come from visitPerms() and are
 * enforced here on every POST - the UI only decides what to show.
 */
import { Hono } from 'hono';
import { all, first, insertRow, updateRow, deleteRow, now } from '../db';
import { addDays, fmtDate, fmtDateTime, fmtRange, todayStr } from '../dates';
import { flash, activeUsers } from '../auth';
import {
  cancelOpenTasks, completeOpenTasks, createTask, createTaskOnce, getConfig, maybeCreateCloseTask, visitPerms, waitingFor,
} from '../workflow';
import {
  page, Card, PageHeader, EmptyState, Modal, ModalButtons, Field, ActionButton, IconAction, IconModalBtn, Badge, visitBadge, recBadge, Icon,
} from '../ui';
import {
  isAdmin, REVIEW_DECISION_LABELS, ROLE_LABELS, TASK_TYPE_LABELS, VISIT_STATUS_LABELS,
  type App, type Recommendation, type Routine, type Task, type User, type Vendor, type Visit, type VisitComment, type VisitReport, type VisitStatus,
} from '../types';
import type { Context } from 'hono';

const routes = new Hono<App>();

const REPORT_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx'];
const MAX_REPORT_BYTES = 10 * 1024 * 1024;

// ---------- List ----------

routes.get('/', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const statusFilter = c.req.query('status') ?? 'all';
  const q = (c.req.query('q') ?? '').trim();
  const mine = c.req.query('mine') === '1';
  const canManage = isAdmin(user) || user.role === 'vendor_coordinator';

  const where: string[] = [];
  const params: unknown[] = [];
  if (statusFilter !== 'all') {
    where.push('v.status = ?');
    params.push(statusFilter);
  }
  if (q) {
    where.push('(r.plan_number LIKE ? OR ve.name LIKE ? OR ve.vendor_number LIKE ? OR COALESCE(r.description, v.description) LIKE ? OR v.notification_number LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (mine) {
    where.push('(v.vendor_coordinator_id = ? OR v.maintenance_engineer_id = ? OR v.technical_engineer_id = ?)');
    params.push(user.id, user.id, user.id);
  }
  const visits = await all<Visit & { plan_number: string; vendor_name: string }>(
    db,
    `SELECT v.*, COALESCE(r.plan_number, 'Ad-hoc ' || v.notification_number, 'Ad-hoc') AS plan_number, ve.name AS vendor_name
     FROM visits v
     LEFT JOIN routines r ON r.id = v.routine_id
     JOIN vendors ve ON ve.id = COALESCE(r.vendor_id, v.vendor_id)
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY v.scheduled_date DESC`,
    ...params
  );
  const [routines, vendors, usersList] = await Promise.all([
    canManage ? all<Routine>(db, 'SELECT * FROM routines WHERE is_active = 1 ORDER BY plan_number') : Promise.resolve([] as Routine[]),
    all<Vendor>(db, 'SELECT * FROM vendors WHERE is_active = 1 ORDER BY name'),
    activeUsers(db),
  ]);
  const byRole = (role: string) => usersList.filter((u) => u.role === role || isAdmin(u));

  return page(c, 'Visits', (
    <>
      <PageHeader title="Maintenance Visits" sub="Track and manage scheduled maintenance visits">
        <button class="btn" data-modal="adhoc-visit"><Icon name="plus" size={16} /> Ad-hoc Visit</button>
        {canManage && <button class="btn btn--primary" data-modal="create-visit"><Icon name="plus" size={16} /> Create Visit</button>}
      </PageHeader>

      <Card pad={false}>
        <form class="filterbar" method="get" action="/visits">
          <input name="q" value={q} placeholder="Search plan, vendor, notification #…" class="grow" aria-label="Search visits" />
          <select name="status" data-autosubmit aria-label="Filter by status">
            <option value="all">All statuses</option>
            {Object.entries(VISIT_STATUS_LABELS).map(([value, label]) => (
              <option value={value} selected={statusFilter === value}>{label}</option>
            ))}
          </select>
          <label class="check" style="margin:0">
            <input type="checkbox" name="mine" value="1" checked={mine} data-autosubmit /> Assigned to me
          </label>
          <button class="btn btn--sm" type="submit">Search</button>
          {(q || statusFilter !== 'all' || mine) && <a class="btn btn--sm btn--ghost" href="/visits">Clear</a>}
          <span class="muted">{visits.length} visit{visits.length === 1 ? '' : 's'}</span>
        </form>
        {visits.length === 0 ? (
          <EmptyState
            title="No visits found"
            hint={q ? `Nothing matches "${q}"${statusFilter !== 'all' ? ' with that status' : ''}.` : statusFilter !== 'all' ? 'Try clearing the status filter.' : 'Visits are generated automatically from active routines.'}
          />
        ) : (
          <div class="tbl-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>Plan</th><th>Vendor</th><th>Scheduled</th><th>Confirmed</th><th>Notification #</th><th>Status</th><th class="actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visits.map((v) => (
                  <tr data-href={`/visits/${v.id}`}>
                    <td><a class="rowlink" href={`/visits/${v.id}`}>{v.plan_number}</a></td>
                    <td>{v.vendor_name}</td>
                    <td>{fmtRange(v.scheduled_date, v.end_date)}</td>
                    <td>{fmtDate(v.confirmed_date)}</td>
                    <td>{v.notification_number ?? '-'}</td>
                    <td>{visitBadge(v.status)}</td>
                    <td class="actions">
                      <a class="btn btn--sm btn--icon" href={`/visits/${v.id}`} title="Open visit" aria-label="Open visit"><Icon name="eye" size={15} /></a>
                      {isAdmin(user) && (
                        <IconAction
                          action={`/visits/${v.id}/delete`}
                          icon="trash"
                          label="Delete visit"
                          class="btn--danger"
                          confirm={`Delete the visit for ${v.plan_number}? All its tasks, recommendations and reports are deleted too. This cannot be undone.`}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canManage && (
        <Modal id="create-visit" title="Create Maintenance Visit">
          <form method="post" action="/visits">
            <Field label="Maintenance routine">
              <select name="routine_id" required>
                <option value="">Select a routine…</option>
                {routines.map((r) => <option value={r.id}>{r.plan_number} - {r.description.slice(0, 60)}</option>)}
              </select>
            </Field>
            <div class="form-grid">
              <Field label="Scheduled date">
                <input type="date" name="scheduled_date" required />
              </Field>
              <Field label="End date (optional)" hint="For visits spanning several days.">
                <input type="date" name="end_date" />
              </Field>
            </div>
            <ModalButtons submit="Create Visit" />
          </form>
        </Modal>
      )}

      <Modal id="adhoc-visit" title="Create Ad-hoc Visit">
        <form method="post" action="/visits/adhoc">
          <p class="muted">One-off visit outside any maintenance plan - identified by its notification number.</p>
          <Field label="Vendor">
            <select name="vendor_id" required>
              <option value="">Select a vendor…</option>
              {vendors.map((ve) => <option value={ve.id}>{ve.name}</option>)}
            </select>
          </Field>
          <Field label="Description">
            <textarea name="description" rows={2} required placeholder="What is this visit for?"></textarea>
          </Field>
          <Field label="Notification #">
            <input name="notification_number" required placeholder="e.g. NOT-2026-0042" />
          </Field>
          <div class="form-grid">
            <Field label="Scheduled date"><input type="date" name="scheduled_date" required /></Field>
            <Field label="End date (optional)"><input type="date" name="end_date" /></Field>
          </div>
          {(
            [
              ['Vendor coordinator', 'vendor_coordinator_id', 'vendor_coordinator'],
              ['Maintenance engineer', 'maintenance_engineer_id', 'maintenance_engineer'],
              ['Technical engineer', 'technical_engineer_id', 'technical_engineer'],
            ] as const
          ).map(([label, name, role]) => (
            <Field label={label}>
              <select name={name} required>
                <option value="">Select…</option>
                {byRole(role).map((u) => (
                  <option value={u.id} selected={u.id === user.id}>{u.full_name} ({ROLE_LABELS[u.role]})</option>
                ))}
              </select>
            </Field>
          ))}
          <label class="check">
            <input type="checkbox" name="requires_technical_review" checked /> Recommendations require technical review
          </label>
          <ModalButtons submit="Create Ad-hoc Visit" />
        </form>
      </Modal>
    </>
  ));
});

// Ad-hoc visits: anyone can raise one; there is no plan number, just the
// notification number, and the vendor/description live on the visit itself.
routes.post('/adhoc', async (c) => {
  const form = await c.req.formData();
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const date = get('scheduled_date');
  const endDate = get('end_date');
  const vendor = await first<Vendor>(c.env.DB, 'SELECT * FROM vendors WHERE id = ?', get('vendor_id'));
  if (!vendor || !get('description') || !get('notification_number') || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !get('vendor_coordinator_id') || !get('maintenance_engineer_id') || !get('technical_engineer_id')) {
    flash(c, 'Fill in the vendor, description, notification number, date and all three assignees.', 'err');
    return c.redirect('/visits');
  }
  if (endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < date)) {
    flash(c, 'The end date must be on or after the scheduled date.', 'err');
    return c.redirect('/visits');
  }
  const visit = await insertRow<Visit>(c.env.DB, 'visits', {
    routine_id: null, vendor_id: vendor.id, description: get('description'),
    requires_technical_review: form.has('requires_technical_review') ? 1 : 0,
    notification_number: get('notification_number'),
    scheduled_date: date, end_date: endDate || null, status: 'scheduled',
    vendor_coordinator_id: get('vendor_coordinator_id'),
    maintenance_engineer_id: get('maintenance_engineer_id'),
    technical_engineer_id: get('technical_engineer_id'),
  }, c.get('realUser').id);
  const cfg = await getConfig(c.env.DB);
  const due = addDays(date, -cfg.visit_confirmation_days);
  if (due > todayStr()) {
    await createTask(c.env.DB, visit.id, 'confirm_visit_date', visit.vendor_coordinator_id, due, c.get('realUser').id);
  }
  flash(c, `Ad-hoc visit ${visit.notification_number} created for ${vendor.name}.`);
  return c.redirect(`/visits/${visit.id}`);
});

routes.post('/', async (c) => {
  const user = c.get('user');
  if (!isAdmin(user) && user.role !== 'vendor_coordinator') return c.text('Forbidden', 403);
  const form = await c.req.formData();
  const routineId = String(form.get('routine_id') ?? '');
  const date = String(form.get('scheduled_date') ?? '');
  const endDate = String(form.get('end_date') ?? '').trim();
  const routine = await first<Routine>(c.env.DB, 'SELECT * FROM routines WHERE id = ?', routineId);
  if (!routine || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    flash(c, 'Pick a routine and a valid date.', 'err');
    return c.redirect('/visits');
  }
  if (endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < date)) {
    flash(c, 'The end date must be on or after the scheduled date.', 'err');
    return c.redirect('/visits');
  }
  try {
    const visit = await insertRow<Visit>(c.env.DB, 'visits', {
      routine_id: routine.id, scheduled_date: date, end_date: endDate || null, status: 'scheduled',
      vendor_coordinator_id: routine.vendor_coordinator_id,
      maintenance_engineer_id: routine.maintenance_engineer_id,
      technical_engineer_id: routine.technical_engineer_id,
    }, c.get('realUser').id);
    flash(c, `Visit created for ${routine.plan_number} on ${fmtDate(date)}.`);
    return c.redirect(`/visits/${visit.id}`);
  } catch {
    flash(c, `A visit for ${routine.plan_number} on ${fmtDate(date)} already exists.`, 'err');
    return c.redirect('/visits');
  }
});

// ---------- Shared loading for detail + actions ----------

interface VisitBundle {
  visit: Visit;
  /** Plan/vendor/review facts, from the routine or (for ad-hoc visits) the visit itself. */
  meta: {
    plan_number: string; description: string; requires_technical_review: number; is_adhoc: boolean;
    vendor_id: string; vendor_name: string; vendor_contact: string | null; vendor_email: string | null; vendor_phone: string | null;
  };
  recs: (Recommendation & { created_by_name: string; reviewed_by_name: string | null; action_assigned_name: string | null })[];
  reports: (VisitReport & { uploaded_by_name: string })[];
  tasks: Task[];
  comments: (VisitComment & { author_name: string })[];
  team: { coordinator: User | null; maintEngineer: User | null; techEngineer: User | null };
}

async function loadVisit(c: Context<App>, id: string): Promise<VisitBundle | null> {
  const db = c.env.DB;
  const visit = await first<Visit>(db, 'SELECT * FROM visits WHERE id = ?', id);
  if (!visit) return null;
  type RoutineRow = Routine & { vendor_name: string; vendor_contact: string | null; vendor_email: string | null; vendor_phone: string | null };
  const [routine, adhocVendor, recs, reports, tasks, comments, coordinator, maintEngineer, techEngineer] = await Promise.all([
    visit.routine_id
      ? first<RoutineRow>(
          db,
          `SELECT r.*, v.name AS vendor_name, v.contact_name AS vendor_contact,
                  v.contact_email AS vendor_email, v.contact_phone AS vendor_phone
           FROM routines r JOIN vendors v ON v.id = r.vendor_id WHERE r.id = ?`,
          visit.routine_id)
      : Promise.resolve(null),
    visit.vendor_id ? first<Vendor>(db, 'SELECT * FROM vendors WHERE id = ?', visit.vendor_id) : Promise.resolve(null),
    all<VisitBundle['recs'][number]>(
      db,
      `SELECT rec.*, cb.full_name AS created_by_name, rb.full_name AS reviewed_by_name, aa.full_name AS action_assigned_name
       FROM recommendations rec
       JOIN users cb ON cb.id = rec.created_by_id
       LEFT JOIN users rb ON rb.id = rec.reviewed_by_id
       LEFT JOIN users aa ON aa.id = rec.action_assigned_to_id
       WHERE rec.visit_id = ? ORDER BY rec.created_at DESC`,
      id),
    all<VisitBundle['reports'][number]>(
      db,
      `SELECT vr.*, u.full_name AS uploaded_by_name FROM visit_reports vr JOIN users u ON u.id = vr.uploaded_by_id
       WHERE vr.visit_id = ? ORDER BY vr.uploaded_at DESC`,
      id),
    all<Task>(db, 'SELECT * FROM tasks WHERE visit_id = ? ORDER BY due_date', id),
    all<VisitBundle['comments'][number]>(
      db,
      `SELECT vc.*, u.full_name AS author_name FROM visit_comments vc JOIN users u ON u.id = vc.author_id
       WHERE vc.visit_id = ? ORDER BY vc.created_at DESC`,
      id),
    first<User>(db, 'SELECT * FROM users WHERE id = ?', visit.vendor_coordinator_id),
    first<User>(db, 'SELECT * FROM users WHERE id = ?', visit.maintenance_engineer_id),
    first<User>(db, 'SELECT * FROM users WHERE id = ?', visit.technical_engineer_id),
  ]);
  if (!routine && !adhocVendor) return null;
  const meta: VisitBundle['meta'] = routine
    ? {
        plan_number: routine.plan_number, description: routine.description,
        requires_technical_review: visit.requires_technical_review ?? routine.requires_technical_review, is_adhoc: false,
        vendor_id: routine.vendor_id, vendor_name: routine.vendor_name, vendor_contact: routine.vendor_contact,
        vendor_email: routine.vendor_email, vendor_phone: routine.vendor_phone,
      }
    : {
        plan_number: visit.notification_number ? `Ad-hoc ${visit.notification_number}` : 'Ad-hoc',
        description: visit.description ?? 'Ad-hoc visit',
        requires_technical_review: visit.requires_technical_review ?? 1, is_adhoc: true,
        vendor_id: adhocVendor!.id, vendor_name: adhocVendor!.name, vendor_contact: adhocVendor!.contact_name,
        vendor_email: adhocVendor!.contact_email, vendor_phone: adhocVendor!.contact_phone,
      };
  return { visit, meta, recs, reports, tasks, comments, team: { coordinator, maintEngineer, techEngineer } };
}

/** Guard for action endpoints: loads the bundle and bails with a flash on failure. */
async function withVisit(
  c: Context<App>,
  check: (b: VisitBundle) => boolean,
  action: (b: VisitBundle) => Promise<string | { message: string; redirect: string }>
): Promise<Response> {
  const id = c.req.param('id')!;
  // Recommendation/task actions are also triggered from list pages; go back to
  // wherever the user acted from (same-origin only).
  let back = `/visits/${id}`;
  const referer = c.req.header('referer');
  if (referer) {
    const url = new URL(referer);
    if (url.origin === new URL(c.req.url).origin) back = url.pathname + url.search;
  }
  const bundle = await loadVisit(c, id);
  if (!bundle) return c.text('Visit not found', 404);
  if (!check(bundle)) {
    flash(c, 'You are not allowed to do that on this visit.', 'err');
    return c.redirect(back);
  }
  try {
    const result = await action(bundle);
    if (typeof result === 'string') flash(c, result);
    else {
      flash(c, result.message);
      back = result.redirect;
    }
  } catch (err) {
    flash(c, err instanceof Error ? err.message : 'Something went wrong', 'err');
  }
  return c.redirect(back);
}

const perms = (c: Context<App>, b: VisitBundle) => visitPerms(c.get('user'), b.visit, b.reports.length, b.recs, b.tasks);
const actor = (c: Context<App>) => c.get('realUser').id;

// ---------- Actions ----------

routes.post('/:id/confirm-date', async (c) => {
  const form = await c.req.formData();
  const date = String(form.get('confirmed_date') ?? '');
  const endDate = String(form.get('end_date') ?? '').trim();
  return withVisit(c, (b) => perms(c, b).canConfirmDate, async (b) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Pick a valid date.');
    if (endDate && (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < date)) throw new Error('The end date must be on or after the confirmed date.');
    await updateRow(c.env.DB, 'visits', b.visit.id, {
      confirmed_date: date, end_date: endDate || null, confirmed_at: now(), status: 'date_confirmed' satisfies VisitStatus,
    }, actor(c));
    await completeOpenTasks(c.env.DB, b.visit.id, 'confirm_visit_date', actor(c));
    // Next step in the chain: the report is due report_upload_weeks after the visit.
    const cfg = await getConfig(c.env.DB);
    await createTaskOnce(c.env.DB, b.visit.id, 'upload_report', b.visit.vendor_coordinator_id,
      addDays(date, cfg.report_upload_weeks * 7), actor(c));
    return `Visit date confirmed for ${fmtDate(date)}.`;
  });
});

routes.post('/:id/notification', async (c) => {
  const form = await c.req.formData();
  const value = String(form.get('notification_number') ?? '').trim();
  return withVisit(c, (b) => perms(c, b).canReschedule, async (b) => {
    await updateRow(c.env.DB, 'visits', b.visit.id, { notification_number: value || null }, actor(c));
    return 'Notification number saved.';
  });
});

async function storeReport(
  c: Context<App>,
  b: VisitBundle,
  file: File | string | null,
  notes: string,
  replacesId: string | null
): Promise<string | { message: string; redirect: string }> {
  if (!(file instanceof File) || file.size === 0) throw new Error('Choose a file to upload.');
  if (file.size > MAX_REPORT_BYTES) throw new Error('Reports are limited to 10 MB.');
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!REPORT_EXTENSIONS.includes(ext)) throw new Error(`Only ${REPORT_EXTENSIONS.join(', ')} files are accepted.`);

  const key = `${b.visit.id}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, '_')}`;
  await c.env.REPORTS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type || 'application/octet-stream' },
  });
  await insertRow(c.env.DB, 'visit_reports', {
    visit_id: b.visit.id, file_key: key, file_name: file.name, file_size: file.size,
    content_type: file.type || null, uploaded_by_id: c.get('user').id, uploaded_at: now(),
    notes: notes || null, replaces_id: replacesId,
  }, actor(c));
  if (b.visit.status === 'date_confirmed') {
    await updateRow(c.env.DB, 'visits', b.visit.id, { status: 'report_uploaded' satisfies VisitStatus }, actor(c));
    await completeOpenTasks(c.env.DB, b.visit.id, 'upload_report', actor(c));
    const cfg = await getConfig(c.env.DB);
    await createTaskOnce(c.env.DB, b.visit.id, 'create_recommendations', b.visit.maintenance_engineer_id,
      addDays(todayStr(), cfg.recommendations_review_days), actor(c));
  }
  const message = `Report "${file.name}" ${replacesId ? 'uploaded as a replacement' : 'uploaded'}.`;
  // If the recommendations stage has already passed, ask whether this new
  // report means more recommendations are needed.
  if (['recommendations_created', 'in_review', 'completed'].includes(b.visit.status)) {
    return { message, redirect: `/visits/${b.visit.id}?prompt-recs=1` };
  }
  return message;
}

routes.post('/:id/reports', async (c) => {
  const form = await c.req.formData();
  const file = form.get('file') as File | string | null;
  const notes = String(form.get('notes') ?? '').trim();
  const replacesId = String(form.get('replaces_id') ?? '').trim();
  return withVisit(c, (b) => perms(c, b).canUploadReport, async (b) => {
    let replaces: string | null = null;
    if (replacesId) {
      const target = b.reports.find((r) => r.id === replacesId);
      if (!target) throw new Error('The report to replace no longer exists.');
      replaces = target.id;
    }
    return storeReport(c, b, file, notes, replaces);
  });
});

// The ME (or an admin) confirms the latest report raises nothing new - closes
// the pending recommendations check so the visit can be closed again.
routes.post('/:id/recommendations-check', async (c) => {
  return withVisit(
    c,
    (b) => {
      const p = perms(c, b);
      return p.isMaintEngineer || p.isAdmin;
    },
    async (b) => {
      await completeOpenTasks(c.env.DB, b.visit.id, 'create_recommendations', actor(c));
      const fresh = (await first<Visit>(c.env.DB, 'SELECT * FROM visits WHERE id = ?', b.visit.id))!;
      await maybeCreateCloseTask(c.env.DB, fresh, actor(c));
      // With nothing outstanding the visit is ready to close - prompt for it.
      return {
        message: 'Confirmed - no further recommendations needed.',
        redirect: `/visits/${b.visit.id}?prompt-close=1`,
      };
    }
  );
});

// Answering "yes" to the more-recommendations prompt: rewind the workflow to
// the recommendations stage and give the maintenance engineer a task.
routes.post('/:id/more-recommendations', async (c) => {
  return withVisit(
    c,
    (b) => {
      const p = perms(c, b);
      return p.isCoordinator || p.isMaintEngineer || p.isAdmin;
    },
    async (b) => {
      const db = c.env.DB;
      if (b.visit.status === 'completed') {
        const status: VisitStatus = b.recs.length === 0
          ? 'report_uploaded'
          : b.recs.some((r) => r.status === 'in_review') ? 'in_review' : 'recommendations_created';
        await updateRow(db, 'visits', b.visit.id, { status, completed_at: null }, actor(c));
      }
      const cfg = await getConfig(db);
      await createTaskOnce(db, b.visit.id, 'create_recommendations', b.visit.maintenance_engineer_id,
        addDays(todayStr(), cfg.recommendations_review_days), actor(c), 'New report added - review for additional recommendations');
      return {
        message: `${b.team.maintEngineer?.full_name ?? 'The maintenance engineer'} has been given a task to review the new report for recommendations.`,
        // Land on the plain visit URL - the referer still carries ?prompt-recs=1
        // and would re-open the dialog forever.
        redirect: `/visits/${b.visit.id}`,
      };
    }
  );
});

async function serveReport(c: Context<App>, disposition: 'attachment' | 'inline'): Promise<Response> {
  const report = await first<VisitReport>(
    c.env.DB, 'SELECT * FROM visit_reports WHERE id = ? AND visit_id = ?', c.req.param('reportId'), c.req.param('id'));
  if (!report) return c.text('Report not found', 404);
  const object = await c.env.REPORTS.get(report.file_key);
  if (!object) return c.text('File missing from storage', 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': report.content_type ?? 'application/octet-stream',
      'Content-Disposition': `${disposition}; filename="${report.file_name.replace(/"/g, '')}"`,
    },
  });
}

routes.get('/:id/reports/:reportId/download', (c) => serveReport(c, 'attachment'));
// PDFs render in the browser tab; formats the browser can't show fall back to downloading.
routes.get('/:id/reports/:reportId/view', (c) => serveReport(c, 'inline'));

routes.post('/:id/reports/:reportId/delete', async (c) => {
  return withVisit(c, (b) => perms(c, b).isAdmin, async (b) => {
    const report = b.reports.find((r) => r.id === c.req.param('reportId'));
    if (!report) throw new Error('Report not found.');
    await c.env.REPORTS.delete(report.file_key);
    await deleteRow(c.env.DB, 'visit_reports', report.id, actor(c));
    if (b.reports.length === 1 && b.visit.status === 'report_uploaded') {
      await updateRow(c.env.DB, 'visits', b.visit.id, { status: 'date_confirmed' satisfies VisitStatus }, actor(c));
    }
    return `Report "${report.file_name}" deleted.`;
  });
});

routes.post('/:id/no-report', async (c) => {
  const form = await c.req.formData();
  const reason = String(form.get('reason') ?? '').trim();
  return withVisit(c, (b) => perms(c, b).canUploadReport, async (b) => {
    if (!reason) throw new Error('A reason is required.');
    await updateRow(c.env.DB, 'visits', b.visit.id, {
      no_report_reason: reason, status: 'report_uploaded' satisfies VisitStatus,
    }, actor(c));
    await completeOpenTasks(c.env.DB, b.visit.id, 'upload_report', actor(c));
    const cfg = await getConfig(c.env.DB);
    await createTaskOnce(c.env.DB, b.visit.id, 'create_recommendations', b.visit.maintenance_engineer_id,
      addDays(todayStr(), cfg.recommendations_review_days), actor(c));
    return 'Marked as no report available.';
  });
});

routes.post('/:id/recommendations', async (c) => {
  const form = await c.req.formData();
  const description = String(form.get('description') ?? '').trim();
  const sap = String(form.get('sap_notification_number') ?? '').trim();
  const dueDate = String(form.get('due_date') ?? '').trim();
  return withVisit(c, (b) => perms(c, b).canCreateRec, async (b) => {
    if (!description) throw new Error('A description is required.');
    const db = c.env.DB;
    const requiresReview = !!b.meta.requires_technical_review;
    await insertRow(db, 'recommendations', {
      visit_id: b.visit.id, description,
      sap_notification_number: !requiresReview && sap ? sap : null,
      due_date: !requiresReview && dueDate ? dueDate : null,
      created_by_id: c.get('user').id,
      status: requiresReview ? 'in_review' : 'open',
      sent_for_review: requiresReview ? 1 : 0,
    }, actor(c));
    if (requiresReview) {
      await updateRow(db, 'visits', b.visit.id, { status: 'in_review' satisfies VisitStatus }, actor(c));
      await completeOpenTasks(db, b.visit.id, 'create_recommendations', actor(c));
      const cfg = await getConfig(db);
      await createTask(db, b.visit.id, 'technical_review', b.visit.technical_engineer_id,
        addDays(todayStr(), cfg.technical_review_days), actor(c), `Review recommendation: ${description.slice(0, 80)}`);
      return 'Recommendation created and sent for technical review.';
    }
    if (b.recs.length === 0) {
      await updateRow(db, 'visits', b.visit.id, { status: 'recommendations_created' satisfies VisitStatus }, actor(c));
    }
    await completeOpenTasks(db, b.visit.id, 'create_recommendations', actor(c));
    return 'Recommendation created.';
  });
});

routes.post('/:id/recommendations/:recId/send-review', async (c) => {
  return withVisit(
    c,
    (b) => {
      const p = perms(c, b);
      return p.isMaintEngineer || p.isAdmin;
    },
    async (b) => {
      const rec = b.recs.find((r) => r.id === c.req.param('recId'));
      if (!rec || rec.status !== 'open' || rec.sent_for_review) throw new Error('This recommendation cannot be sent for review.');
      const db = c.env.DB;
      await updateRow(db, 'recommendations', rec.id, { sent_for_review: 1, status: 'in_review' }, actor(c));
      await updateRow(db, 'visits', b.visit.id, { status: 'in_review' satisfies VisitStatus }, actor(c));
      const cfg = await getConfig(db);
      await createTask(db, b.visit.id, 'technical_review', b.visit.technical_engineer_id,
        addDays(todayStr(), cfg.technical_review_days), actor(c), `Review recommendation: ${rec.description.slice(0, 80)}`);
      return 'Recommendation sent for technical review.';
    }
  );
});

routes.post('/:id/recommendations/:recId/review', async (c) => {
  const form = await c.req.formData();
  const decision = String(form.get('decision') ?? '');
  const response = String(form.get('response') ?? '').trim();
  const actionDescription = String(form.get('action_description') ?? '').trim();
  const assignTo = String(form.get('assign_to') ?? '');
  return withVisit(c, (b) => perms(c, b).canReview, async (b) => {
    const rec = b.recs.find((r) => r.id === c.req.param('recId'));
    if (!rec || rec.status !== 'in_review') throw new Error('This recommendation is not awaiting review.');
    if (!['no_action', 'request_sap', 'other_action'].includes(decision)) throw new Error('Pick a review decision.');
    if (decision === 'other_action' && !actionDescription) throw new Error('Describe the required action.');
    const db = c.env.DB;
    const done = decision === 'no_action';
    await updateRow(db, 'recommendations', rec.id, {
      technical_review_response: response || null,
      review_decision: decision,
      review_action_description: decision === 'other_action' ? actionDescription : null,
      action_assigned_to_id: !done && assignTo ? assignTo : null,
      reviewed_by_id: c.get('user').id,
      reviewed_at: now(),
      status: done ? 'completed' : 'approved',
      completed_at: done ? now() : null,
    }, actor(c));
    // An assigned action means that person owes a response before the
    // recommendation can be completed - give them a task with a deadline.
    if (!done && assignTo) {
      const cfg = await getConfig(db);
      await createTask(db, b.visit.id, 'review_recommendations', assignTo,
        addDays(todayStr(), cfg.recommendations_review_days), actor(c),
        `Respond to recommendation: ${rec.description.slice(0, 80)}`);
    }
    await completeOpenTasks(db, b.visit.id, 'technical_review', actor(c), c.get('user').id);
    // Once nothing is left awaiting review, the ball is back with the
    // maintenance engineer - reflect that in the visit status/banner.
    const stillInReview = await first(db, "SELECT id FROM recommendations WHERE visit_id = ? AND status = 'in_review'", b.visit.id);
    if (!stillInReview) {
      // Nothing left to review: close review tasks regardless of assignee
      // (an admin may have reviewed on the assignee's behalf).
      await completeOpenTasks(db, b.visit.id, 'technical_review', actor(c));
    }
    if (!stillInReview && b.visit.status === 'in_review') {
      await updateRow(db, 'visits', b.visit.id, { status: 'recommendations_created' satisfies VisitStatus }, actor(c));
    }
    const visit = (await first<Visit>(db, 'SELECT * FROM visits WHERE id = ?', b.visit.id))!;
    await maybeCreateCloseTask(db, visit, actor(c));
    const message = `Review submitted - ${REVIEW_DECISION_LABELS[decision as keyof typeof REVIEW_DECISION_LABELS].toLowerCase()}.`;
    // A no_action review can resolve the last recommendation too.
    const unresolved = await first(db, "SELECT id FROM recommendations WHERE visit_id = ? AND status NOT IN ('completed', 'cancelled')", b.visit.id);
    return unresolved ? message : { message, redirect: `/visits/${b.visit.id}?prompt-close=1` };
  });
});

routes.post('/:id/recommendations/:recId/edit', async (c) => {
  const form = await c.req.formData();
  const description = String(form.get('description') ?? '').trim();
  const sap = String(form.get('sap_notification_number') ?? '').trim();
  const dueDate = String(form.get('due_date') ?? '').trim();
  return withVisit(
    c,
    (b) => {
      const p = perms(c, b);
      return p.isMaintEngineer || p.isTechEngineer || p.isAdmin;
    },
    async (b) => {
      const rec = b.recs.find((r) => r.id === c.req.param('recId'));
      if (!rec || ['completed', 'cancelled'].includes(rec.status)) throw new Error('Completed or cancelled recommendations cannot be edited.');
      if (!description) throw new Error('A description is required.');
      if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('Pick a valid due date.');
      await updateRow(c.env.DB, 'recommendations', rec.id, {
        description, sap_notification_number: sap || null, due_date: dueDate || null,
      }, actor(c));
      return 'Recommendation updated.';
    }
  );
});

routes.post('/:id/recommendations/:recId/respond', async (c) => {
  const form = await c.req.formData();
  const response = String(form.get('response') ?? '').trim();
  return withVisit(
    c,
    () => true, // the assignee may be anyone; checked against the rec below
    async (b) => {
      const rec = b.recs.find((r) => r.id === c.req.param('recId'));
      if (!rec || rec.status !== 'approved' || !rec.action_assigned_to_id) throw new Error('This recommendation is not awaiting a response.');
      const user = c.get('user');
      if (user.id !== rec.action_assigned_to_id && !isAdmin(user)) {
        throw new Error('Only the assigned person can respond to this action.');
      }
      if (!response) throw new Error('A response is required.');
      await updateRow(c.env.DB, 'recommendations', rec.id, {
        action_response: response, action_responded_at: now(),
      }, actor(c));
      await completeOpenTasks(c.env.DB, b.visit.id, 'review_recommendations', actor(c), rec.action_assigned_to_id);
      return 'Response recorded - the recommendation can now be completed.';
    }
  );
});

routes.post('/:id/recommendations/:recId/reopen', async (c) => {
  return withVisit(
    c,
    (b) => {
      const p = perms(c, b);
      return (p.isMaintEngineer || p.isTechEngineer || p.isAdmin) && p.isOpen;
    },
    async (b) => {
      const rec = b.recs.find((r) => r.id === c.req.param('recId'));
      if (!rec || !['completed', 'cancelled'].includes(rec.status)) throw new Error('Only completed or cancelled recommendations can be reopened.');
      await updateRow(c.env.DB, 'recommendations', rec.id, {
        // Back to where it was in the flow: reviewed ones need their action
        // completed again, unreviewed ones start over as open.
        status: rec.review_decision ? 'approved' : 'open',
        completed_at: null, cancelled_at: null, cancellation_reason: null,
      }, actor(c));
      // The visit is no longer ready to close.
      await cancelOpenTasks(c.env.DB, b.visit.id, 'close_visit', actor(c));
      return 'Recommendation reopened.';
    }
  );
});

routes.post('/:id/recommendations/:recId/sap', async (c) => {
  const form = await c.req.formData();
  const sap = String(form.get('sap_notification_number') ?? '').trim();
  const dueDate = String(form.get('due_date') ?? '');
  return withVisit(
    c,
    (b) => {
      const p = perms(c, b);
      return p.isMaintEngineer || p.isAdmin;
    },
    async (b) => {
      const rec = b.recs.find((r) => r.id === c.req.param('recId'));
      if (!rec) throw new Error('Recommendation not found.');
      if (!sap || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error('SAP notification number and due date are both required.');
      await updateRow(c.env.DB, 'recommendations', rec.id, { sap_notification_number: sap, due_date: dueDate }, actor(c));
      return 'SAP details saved.';
    }
  );
});

routes.post('/:id/recommendations/:recId/complete', async (c) => {
  return withVisit(c, (b) => {
    const p = perms(c, b);
    return p.isMaintEngineer || p.isAdmin;
  }, async (b) => {
    const rec = b.recs.find((r) => r.id === c.req.param('recId'));
    if (!rec || !['open', 'approved'].includes(rec.status)) throw new Error('Only open or approved recommendations can be completed.');
    if (rec.review_decision === 'request_sap' && !rec.sap_notification_number) {
      throw new Error('Add the SAP notification number and due date before completing this recommendation.');
    }
    if (rec.action_assigned_to_id && !rec.action_response) {
      throw new Error('The assigned person must respond to the action before this recommendation can be completed.');
    }
    const db = c.env.DB;
    await updateRow(db, 'recommendations', rec.id, { status: 'completed', completed_at: now() }, actor(c));
    const visit = (await first<Visit>(db, 'SELECT * FROM visits WHERE id = ?', b.visit.id))!;
    await maybeCreateCloseTask(db, visit, actor(c));
    const unresolved = await first(db, "SELECT id FROM recommendations WHERE visit_id = ? AND status NOT IN ('completed', 'cancelled')", b.visit.id);
    return unresolved
      ? 'Recommendation completed.'
      : { message: 'Recommendation completed - that was the last one.', redirect: `/visits/${b.visit.id}?prompt-close=1` };
  });
});

routes.post('/:id/recommendations/:recId/cancel', async (c) => {
  const form = await c.req.formData();
  const reason = String(form.get('reason') ?? '').trim();
  return withVisit(c, (b) => {
    const p = perms(c, b);
    return p.isMaintEngineer || p.isAdmin;
  }, async (b) => {
    const rec = b.recs.find((r) => r.id === c.req.param('recId'));
    if (!rec || !['open', 'approved'].includes(rec.status)) throw new Error('Only open or approved recommendations can be cancelled.');
    if (!reason) throw new Error('A cancellation reason is required.');
    const db = c.env.DB;
    await updateRow(db, 'recommendations', rec.id, { status: 'cancelled', cancelled_at: now(), cancellation_reason: reason }, actor(c));
    const visit = (await first<Visit>(db, 'SELECT * FROM visits WHERE id = ?', b.visit.id))!;
    await maybeCreateCloseTask(db, visit, actor(c));
    const unresolved = await first(db, "SELECT id FROM recommendations WHERE visit_id = ? AND status NOT IN ('completed', 'cancelled')", b.visit.id);
    return unresolved
      ? 'Recommendation cancelled.'
      : { message: 'Recommendation cancelled - that was the last one.', redirect: `/visits/${b.visit.id}?prompt-close=1` };
  });
});

routes.post('/:id/close', async (c) => {
  return withVisit(c, (b) => perms(c, b).canClose, async (b) => {
    const db = c.env.DB;
    await updateRow(db, 'visits', b.visit.id, {
      status: 'completed' satisfies VisitStatus, completed_at: now(),
    }, actor(c));
    await completeOpenTasks(db, b.visit.id, 'close_visit', actor(c));
    // A completed visit should have no open tasks left - sweep any stragglers.
    for (const t of b.tasks) {
      if (t.task_type !== 'close_visit' && ['pending', 'in_progress', 'overdue'].includes(t.status)) {
        await updateRow(db, 'tasks', t.id, { status: 'cancelled' }, actor(c));
      }
    }
    return 'Visit closed.';
  });
});

routes.post('/:id/cancel', async (c) => {
  const form = await c.req.formData();
  const reason = String(form.get('reason') ?? '').trim();
  return withVisit(c, (b) => perms(c, b).canCancel, async (b) => {
    if (!reason) throw new Error('A cancellation reason is required.');
    const db = c.env.DB;
    await updateRow(db, 'visits', b.visit.id, {
      status: 'cancelled' satisfies VisitStatus, cancelled_at: now(), cancellation_reason: reason,
    }, actor(c));
    for (const t of b.tasks) {
      if (['pending', 'in_progress', 'overdue'].includes(t.status)) {
        await updateRow(db, 'tasks', t.id, { status: 'cancelled' }, actor(c));
      }
    }
    return 'Visit cancelled.';
  });
});

routes.post('/:id/comments', async (c) => {
  const form = await c.req.formData();
  const body = String(form.get('body') ?? '').trim();
  return withVisit(c, () => true, async (b) => {
    if (!body) throw new Error('Write a comment first.');
    await insertRow(c.env.DB, 'visit_comments', {
      visit_id: b.visit.id, author_id: c.get('user').id, body, created_at: now(),
    }, actor(c));
    return 'Comment added.';
  });
});

routes.post('/:id/comments/:commentId/delete', async (c) => {
  return withVisit(
    c,
    () => true, // author/admin checked against the comment below
    async (b) => {
      const comment = b.comments.find((cm) => cm.id === c.req.param('commentId'));
      if (!comment) throw new Error('Comment not found.');
      const user = c.get('user');
      if (comment.author_id !== user.id && !isAdmin(user)) throw new Error('Only the author or an admin can delete a comment.');
      await deleteRow(c.env.DB, 'visit_comments', comment.id, actor(c));
      return 'Comment deleted.';
    }
  );
});

routes.post('/:id/reopen', async (c) => {
  return withVisit(c, (b) => perms(c, b).canReopen, async (b) => {
    const db = c.env.DB;
    // Put the visit back at the right point in the workflow.
    let status: VisitStatus;
    if (b.recs.length > 0) {
      status = b.recs.some((r) => r.status === 'in_review') ? 'in_review' : 'recommendations_created';
    } else if (b.reports.length > 0 || b.visit.no_report_reason) {
      status = 'report_uploaded';
    } else if (b.visit.confirmed_date) {
      status = 'date_confirmed';
    } else {
      status = 'scheduled';
    }
    await updateRow(db, 'visits', b.visit.id, {
      status, completed_at: null, cancelled_at: null, cancellation_reason: null,
    }, actor(c));
    // Re-seed the next-step task so the workflow chain resumes.
    const cfg = await getConfig(db);
    if (status === 'scheduled') {
      await createTaskOnce(db, b.visit.id, 'confirm_visit_date', b.visit.vendor_coordinator_id,
        addDays(b.visit.scheduled_date, -cfg.visit_confirmation_days), actor(c));
    } else if (status === 'date_confirmed') {
      await createTaskOnce(db, b.visit.id, 'upload_report', b.visit.vendor_coordinator_id,
        addDays(b.visit.confirmed_date!, cfg.report_upload_weeks * 7), actor(c));
    } else if (status === 'report_uploaded') {
      await createTaskOnce(db, b.visit.id, 'create_recommendations', b.visit.maintenance_engineer_id,
        addDays(todayStr(), cfg.recommendations_review_days), actor(c));
    } else if (status === 'in_review') {
      await createTaskOnce(db, b.visit.id, 'technical_review', b.visit.technical_engineer_id,
        addDays(todayStr(), cfg.technical_review_days), actor(c));
    }
    return 'Visit reopened.';
  });
});

routes.post('/:id/reschedule', async (c) => {
  const form = await c.req.formData();
  const newDate = String(form.get('new_date') ?? '');
  const reason = String(form.get('reason') ?? '').trim();
  return withVisit(c, (b) => perms(c, b).canReschedule, async (b) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) throw new Error('Pick a valid new date.');
    if (!reason) throw new Error('A reschedule reason is required.');
    const db = c.env.DB;
    const oldDate = b.visit.scheduled_date;
    await updateRow(db, 'visits', b.visit.id, {
      scheduled_date: newDate, confirmed_date: null, confirmed_at: null,
      status: 'scheduled' satisfies VisitStatus,
      reschedule_reason: reason, rescheduled_at: now(), rescheduled_from: oldDate,
    }, actor(c));
    // The workflow restarts at confirmation - drop the later-step tasks too.
    await cancelOpenTasks(db, b.visit.id, 'confirm_visit_date', actor(c));
    await cancelOpenTasks(db, b.visit.id, 'upload_report', actor(c));
    await cancelOpenTasks(db, b.visit.id, 'create_recommendations', actor(c));
    const cfg = await getConfig(db);
    await createTask(db, b.visit.id, 'confirm_visit_date', b.visit.vendor_coordinator_id,
      addDays(newDate, -cfg.visit_confirmation_days), actor(c),
      `Rescheduled from ${oldDate}. Reason: ${reason}`);
    return `Visit rescheduled to ${fmtDate(newDate)}.`;
  });
});

routes.post('/:id/reassign', async (c) => {
  const form = await c.req.formData();
  const coordinatorId = String(form.get('vendor_coordinator_id') ?? '');
  const maintEngineerId = String(form.get('maintenance_engineer_id') ?? '');
  const techEngineerId = String(form.get('technical_engineer_id') ?? '');
  return withVisit(c, (b) => perms(c, b).canReassign, async (b) => {
    if (!coordinatorId || !maintEngineerId || !techEngineerId) throw new Error('All three roles must be assigned.');
    const db = c.env.DB;
    await updateRow(db, 'visits', b.visit.id, {
      vendor_coordinator_id: coordinatorId,
      maintenance_engineer_id: maintEngineerId,
      technical_engineer_id: techEngineerId,
    }, actor(c));
    // Move open tasks with the team so nothing stays assigned to the old people.
    const taskOwner: Record<string, string> = {
      confirm_visit_date: coordinatorId, upload_report: coordinatorId,
      create_recommendations: maintEngineerId, close_visit: maintEngineerId,
      technical_review: techEngineerId, review_recommendations: techEngineerId,
    };
    for (const t of b.tasks) {
      const newOwner = taskOwner[t.task_type];
      if (newOwner && newOwner !== t.assigned_to_id && ['pending', 'in_progress', 'overdue'].includes(t.status)) {
        await updateRow(db, 'tasks', t.id, { assigned_to_id: newOwner }, actor(c));
      }
    }
    return 'Team reassigned (open tasks moved to the new assignees).';
  });
});

routes.post('/:id/delete', async (c) => {
  const user = c.get('realUser');
  if (!isAdmin(user)) return c.text('Forbidden', 403);
  const id = c.req.param('id')!;
  const reports = await all<VisitReport>(c.env.DB, 'SELECT * FROM visit_reports WHERE visit_id = ?', id);
  for (const r of reports) await c.env.REPORTS.delete(r.file_key);
  await deleteRow(c.env.DB, 'visits', id, user.id); // tasks/recs/reports cascade
  flash(c, 'Visit deleted.');
  return c.redirect('/visits');
});

// ---------- Detail page ----------

const STEPS: { status: VisitStatus; label: string }[] = [
  { status: 'scheduled', label: 'Scheduled' },
  { status: 'date_confirmed', label: 'Date Confirmed' },
  { status: 'report_uploaded', label: 'Report Uploaded' },
  { status: 'recommendations_created', label: 'Recommendations' },
  { status: 'in_review', label: 'In Review' },
  { status: 'completed', label: 'Completed' },
];

interface Activity { date: string; event: string; details?: string }

interface AuditEvent { table_name: string; old_data: string | null; new_data: string | null; created_at: string; actor_name: string | null }

/** Reopen events only exist in the audit trail (reopening clears the completion timestamps). */
function reopenActivity(auditRows: AuditEvent[]): Activity[] {
  const items: Activity[] = [];
  for (const row of auditRows) {
    try {
      const oldData = JSON.parse(row.old_data ?? '{}');
      const newData = JSON.parse(row.new_data ?? '{}');
      const by = row.actor_name ? ` by ${row.actor_name}` : '';
      const CLOSED = ['completed', 'cancelled'];
      if (row.table_name === 'visits' && CLOSED.includes(oldData.status) && !CLOSED.includes(newData.status)) {
        items.push({ date: row.created_at, event: 'Visit reopened', details: `Reopened${by}` });
      }
      if (row.table_name === 'visits' && oldData.status !== 'cancelled' && newData.status === 'cancelled') {
        items.push({
          date: row.created_at, event: 'Visit cancelled',
          details: `${newData.cancellation_reason ?? ''}${by ? ` (${by.trim()})` : ''}`.trim() || undefined,
        });
      }
      if (row.table_name === 'recommendations' &&
          ['completed', 'cancelled'].includes(oldData.status) && ['open', 'approved'].includes(newData.status)) {
        items.push({ date: row.created_at, event: 'Recommendation reopened', details: `${String(newData.description ?? '').slice(0, 60)}${by ? ` - reopened${by}` : ''}` });
      }
    } catch { /* skip malformed rows */ }
  }
  return items;
}

function buildActivity(b: VisitBundle): Activity[] {
  const items: Activity[] = [];
  const v = b.visit;
  items.push({ date: v.created_at, event: 'Visit created', details: `Scheduled for ${fmtDate(v.rescheduled_from ?? v.scheduled_date)}` });
  if (v.confirmed_date) items.push({ date: v.confirmed_at ?? v.updated_at, event: 'Date confirmed', details: `Confirmed for ${fmtDate(v.confirmed_date)}` });
  if (v.rescheduled_at) {
    items.push({
      date: v.rescheduled_at, event: 'Visit rescheduled',
      details: `From ${fmtDate(v.rescheduled_from)} to ${fmtDate(v.scheduled_date)}${v.reschedule_reason ? `. ${v.reschedule_reason}` : ''}`,
    });
  }
  for (const r of b.reports) {
    items.push({ date: r.uploaded_at, event: 'Report uploaded', details: `${r.file_name} (${r.uploaded_by_name})${r.notes ? `. ${r.notes}` : ''}` });
  }
  if (v.no_report_reason && b.reports.length === 0) items.push({ date: v.updated_at, event: 'No report available', details: v.no_report_reason });
  for (const rec of b.recs) {
    items.push({ date: rec.created_at, event: 'Recommendation created', details: rec.description.slice(0, 80) });
    if (rec.reviewed_at) items.push({ date: rec.reviewed_at, event: 'Recommendation reviewed', details: `By ${rec.reviewed_by_name ?? 'technical engineer'}` });
    if (rec.completed_at) items.push({ date: rec.completed_at, event: 'Recommendation completed', details: rec.description.slice(0, 40) });
    if (rec.cancelled_at) items.push({ date: rec.cancelled_at, event: 'Recommendation cancelled', details: rec.cancellation_reason ?? undefined });
  }
  for (const t of b.tasks) {
    if (t.completed_at) items.push({ date: t.completed_at, event: `${TASK_TYPE_LABELS[t.task_type]} task completed` });
  }
  if (v.completed_at) items.push({ date: v.completed_at, event: 'Visit closed' });
  return items.sort((a, z) => z.date.localeCompare(a.date));
}

routes.get('/:id', async (c) => {
  const bundle = await loadVisit(c, c.req.param('id')!);
  if (!bundle) {
    return page(c, 'Visit not found', (
      <EmptyState title="Visit not found" hint="It may have been deleted.">
        <a class="btn mt" href="/visits">Back to visits</a>
      </EmptyState>
    ));
  }
  const { visit, meta, recs, reports, comments, team } = bundle;
  const p = perms(c, bundle);
  const user = c.get('user');
  const users = (p.canReassign || p.canReview) ? await activeUsers(c.env.DB) : [];
  const currentStep = STEPS.findIndex((s) => s.status === visit.status);
  const waiting = waitingFor(visit, {
    coordinator: team.coordinator?.full_name,
    maintEngineer: team.maintEngineer?.full_name,
    techEngineer: team.techEngineer?.full_name,
  });
  const auditRows = await all<AuditEvent>(
    c.env.DB,
    `SELECT a.table_name, a.old_data, a.new_data, a.created_at, u.full_name AS actor_name
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.action = 'UPDATE' AND (
       (a.table_name = 'visits' AND a.record_id = ?) OR
       (a.table_name = 'recommendations' AND a.record_id IN (SELECT id FROM recommendations WHERE visit_id = ?)))`,
    visit.id, visit.id
  );
  const activity = [...buildActivity(bundle), ...reopenActivity(auditRows)]
    .sort((a, z) => z.date.localeCompare(a.date));
  const canManageRec = p.isMaintEngineer || p.isAdmin;
  const canEditRec = p.isMaintEngineer || p.isTechEngineer || p.isAdmin;
  type Rec = VisitBundle['recs'][number];
  const awaitingResponse = (rec: Rec) => rec.status === 'approved' && !!rec.action_assigned_to_id && !rec.action_response;
  const canRespond = (rec: Rec) => awaitingResponse(rec) && (user.id === rec.action_assigned_to_id || p.isAdmin);
  const sapMissing = (rec: Rec) => rec.review_decision === 'request_sap' && !rec.sap_notification_number;
  const replacedIds = new Set(reports.map((r) => r.replaces_id).filter(Boolean));

  return page(c, `Visit ${meta.plan_number}`, (
    <>
      <PageHeader
        title={<>{meta.plan_number} - <a href={`/vendors/${meta.vendor_id}`}>{meta.vendor_name}</a></>}
        sub={meta.description}
      >
        <a class="btn" href="/visits">← All visits</a>
      </PageHeader>

      {visit.status === 'cancelled' ? (
        <Card>
          <Badge tone="gray">Cancelled</Badge>{' '}
          This visit was cancelled{visit.cancelled_at ? ` on ${fmtDate(visit.cancelled_at)}` : ''}
          {visit.cancellation_reason ? ` - ${visit.cancellation_reason}` : '.'}
        </Card>
      ) : (
        <Card>
          <div class="stepper">
            {STEPS.map((s, i) => (
              <div class={`step ${i < currentStep ? 'step--done' : i === currentStep ? 'step--current' : ''}`}>
                <div class="step__dot">{i < currentStep ? '✓' : i + 1}</div>
                <div class="step__label">{s.label}</div>
              </div>
            ))}
          </div>
          {p.canClose ? (
            <div class="waiting waiting--ready">
              All recommendations are resolved - this visit is ready to close.
              <ActionButton action={`/visits/${visit.id}/close`} label="Close Visit" class="btn btn--sm btn--green"
                confirm="Close this visit? All recommendations are resolved." busy="Closing…" />
            </div>
          ) : p.pendingRecsCheck && p.isOpen ? (
            <div class="waiting">
              Waiting for <strong>{team.maintEngineer?.full_name ?? 'the maintenance engineer'}</strong> to add
              recommendations from the latest report, or confirm none are needed.
              {(p.isMaintEngineer || p.isAdmin) && (
                <span style="margin-left:0.75rem">
                  <ActionButton action={`/visits/${visit.id}/recommendations-check`} label="No further recommendations"
                    class="btn btn--sm" confirm="Confirm the latest report raises no new recommendations?" busy="Confirming…" />
                </span>
              )}
            </div>
          ) : (
            waiting && <div class="waiting">Waiting for <strong>{waiting}</strong></div>
          )}
        </Card>
      )}

      {/* Workflow actions - only what the current user can actually do right now */}
      {(p.canConfirmDate || p.canUploadReport || p.canCreateRec || p.canReschedule || p.canCancel || p.canClose || p.canReopen) && (
        <Card title="Actions">
          <div class="btn-row">
            {p.canConfirmDate && <button class="btn btn--primary" data-modal="confirm-date"><Icon name="check" size={16} /> Confirm Visit Date</button>}
            {p.canUploadReport && <button class="btn btn--primary" data-modal="upload-report"><Icon name="upload" size={16} /> Upload Report</button>}
            {p.canUploadReport && visit.status === 'date_confirmed' && !visit.no_report_reason && (
              <button class="btn" data-modal="no-report">No Report Available</button>
            )}
            {p.canCreateRec && <button class="btn btn--primary" data-modal="add-rec"><Icon name="plus" size={16} /> Add Recommendation</button>}
            {p.canReschedule && <button class="btn" data-modal="reschedule">Reschedule</button>}
            {p.canCancel && <button class="btn btn--danger" data-modal="cancel-visit">Cancel Visit</button>}
            {p.canClose && (
              <ActionButton action={`/visits/${visit.id}/close`} label="Close Visit" class="btn btn--green"
                confirm="Close this visit? All recommendations are resolved." busy="Closing…" />
            )}
            {p.canReopen && (
              <ActionButton action={`/visits/${visit.id}/reopen`} label="Reopen Visit" class="btn"
                confirm="Reopen this completed visit?" busy="Reopening…" />
            )}
          </div>
        </Card>
      )}

      <div class="grid-2">
        <Card title="Visit Information">
          <dl class="kv">
            <div><dt>Status</dt><dd>{visitBadge(visit.status)}</dd></div>
            <div><dt>Scheduled Date{visit.end_date ? 's' : ''}</dt><dd>{fmtRange(visit.scheduled_date, visit.end_date)}</dd></div>
            <div><dt>Confirmed Date{visit.end_date && visit.confirmed_date ? 's' : ''}</dt><dd>{visit.confirmed_date ? fmtRange(visit.confirmed_date, visit.end_date) : '-'}</dd></div>
            <div>
              <dt>Vendor Contact</dt>
              <dd>
                {meta.vendor_contact && <>{meta.vendor_contact}<br /></>}
                {meta.vendor_email ? <a href={`mailto:${meta.vendor_email}`}>{meta.vendor_email}</a> : null}
                {meta.vendor_email && meta.vendor_phone ? <br /> : null}
                {meta.vendor_phone ? <a href={`tel:${meta.vendor_phone}`}>{meta.vendor_phone}</a> : null}
                {!meta.vendor_contact && !meta.vendor_email && !meta.vendor_phone && '-'}
              </dd>
            </div>
            <div>
              <dt>Notification #</dt>
              <dd>
                {visit.notification_number ?? '-'}{' '}
                {p.canReschedule && <button class="btn btn--ghost btn--sm" data-modal="edit-notification">Edit</button>}
              </dd>
            </div>
            {visit.rescheduled_at && (
              <div><dt>Rescheduled</dt><dd class="muted">From {fmtDate(visit.rescheduled_from)} - {visit.reschedule_reason}</dd></div>
            )}
          </dl>

          <h3 class="mt" style="font-size:0.9rem">Reports ({reports.length})</h3>
          {reports.length === 0 && !visit.no_report_reason && <p class="muted">No reports uploaded yet.</p>}
          {visit.no_report_reason && reports.length === 0 && (
            <p class="waiting">No report available - {visit.no_report_reason}</p>
          )}
          {reports.map((r) => {
            const isReplaced = replacedIds.has(r.id);
            return (
              <div class="dropdown__item" style={`border:1px solid var(--border); margin-top:0.4rem${isReplaced ? '; opacity:0.6' : ''}`}>
                <strong>{r.file_name} {isReplaced && <Badge tone="gray">Replaced</Badge>}{r.replaces_id && <Badge tone="blue">Replacement</Badge>}</strong>
                <span class="muted">Uploaded by {r.uploaded_by_name} on {fmtDateTime(r.uploaded_at)}{r.notes ? ` - ${r.notes}` : ''}</span>
                <span class="btn-row mt" style="margin-top:0.4rem">
                  <a class="btn btn--sm btn--icon" href={`/visits/${visit.id}/reports/${r.id}/view`} target="_blank" title="View in browser" aria-label="View report in browser"><Icon name="eye" size={15} /></a>
                  <a class="btn btn--sm btn--icon" href={`/visits/${visit.id}/reports/${r.id}/download`} title="Download report" aria-label="Download report"><Icon name="download" size={15} /></a>
                  {p.isAdmin && (
                    <IconAction action={`/visits/${visit.id}/reports/${r.id}/delete`} icon="trash" label="Delete report"
                      class="btn--danger" confirm={`Delete report "${r.file_name}"?`} />
                  )}
                </span>
              </div>
            );
          })}
        </Card>

        <Card title="Assigned Team" actions={p.canReassign && <button class="btn btn--sm" data-modal="reassign">Reassign</button>}>
          <dl class="kv" style="grid-template-columns:1fr">
            {(
              [
                ['Vendor Coordinator', team.coordinator],
                ['Maintenance Engineer', team.maintEngineer],
                ['Technical Engineer', team.techEngineer],
              ] as const
            ).map(([label, member]) => (
              <div>
                <dt>{label}</dt>
                <dd>{member?.full_name ?? 'Unknown'}<div class="muted">{member?.email}</div></dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <Card title={<>Recommendations <Badge tone="gray">{recs.length}</Badge></>} pad={false}>
        {recs.length === 0 ? (
          <EmptyState title="No recommendations yet"
            hint={p.canCreateRec ? 'Use "Add Recommendation" above once the report is reviewed.' : undefined} />
        ) : (
          <div class="tbl-wrap">
            <table class="tbl">
              <thead>
                <tr><th>Description</th><th>SAP #</th><th>Due</th><th>Status</th><th>Created By</th><th class="actions">Actions</th></tr>
              </thead>
              <tbody>
                {recs.map((rec) => (
                  <tr>
                    <td>
                      <div class="desc-clip">{rec.description}</div>
                      {rec.review_decision && (
                        <div class="muted">
                          Decision: {REVIEW_DECISION_LABELS[rec.review_decision]}
                          {rec.action_assigned_name ? ` → ${rec.action_assigned_name}` : ''}
                          {rec.review_action_description ? ` - ${rec.review_action_description}` : ''}
                        </div>
                      )}
                      {rec.technical_review_response && <div class="muted">“{rec.technical_review_response}”</div>}
                      {awaitingResponse(rec) && <div class="text-red" style="font-size:0.83rem">Awaiting response from {rec.action_assigned_name ?? 'the assignee'}</div>}
                      {rec.action_response && <div class="muted">Response{rec.action_assigned_name ? ` from ${rec.action_assigned_name}` : ''}: {rec.action_response}</div>}
                      {rec.cancellation_reason && <div class="muted">Cancelled: {rec.cancellation_reason}</div>}
                    </td>
                    <td>{rec.sap_notification_number ?? '-'}</td>
                    <td>{fmtDate(rec.due_date)}</td>
                    <td>{recBadge(rec.status)}</td>
                    <td>{rec.created_by_name}</td>
                    <td class="actions">
                      {!['completed', 'cancelled'].includes(rec.status) && canEditRec && (
                        <IconModalBtn modal={`edit-rec-${rec.id}`} icon="edit" label="Edit recommendation" />
                      )}
                      {rec.status === 'open' && !rec.sent_for_review && canManageRec && meta.requires_technical_review && (
                        <IconAction action={`/visits/${visit.id}/recommendations/${rec.id}/send-review`} icon="send" label="Send for review" />
                      )}
                      {rec.status === 'in_review' && p.canReview && (
                        <IconModalBtn modal={`review-${rec.id}`} icon="tasks" label="Submit review" class="btn--primary" />
                      )}
                      {rec.status === 'approved' && sapMissing(rec) && canManageRec && (
                        <IconModalBtn modal={`sap-${rec.id}`} icon="tag" label="Add SAP details" class="btn--primary" />
                      )}
                      {canRespond(rec) && (
                        <IconModalBtn modal={`respond-${rec.id}`} icon="message" label="Respond" class="btn--primary" />
                      )}
                      {['open', 'approved'].includes(rec.status) && canManageRec && (
                        <>
                          {/* Complete is impossible until SAP details / the assignee's response exist */}
                          {!sapMissing(rec) && !awaitingResponse(rec) && (
                            <IconAction action={`/visits/${visit.id}/recommendations/${rec.id}/complete`} icon="tick" label="Complete" class="btn--green" />
                          )}
                          <IconModalBtn modal={`cancel-rec-${rec.id}`} icon="x" label="Cancel recommendation" class="btn--danger" />
                        </>
                      )}
                      {['completed', 'cancelled'].includes(rec.status) && canEditRec && p.isOpen && (
                        <IconAction action={`/visits/${visit.id}/recommendations/${rec.id}/reopen`} icon="rotate" label="Reopen recommendation"
                          confirm="Reopen this recommendation? The visit can't be closed until it is resolved again." />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title={<>Comments <Badge tone="gray">{comments.length}</Badge></>}>
        <form method="post" action={`/visits/${visit.id}/comments`} style="display:flex; gap:0.5rem; align-items:flex-start; margin-bottom:1rem">
          <textarea name="body" rows={2} required placeholder="Add a note…" style="flex:1"></textarea>
          <button type="submit" class="btn btn--primary" data-busy="Posting…">Post</button>
        </form>
        {comments.length === 0 ? <p class="muted">No comments yet.</p> : (
          <ul class="timeline">
            {comments.map((cm) => (
              <li>
                <div style="display:flex; align-items:center; gap:0.5rem">
                  <strong>{cm.author_name}</strong>
                  <span class="muted">{fmtDateTime(cm.created_at)}</span>
                  {(cm.author_id === user.id || p.isAdmin) && (
                    <span style="margin-left:auto">
                      <IconAction action={`/visits/${visit.id}/comments/${cm.id}/delete`} icon="trash" label="Delete comment"
                        class="btn--ghost" confirm="Delete this comment?" />
                    </span>
                  )}
                </div>
                <div style="white-space:pre-wrap">{cm.body}</div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Activity">
        {activity.length === 0 ? <p class="muted">No activity recorded yet.</p> : (
          <ul class="timeline">
            {activity.map((a) => (
              <li>
                <strong>{a.event}</strong>
                <span class="muted">{fmtDateTime(a.date)}{a.details ? ` - ${a.details}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---- Modals ---- */}
      {(p.isCoordinator || p.isMaintEngineer || p.isAdmin) && c.req.query('prompt-recs') === '1' && (
        <Modal id="prompt-recs" title="More recommendations needed?" autoOpen>
          <div class="modal__content">
            <p>A report was added after the recommendations stage. Does it raise anything that needs new recommendations?</p>
            <div class="modal__buttons">
              <button type="button" class="btn" data-close>No, nothing new</button>
              <ActionButton action={`/visits/${visit.id}/more-recommendations`} label="Yes - reopen for recommendations"
                class="btn btn--primary" busy="Reopening…" />
            </div>
          </div>
        </Modal>
      )}

      {p.canClose && c.req.query('prompt-close') === '1' && (
        <Modal id="prompt-close" title="Close this visit?" autoOpen>
          <div class="modal__content">
            <p>All recommendations on this visit are resolved - it can be closed now.</p>
            <div class="modal__buttons">
              <button type="button" class="btn" data-close>Not yet</button>
              <ActionButton action={`/visits/${visit.id}/close`} label="Close Visit" class="btn btn--green" busy="Closing…" />
            </div>
          </div>
        </Modal>
      )}

      <Modal id="confirm-date" title="Confirm Visit Date">
        <form method="post" action={`/visits/${visit.id}/confirm-date`}>
          <div class="context">Scheduled for <strong>{fmtDate(visit.scheduled_date)}</strong>. Confirm the date agreed with the vendor.</div>
          <div class="form-grid">
            <Field label="Confirmed date">
              <input type="date" name="confirmed_date" required value={visit.confirmed_date ?? visit.scheduled_date} />
            </Field>
            <Field label="End date (optional)" hint="For visits spanning several days.">
              <input type="date" name="end_date" value={visit.end_date ?? ''} />
            </Field>
          </div>
          <ModalButtons submit="Confirm Date" />
        </form>
      </Modal>

      <Modal id="upload-report" title={reports.length > 0 ? 'Add Report' : 'Upload Maintenance Report'}>
        <form method="post" action={`/visits/${visit.id}/reports`} enctype="multipart/form-data">
          {reports.filter((r) => !replacedIds.has(r.id)).length > 0 && (
            <Field label="Add as" hint="Replacing keeps the old file, marked as replaced.">
              <select name="replaces_id">
                <option value="">Additional report</option>
                {reports.filter((r) => !replacedIds.has(r.id)).map((r) => (
                  <option value={r.id}>Replacement for: {r.file_name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Report file" hint="PDF, Word or Excel, up to 10 MB.">
            <input type="file" name="file" required accept=".pdf,.doc,.docx,.xls,.xlsx" />
          </Field>
          <Field label="Notes (optional)">
            <textarea name="notes" rows={2} placeholder="Any notes about this report…"></textarea>
          </Field>
          <ModalButtons submit="Upload Report" busy="Uploading…" />
        </form>
      </Modal>

      <Modal id="no-report" title="No Report Available">
        <form method="post" action={`/visits/${visit.id}/no-report`}>
          <p class="muted">Explain why no maintenance report is available; the visit will move on without one.</p>
          <Field label="Reason">
            <textarea name="reason" rows={3} required placeholder="e.g. vendor performed inspection only, no report issued"></textarea>
          </Field>
          <ModalButtons submit="Confirm" />
        </form>
      </Modal>

      <Modal id="add-rec" title="Add Recommendation">
        <form method="post" action={`/visits/${visit.id}/recommendations`}>
          {meta.requires_technical_review ? (
            <div class="note">Recommendations require technical review - this one will be sent to {team.techEngineer?.full_name ?? 'the technical engineer'} automatically.</div>
          ) : null}
          <Field label="Description">
            <textarea name="description" rows={4} required placeholder="Describe the recommendation…"></textarea>
          </Field>
          {!meta.requires_technical_review && (
            <div class="form-grid">
              <Field label="SAP notification # (optional)"><input name="sap_notification_number" /></Field>
              <Field label="Due date (optional)"><input type="date" name="due_date" /></Field>
            </div>
          )}
          <ModalButtons submit={meta.requires_technical_review ? 'Create & Send for Review' : 'Create Recommendation'} />
        </form>
      </Modal>

      {p.canCancel && (
        <Modal id="cancel-visit" title="Cancel Visit">
          <form method="post" action={`/visits/${visit.id}/cancel`} data-confirm="Cancel this visit? All its open tasks will be cancelled too.">
            <p class="muted">The visit and all its open tasks are cancelled. The assigned team can reopen it later if needed.</p>
            <Field label="Cancellation reason">
              <textarea name="reason" rows={3} required placeholder="e.g. vendor contract ended, duplicate visit…"></textarea>
            </Field>
            <ModalButtons submit="Cancel Visit" danger busy="Cancelling…" />
          </form>
        </Modal>
      )}

      <Modal id="reschedule" title="Reschedule Visit">
        <form method="post" action={`/visits/${visit.id}/reschedule`}>
          <div class="context">Currently scheduled for <strong>{fmtDate(visit.scheduled_date)}</strong>. Rescheduling resets the confirmation workflow.</div>
          <Field label="New scheduled date"><input type="date" name="new_date" required /></Field>
          <Field label="Reason"><textarea name="reason" rows={3} required placeholder="Explain why the visit is moving…"></textarea></Field>
          <ModalButtons submit="Reschedule" />
        </form>
      </Modal>

      <Modal id="edit-notification" title="Notification Number">
        <form method="post" action={`/visits/${visit.id}/notification`}>
          <Field label="Notification number" hint="Unique to this visit, e.g. NOT-2026-0042.">
            <input name="notification_number" value={visit.notification_number ?? ''} placeholder="NOT-2026-0042" />
          </Field>
          <ModalButtons submit="Save" />
        </form>
      </Modal>

      {p.canReassign && (
        <Modal id="reassign" title="Reassign Team">
          <form method="post" action={`/visits/${visit.id}/reassign`}>
            <p class="muted">Open tasks are moved to the new assignees automatically.</p>
            {(
              [
                ['Vendor Coordinator', 'vendor_coordinator_id', 'vendor_coordinator', visit.vendor_coordinator_id],
                ['Maintenance Engineer', 'maintenance_engineer_id', 'maintenance_engineer', visit.maintenance_engineer_id],
                ['Technical Engineer', 'technical_engineer_id', 'technical_engineer', visit.technical_engineer_id],
              ] as const
            ).map(([label, name, role, current]) => (
              <Field label={label}>
                <select name={name} required>
                  {users.filter((u) => u.role === role || isAdmin(u) || u.id === current).map((u) => (
                    <option value={u.id} selected={u.id === current}>{u.full_name} ({ROLE_LABELS[u.role]})</option>
                  ))}
                </select>
              </Field>
            ))}
            <ModalButtons submit="Save Changes" />
          </form>
        </Modal>
      )}

      {recs.filter((r) => r.status === 'in_review').map((rec) => (
        <Modal id={`review-${rec.id}`} title="Submit Technical Review">
          <form method="post" action={`/visits/${visit.id}/recommendations/${rec.id}/review`}>
            <div class="context">{rec.description}</div>
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

      {recs.filter((r) => r.status === 'approved' && r.review_decision === 'request_sap' && !r.sap_notification_number).map((rec) => (
        <Modal id={`sap-${rec.id}`} title="Add SAP Notification Details">
          <form method="post" action={`/visits/${visit.id}/recommendations/${rec.id}/sap`}>
            <div class="note note--amber">The technical engineer requested a SAP notification for this recommendation.</div>
            <div class="context">{rec.description}</div>
            <div class="form-grid">
              <Field label="SAP notification #"><input name="sap_notification_number" required /></Field>
              <Field label="Due date"><input type="date" name="due_date" required /></Field>
            </div>
            <ModalButtons submit="Save SAP Details" />
          </form>
        </Modal>
      ))}

      {recs.filter(canRespond).map((rec) => (
        <Modal id={`respond-${rec.id}`} title="Respond to Assigned Action">
          <form method="post" action={`/visits/${visit.id}/recommendations/${rec.id}/respond`}>
            <div class="context">
              <strong>{rec.description}</strong>
              {rec.review_action_description && <div class="muted">Requested action: {rec.review_action_description}</div>}
            </div>
            <Field label="Your response" hint="Recorded on the recommendation; it can be completed once a response exists.">
              <textarea name="response" rows={4} required placeholder="What was done, or your assessment…"></textarea>
            </Field>
            <ModalButtons submit="Submit Response" />
          </form>
        </Modal>
      ))}

      {canEditRec && recs.filter((r) => !['completed', 'cancelled'].includes(r.status)).map((rec) => (
        <Modal id={`edit-rec-${rec.id}`} title="Edit Recommendation">
          <form method="post" action={`/visits/${visit.id}/recommendations/${rec.id}/edit`}>
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

      {canManageRec && recs.filter((r) => ['open', 'approved'].includes(r.status)).map((rec) => (
        <Modal id={`cancel-rec-${rec.id}`} title="Cancel Recommendation">
          <form method="post" action={`/visits/${visit.id}/recommendations/${rec.id}/cancel`}>
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
