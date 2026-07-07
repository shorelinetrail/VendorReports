import { Hono } from 'hono';
import type { Context } from 'hono';
import { all, first, insertRow, updateRow } from '../db';
import { addMonths, fmtDate, todayStr } from '../dates';
import { activeUsers, findUserByEmail, flash, requireRole } from '../auth';
import { parseCsv, csvObjects, csvResponse } from '../csv';
import { page, Card, PageHeader, EmptyState, Modal, ModalButtons, Field, IconAction, IconModalBtn, Badge, Icon } from '../ui';
import { isAdmin, ROLE_LABELS, type App, type Routine, type User, type Vendor } from '../types';

const routes = new Hono<App>();
const manage = requireRole('admin', 'vendor_coordinator');

type RoutineRow = Routine & { vendor_name: string; next_open: string | null; last_completed: string | null };

const CSV_HEADERS = [
  'plan_number', 'description', 'vendor_name', 'interval_months', 'start_date', 'call_horizon_months',
  'vendor_coordinator_email', 'maintenance_engineer_email', 'technical_engineer_email', 'is_active', 'requires_technical_review',
];

function nextDue(r: RoutineRow): string {
  if (r.next_open) return r.next_open;
  if (r.last_completed) return addMonths(r.last_completed, r.interval_months);
  return r.start_date;
}

function RoutineForm({ action, routine, vendors, users, submit }: {
  action: string; routine?: Routine; vendors: Vendor[]; users: User[]; submit: string;
}) {
  const byRole = (role: string, current?: string) =>
    users.filter((u) => u.role === role || isAdmin(u) || u.id === current);
  return (
    <form method="post" action={action}>
      <div class="form-grid">
        <Field label="Plan number"><input name="plan_number" required value={routine?.plan_number ?? ''} placeholder="e.g. MP-001" /></Field>
        <Field label="Vendor">
          <select name="vendor_id" required>
            <option value="">Select a vendor…</option>
            {vendors.map((v) => <option value={v.id} selected={routine?.vendor_id === v.id}>{v.name}{v.is_active ? '' : ' (inactive)'}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description"><textarea name="description" rows={2} required>{routine?.description ?? ''}</textarea></Field>
      <div class="form-grid">
        <Field label="Interval (months)"><input type="number" name="interval_months" min={1} required value={routine?.interval_months ?? 12} /></Field>
        <Field label="Start date"><input type="date" name="start_date" required value={routine?.start_date ?? ''} /></Field>
        <Field label="Call horizon (months)" hint="How far ahead visits are created.">
          <input type="number" name="call_horizon_months" min={0} required value={routine?.call_horizon_months ?? 2} />
        </Field>
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
            {byRole(role, routine?.[name]).map((u) => (
              <option value={u.id} selected={routine?.[name] === u.id}>{u.full_name} ({ROLE_LABELS[u.role]})</option>
            ))}
          </select>
        </Field>
      ))}
      <label class="check">
        <input type="checkbox" name="requires_technical_review" checked={routine ? !!routine.requires_technical_review : true} />
        Recommendations require technical review
      </label>
      {routine && (
        <label class="check"><input type="checkbox" name="is_active" checked={!!routine.is_active} /> Active (visits are generated)</label>
      )}
      <ModalButtons submit={submit} />
    </form>
  );
}

routes.get('/', async (c) => {
  const db = c.env.DB;
  const canManage = isAdmin(c.get('user')) || c.get('user').role === 'vendor_coordinator';
  const [routinesList, vendors, users] = await Promise.all([
    all<RoutineRow>(
      db,
      `SELECT r.*, ve.name AS vendor_name,
              (SELECT MIN(scheduled_date) FROM visits WHERE routine_id = r.id AND status NOT IN ('completed', 'cancelled') AND scheduled_date >= ?) AS next_open,
              (SELECT MAX(scheduled_date) FROM visits WHERE routine_id = r.id AND status = 'completed') AS last_completed
       FROM routines r JOIN vendors ve ON ve.id = r.vendor_id
       ORDER BY r.plan_number`,
      todayStr()
    ),
    canManage ? all<Vendor>(db, 'SELECT * FROM vendors ORDER BY name') : Promise.resolve([]),
    canManage ? activeUsers(db) : Promise.resolve([]),
  ]);
  const activeVendors = vendors.filter((v) => v.is_active);

  return page(c, 'Routines', (
    <>
      <PageHeader title="Maintenance Routines" sub="Recurring plans that generate visits automatically">
        {canManage && (
          <>
            <button class="btn" data-modal="import"><Icon name="upload" size={16} /> Bulk Import</button>
            <button class="btn btn--primary" data-modal="create"><Icon name="plus" size={16} /> Add Routine</button>
          </>
        )}
      </PageHeader>

      <Card pad={false}>
        {routinesList.length === 0 ? (
          <EmptyState title="No routines yet" hint="Add a routine to start generating maintenance visits." />
        ) : (
          <div class="tbl-wrap">
            <table class="tbl">
              <thead>
                <tr><th>Plan</th><th>Description</th><th>Vendor</th><th>Interval</th><th>Next Due</th><th>Review</th><th>Status</th>{canManage && <th class="actions">Actions</th>}</tr>
              </thead>
              <tbody>
                {routinesList.map((r) => {
                  const due = nextDue(r);
                  return (
                    <tr {...(canManage ? { 'data-row-modal': `edit-${r.id}` } : {})}>
                      <td><strong>{r.plan_number}</strong></td>
                      <td><div class="desc-clip">{r.description}</div></td>
                      <td>{r.vendor_name}</td>
                      <td>{r.interval_months} mo</td>
                      <td class={due < todayStr() && r.is_active ? 'text-red' : ''}>{fmtDate(due)}</td>
                      <td>{r.requires_technical_review ? <Badge tone="purple">Required</Badge> : <Badge tone="gray">No</Badge>}</td>
                      <td>{r.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}</td>
                      {canManage && (
                        <td class="actions">
                          <IconModalBtn modal={`edit-${r.id}`} icon="edit" label="Edit routine" />
                          <IconAction
                            action={`/routines/${r.id}/toggle-active`}
                            icon={r.is_active ? 'archive' : 'rotate'}
                            label={r.is_active ? 'Archive routine' : 'Restore routine'}
                            class={r.is_active ? 'btn--danger' : 'btn--green'}
                            confirm={r.is_active ? `Archive routine ${r.plan_number}? No new visits will be generated (existing visits are kept).` : undefined}
                          />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {canManage && (
        <>
          <Modal id="create" title="Add Routine">
            <RoutineForm action="/routines" vendors={activeVendors} users={users} submit="Create Routine" />
          </Modal>
          {routinesList.map((r) => (
            <Modal id={`edit-${r.id}`} title={`Edit ${r.plan_number}`}>
              <RoutineForm action={`/routines/${r.id}`} routine={r} vendors={vendors} users={users} submit="Save Changes" />
            </Modal>
          ))}
          <Modal id="import" title="Bulk Import Routines">
            <form method="post" action="/routines/import" enctype="multipart/form-data">
              <p><a href="/routines/import/template"><Icon name="download" size={14} /> Download the CSV template</a></p>
              <Field label="CSV file"><input type="file" name="file" accept=".csv" required /></Field>
              <ModalButtons submit="Import" busy="Importing…" />
            </form>
          </Modal>
        </>
      )}
    </>
  ));
});

async function routineFromForm(c: Context<App>, form: FormData) {
  const get = (k: string) => String(form.get(k) ?? '').trim();
  const data = {
    plan_number: get('plan_number'),
    description: get('description'),
    vendor_id: get('vendor_id'),
    interval_months: parseInt(get('interval_months'), 10),
    start_date: get('start_date'),
    call_horizon_months: parseInt(get('call_horizon_months'), 10),
    vendor_coordinator_id: get('vendor_coordinator_id'),
    maintenance_engineer_id: get('maintenance_engineer_id'),
    technical_engineer_id: get('technical_engineer_id'),
    requires_technical_review: form.has('requires_technical_review') ? 1 : 0,
  };
  if (!data.plan_number || !data.description || !data.vendor_id || !data.vendor_coordinator_id ||
      !data.maintenance_engineer_id || !data.technical_engineer_id ||
      !Number.isInteger(data.interval_months) || data.interval_months < 1 ||
      !Number.isInteger(data.call_horizon_months) || data.call_horizon_months < 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.start_date)) {
    throw new Error('Please fill in all required fields with valid values.');
  }
  return data;
}

routes.post('/', manage, async (c) => {
  try {
    const data = await routineFromForm(c, await c.req.formData());
    await insertRow(c.env.DB, 'routines', { ...data, is_active: 1 }, c.get('realUser').id);
    flash(c, `Routine ${data.plan_number} created. Visits are generated by the daily job - or trigger it from Settings.`);
  } catch (err) {
    flash(c, err instanceof Error ? (err.message.includes('UNIQUE') ? 'That plan number already exists.' : err.message) : 'Failed to create routine.', 'err');
  }
  return c.redirect('/routines');
});

routes.post('/import', manage, async (c) => {
  const form = await c.req.formData();
  const file = form.get('file') as File | string | null;
  if (!(file instanceof File)) {
    flash(c, 'Choose a CSV file.', 'err');
    return c.redirect('/routines');
  }
  const { headers, records } = csvObjects(parseCsv(await file.text()));
  const missing = CSV_HEADERS.filter((h) => !['is_active', 'requires_technical_review'].includes(h) && !headers.includes(h));
  if (missing.length) {
    flash(c, `CSV is missing columns: ${missing.join(', ')}`, 'err');
    return c.redirect('/routines');
  }
  const db = c.env.DB;
  const vendors = await all<Vendor>(db, 'SELECT * FROM vendors');
  let ok = 0;
  const errors: string[] = [];
  for (const [i, rec] of records.entries()) {
    const rowNo = i + 2;
    try {
      const vendor = vendors.find((v) => v.name.toLowerCase() === rec.vendor_name?.toLowerCase());
      if (!vendor) throw new Error(`unknown vendor "${rec.vendor_name}"`);
      const people = await Promise.all(
        (['vendor_coordinator_email', 'maintenance_engineer_email', 'technical_engineer_email'] as const)
          .map(async (k) => {
            const u = await findUserByEmail(db, rec[k] ?? '');
            if (!u) throw new Error(`unknown user "${rec[k]}"`);
            return u;
          })
      );
      const interval = parseInt(rec.interval_months ?? '', 10);
      const horizon = parseInt(rec.call_horizon_months ?? '', 10);
      if (!rec.plan_number || !rec.description) throw new Error('plan_number and description are required');
      if (!Number.isInteger(interval) || interval < 1) throw new Error('interval_months must be a positive whole number');
      if (!Number.isInteger(horizon) || horizon < 0) throw new Error('call_horizon_months must be 0 or more');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.start_date ?? '')) throw new Error('start_date must be YYYY-MM-DD');
      await insertRow(db, 'routines', {
        plan_number: rec.plan_number, description: rec.description, vendor_id: vendor.id,
        interval_months: interval, start_date: rec.start_date, call_horizon_months: horizon,
        vendor_coordinator_id: people[0]!.id, maintenance_engineer_id: people[1]!.id, technical_engineer_id: people[2]!.id,
        is_active: rec.is_active === '' || rec.is_active === undefined ? 1 : ['true', '1', 'yes'].includes(rec.is_active.toLowerCase()) ? 1 : 0,
        requires_technical_review: rec.requires_technical_review === '' || rec.requires_technical_review === undefined ? 1
          : ['true', '1', 'yes'].includes(rec.requires_technical_review.toLowerCase()) ? 1 : 0,
      }, c.get('realUser').id);
      ok++;
    } catch (err) {
      errors.push(`Row ${rowNo}: ${err instanceof Error ? (err.message.includes('UNIQUE') ? 'duplicate plan_number' : err.message) : 'failed'}`);
    }
  }
  const summary = `Imported ${ok} of ${records.length} routine(s).` +
    (errors.length ? ` Failures - ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}` : '');
  flash(c, summary, errors.length ? 'err' : 'ok');
  return c.redirect('/routines');
});

routes.get('/import/template', manage, () =>
  csvResponse('routines-template.csv', [
    CSV_HEADERS,
    ['MP-001', 'Annual pump inspection', 'Acme Industrial', '12', '2026-01-15', '2', 'coordinator@example.com', 'maintenance@example.com', 'technical@example.com', 'true', 'true'],
  ]));

routes.post('/:id/toggle-active', manage, async (c) => {
  const routine = await first<Routine>(c.env.DB, 'SELECT * FROM routines WHERE id = ?', c.req.param('id'));
  if (routine) {
    await updateRow(c.env.DB, 'routines', routine.id, { is_active: routine.is_active ? 0 : 1 }, c.get('realUser').id);
    flash(c, `Routine ${routine.plan_number} ${routine.is_active ? 'archived' : 'restored'}.`);
  }
  return c.redirect('/routines');
});

routes.post('/:id', manage, async (c) => {
  try {
    const form = await c.req.formData();
    const data = await routineFromForm(c, form);
    await updateRow(c.env.DB, 'routines', c.req.param('id')!, { ...data, is_active: form.has('is_active') ? 1 : 0 }, c.get('realUser').id);
    flash(c, `Routine ${data.plan_number} updated.`);
  } catch (err) {
    flash(c, err instanceof Error ? err.message : 'Failed to update routine.', 'err');
  }
  return c.redirect('/routines');
});

export default routes;
