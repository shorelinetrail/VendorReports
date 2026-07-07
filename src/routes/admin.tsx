/** Admin-only: /users, /vendors, /settings, /audit. Role check is on the REAL user. */
import { Hono } from 'hono';
import { all, first, insertRow, updateRow } from '../db';
import { fmtDate, fmtDateTime } from '../dates';
import { findUserByEmail, flash, hashPassword, requireRole } from '../auth';
import { parseCsv, csvObjects, csvResponse } from '../csv';
import { CONFIG_DEFAULTS, expireTasks, generateVisits, getConfig, setConfigValue, type ConfigKey } from '../workflow';
import { page, Card, PageHeader, EmptyState, Modal, ModalButtons, Field, ActionButton, Badge, Icon } from '../ui';
import { isAdmin, ROLES, ROLE_LABELS, type App, type User, type UserRole, type Vendor } from '../types';

const routes = new Hono<App>();
const admin = requireRole('admin');

const ROLE_TONES: Record<UserRole, 'red' | 'blue' | 'green' | 'amber'> = {
  admin: 'red', vendor_coordinator: 'blue', maintenance_engineer: 'green', technical_engineer: 'amber',
};

// ---------- Users ----------

routes.get('/users', admin, async (c) => {
  const me = c.get('realUser');
  const users = await all<User>(c.env.DB, 'SELECT * FROM users ORDER BY full_name');

  const roleOptions = (selected?: UserRole) =>
    ROLES.map((r) => <option value={r} selected={selected === r}>{ROLE_LABELS[r]}</option>);

  return page(c, 'Users', (
    <>
      <PageHeader title="Users" sub="Accounts are created here - there is no self-signup">
        <a class="btn" href="/users/import/template"><Icon name="download" size={16} /> CSV Template</a>
        <button class="btn" data-modal="import"><Icon name="upload" size={16} /> Bulk Import</button>
        <button class="btn btn--primary" data-modal="create"><Icon name="plus" size={16} /> Add User</button>
      </PageHeader>

      <Card pad={false}>
        <div class="tbl-wrap">
          <table class="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th class="actions">Actions</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr data-row-modal={`edit-${u.id}`}>
                  <td><strong>{u.full_name}</strong>{u.id === me.id && <span class="muted"> (you)</span>}</td>
                  <td>{u.email}</td>
                  <td>
                    <Badge tone={ROLE_TONES[u.role]}>{ROLE_LABELS[u.role]}</Badge>
                    {u.role !== 'admin' && !!u.is_admin && <>{' '}<Badge tone="red">Admin</Badge></>}
                  </td>
                  <td>{u.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}</td>
                  <td>{fmtDate(u.created_at)}</td>
                  <td class="actions">
                    <button class="btn btn--sm" data-modal={`edit-${u.id}`}>Edit</button>
                    <button class="btn btn--sm" data-modal={`password-${u.id}`}>Reset Password</button>
                    {u.id !== me.id && (
                      <ActionButton
                        action={`/users/${u.id}/toggle-active`}
                        label={u.is_active ? 'Deactivate' : 'Reactivate'}
                        class={`btn btn--sm ${u.is_active ? 'btn--danger' : 'btn--green'}`}
                        confirm={u.is_active ? `Deactivate ${u.full_name}? They can no longer sign in and won't appear in assignment lists.` : undefined}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal id="create" title="Add User">
        <form method="post" action="/users">
          <Field label="Full name"><input name="full_name" required placeholder="Jane Doe" /></Field>
          <Field label="Email"><input type="email" name="email" required placeholder="jane@example.com" /></Field>
          <Field label="Initial password" hint="At least 8 characters - share it with the user; they can't reset it themselves.">
            <input name="password" required minlength={8} />
          </Field>
          <Field label="Role"><select name="role" required>{roleOptions()}</select></Field>
          <label class="check">
            <input type="checkbox" name="is_admin" /> Also grant admin access (full admin view on top of their role)
          </label>
          <ModalButtons submit="Create User" />
        </form>
      </Modal>

      {users.map((u) => (
        <>
          <Modal id={`edit-${u.id}`} title={`Edit ${u.full_name}`}>
            <form method="post" action={`/users/${u.id}`}>
              <Field label="Full name"><input name="full_name" required value={u.full_name} /></Field>
              <Field label="Email" hint="Email can't be changed."><input value={u.email} disabled /></Field>
              <Field label="Role"><select name="role" required disabled={u.id === me.id}>{roleOptions(u.role)}</select></Field>
              <label class="check">
                <input type="checkbox" name="is_admin" checked={!!u.is_admin} disabled={u.id === me.id || u.role === 'admin'} />
                Also grant admin access
              </label>
              {u.id === me.id && <p class="muted">You can't change your own role or admin access.</p>}
              <ModalButtons submit="Save Changes" />
            </form>
          </Modal>
          <Modal id={`password-${u.id}`} title={`Reset password - ${u.full_name}`}>
            <form method="post" action={`/users/${u.id}/password`}>
              <Field label="New password" hint="At least 8 characters. Existing sessions stay signed in.">
                <input name="password" required minlength={8} />
              </Field>
              <ModalButtons submit="Set Password" />
            </form>
          </Modal>
        </>
      ))}

      <Modal id="import" title="Bulk Import Users">
        <form method="post" action="/users/import" enctype="multipart/form-data">
          <p class="muted">
            CSV with headers: <span class="mono">full_name, email, role, password</span>.
            Role is one of <span class="mono">{ROLES.join(', ')}</span>; passwords need 8+ characters.
          </p>
          <Field label="CSV file"><input type="file" name="file" accept=".csv" required /></Field>
          <ModalButtons submit="Import" busy="Importing…" />
        </form>
      </Modal>
    </>
  ));
});

routes.post('/users', admin, async (c) => {
  const form = await c.req.formData();
  const fullName = String(form.get('full_name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const role = String(form.get('role') ?? '') as UserRole;
  if (!fullName || !email.includes('@') || password.length < 8 || !ROLES.includes(role)) {
    flash(c, 'Fill in all fields; passwords need at least 8 characters.', 'err');
  } else if (await findUserByEmail(c.env.DB, email)) {
    flash(c, `A user with email ${email} already exists.`, 'err');
  } else {
    await insertRow(c.env.DB, 'users', {
      email, full_name: fullName, role, password_hash: await hashPassword(password), is_active: 1,
      is_admin: role !== 'admin' && form.has('is_admin') ? 1 : 0,
    }, c.get('realUser').id);
    flash(c, `User ${fullName} created.`);
  }
  return c.redirect('/users');
});

routes.get('/users/import/template', admin, () =>
  csvResponse('users-template.csv', [
    ['full_name', 'email', 'role', 'password'],
    ['Jane Doe', 'jane@example.com', 'vendor_coordinator', 'change-me-soon'],
  ]));

routes.post('/users/import', admin, async (c) => {
  const form = await c.req.formData();
  const file = form.get('file') as File | string | null;
  if (!(file instanceof File)) {
    flash(c, 'Choose a CSV file.', 'err');
    return c.redirect('/users');
  }
  const { headers, records } = csvObjects(parseCsv(await file.text()));
  const required = ['full_name', 'email', 'role', 'password'];
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length) {
    flash(c, `CSV is missing columns: ${missing.join(', ')}`, 'err');
    return c.redirect('/users');
  }
  let ok = 0;
  const errors: string[] = [];
  for (const [i, rec] of records.entries()) {
    try {
      if (!rec.full_name || !rec.email?.includes('@')) throw new Error('name/email invalid');
      if (!ROLES.includes(rec.role as UserRole)) throw new Error(`invalid role "${rec.role}"`);
      if ((rec.password ?? '').length < 8) throw new Error('password too short (8+ chars)');
      if (await findUserByEmail(c.env.DB, rec.email)) throw new Error('email already exists');
      await insertRow(c.env.DB, 'users', {
        email: rec.email, full_name: rec.full_name, role: rec.role,
        password_hash: await hashPassword(rec.password!), is_active: 1,
      }, c.get('realUser').id);
      ok++;
    } catch (err) {
      errors.push(`Row ${i + 2}: ${err instanceof Error ? err.message : 'failed'}`);
    }
  }
  flash(c, `Imported ${ok} of ${records.length} user(s).${errors.length ? ` Failures - ${errors.slice(0, 3).join('; ')}${errors.length > 3 ? ` (+${errors.length - 3} more)` : ''}` : ''}`,
    errors.length ? 'err' : 'ok');
  return c.redirect('/users');
});

routes.post('/users/:id/toggle-active', admin, async (c) => {
  const me = c.get('realUser');
  const user = await first<User>(c.env.DB, 'SELECT * FROM users WHERE id = ?', c.req.param('id'));
  if (!user || user.id === me.id) {
    flash(c, "You can't deactivate your own account.", 'err');
  } else {
    await updateRow(c.env.DB, 'users', user.id, { is_active: user.is_active ? 0 : 1 }, me.id);
    flash(c, `${user.full_name} ${user.is_active ? 'deactivated' : 'reactivated'}.`);
  }
  return c.redirect('/users');
});

routes.post('/users/:id/password', admin, async (c) => {
  const form = await c.req.formData();
  const password = String(form.get('password') ?? '');
  const user = await first<User>(c.env.DB, 'SELECT * FROM users WHERE id = ?', c.req.param('id'));
  if (!user || password.length < 8) {
    flash(c, 'Passwords need at least 8 characters.', 'err');
  } else {
    await updateRow(c.env.DB, 'users', user.id, { password_hash: await hashPassword(password) }, c.get('realUser').id);
    flash(c, `Password updated for ${user.full_name}.`);
  }
  return c.redirect('/users');
});

routes.post('/users/:id', admin, async (c) => {
  const me = c.get('realUser');
  const form = await c.req.formData();
  const fullName = String(form.get('full_name') ?? '').trim();
  const role = String(form.get('role') ?? '') as UserRole;
  const user = await first<User>(c.env.DB, 'SELECT * FROM users WHERE id = ?', c.req.param('id'));
  if (!user || !fullName) {
    flash(c, 'A name is required.', 'err');
  } else {
    const patch: Record<string, unknown> = { full_name: fullName };
    if (user.id !== me.id && ROLES.includes(role)) {
      patch.role = role;
      patch.is_admin = role !== 'admin' && form.has('is_admin') ? 1 : 0;
    }
    await updateRow(c.env.DB, 'users', user.id, patch, me.id);
    flash(c, `${fullName} updated.`);
  }
  return c.redirect('/users');
});

// ---------- Vendors ----------

function VendorForm({ action, vendor, submit }: { action: string; vendor?: Vendor; submit: string }) {
  return (
    <form method="post" action={action}>
      <Field label="Vendor name"><input name="name" required value={vendor?.name ?? ''} /></Field>
      <div class="form-grid">
        <Field label="Contact email (optional)"><input type="email" name="contact_email" value={vendor?.contact_email ?? ''} /></Field>
        <Field label="Contact phone (optional)"><input type="tel" name="contact_phone" value={vendor?.contact_phone ?? ''} /></Field>
      </div>
      <Field label="Address (optional)"><textarea name="address" rows={2}>{vendor?.address ?? ''}</textarea></Field>
      <ModalButtons submit={submit} />
    </form>
  );
}

routes.get('/vendors', admin, async (c) => {
  const vendors = await all<Vendor>(c.env.DB, 'SELECT * FROM vendors ORDER BY name');
  return page(c, 'Vendors', (
    <>
      <PageHeader title="Vendors" sub="Companies that perform the maintenance work">
        <button class="btn" data-modal="import"><Icon name="upload" size={16} /> Bulk Import</button>
        <button class="btn btn--primary" data-modal="create"><Icon name="plus" size={16} /> Add Vendor</button>
      </PageHeader>
      <Card pad={false}>
        {vendors.length === 0 ? (
          <EmptyState title="No vendors yet" hint="Add a vendor before creating routines." />
        ) : (
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Address</th><th>Status</th><th class="actions">Actions</th></tr></thead>
              <tbody>
                {vendors.map((v) => (
                  <tr data-row-modal={`edit-${v.id}`}>
                    <td><strong>{v.name}</strong></td>
                    <td>{v.contact_email ?? '-'}</td>
                    <td>{v.contact_phone ?? '-'}</td>
                    <td><div class="desc-clip">{v.address ?? '-'}</div></td>
                    <td>{v.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="gray">Inactive</Badge>}</td>
                    <td class="actions">
                      <button class="btn btn--sm" data-modal={`edit-${v.id}`}>Edit</button>
                      <ActionButton
                        action={`/vendors/${v.id}/toggle-active`}
                        label={v.is_active ? 'Archive' : 'Restore'}
                        class={`btn btn--sm ${v.is_active ? 'btn--danger' : 'btn--green'}`}
                        confirm={v.is_active ? `Archive ${v.name}? It stays on existing routines but is hidden from new ones.` : undefined}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal id="create" title="Add Vendor"><VendorForm action="/vendors" submit="Create Vendor" /></Modal>
      {vendors.map((v) => (
        <Modal id={`edit-${v.id}`} title={`Edit ${v.name}`}><VendorForm action={`/vendors/${v.id}`} vendor={v} submit="Save Changes" /></Modal>
      ))}
      <Modal id="import" title="Bulk Import Vendors">
        <form method="post" action="/vendors/import" enctype="multipart/form-data">
          <p class="muted">CSV with headers: <span class="mono">name, contact_email, contact_phone, address</span> (only name is required).</p>
          <Field label="CSV file"><input type="file" name="file" accept=".csv" required /></Field>
          <ModalButtons submit="Import" busy="Importing…" />
        </form>
      </Modal>
    </>
  ));
});

const vendorFields = (form: FormData) => ({
  name: String(form.get('name') ?? '').trim(),
  contact_email: String(form.get('contact_email') ?? '').trim() || null,
  contact_phone: String(form.get('contact_phone') ?? '').trim() || null,
  address: String(form.get('address') ?? '').trim() || null,
});

routes.post('/vendors', admin, async (c) => {
  const data = vendorFields(await c.req.formData());
  if (!data.name) flash(c, 'A vendor name is required.', 'err');
  else {
    await insertRow(c.env.DB, 'vendors', { ...data, is_active: 1 }, c.get('realUser').id);
    flash(c, `Vendor ${data.name} created.`);
  }
  return c.redirect('/vendors');
});

routes.post('/vendors/import', admin, async (c) => {
  const form = await c.req.formData();
  const file = form.get('file') as File | string | null;
  if (!(file instanceof File)) {
    flash(c, 'Choose a CSV file.', 'err');
    return c.redirect('/vendors');
  }
  const { headers, records } = csvObjects(parseCsv(await file.text()));
  if (!headers.includes('name')) {
    flash(c, 'CSV needs at least a "name" column.', 'err');
    return c.redirect('/vendors');
  }
  let ok = 0;
  const errors: string[] = [];
  for (const [i, rec] of records.entries()) {
    if (!rec.name) { errors.push(`Row ${i + 2}: missing name`); continue; }
    await insertRow(c.env.DB, 'vendors', {
      name: rec.name, contact_email: rec.contact_email || null,
      contact_phone: rec.contact_phone || null, address: rec.address || null, is_active: 1,
    }, c.get('realUser').id);
    ok++;
  }
  flash(c, `Imported ${ok} of ${records.length} vendor(s).${errors.length ? ` ${errors.slice(0, 3).join('; ')}` : ''}`, errors.length ? 'err' : 'ok');
  return c.redirect('/vendors');
});

routes.post('/vendors/:id/toggle-active', admin, async (c) => {
  const vendor = await first<Vendor>(c.env.DB, 'SELECT * FROM vendors WHERE id = ?', c.req.param('id'));
  if (vendor) {
    await updateRow(c.env.DB, 'vendors', vendor.id, { is_active: vendor.is_active ? 0 : 1 }, c.get('realUser').id);
    flash(c, `${vendor.name} ${vendor.is_active ? 'archived' : 'restored'}.`);
  }
  return c.redirect('/vendors');
});

routes.post('/vendors/:id', admin, async (c) => {
  const data = vendorFields(await c.req.formData());
  if (!data.name) flash(c, 'A vendor name is required.', 'err');
  else {
    await updateRow(c.env.DB, 'vendors', c.req.param('id')!, data, c.get('realUser').id);
    flash(c, `Vendor ${data.name} updated.`);
  }
  return c.redirect('/vendors');
});

// ---------- Settings ----------

const CONFIG_LABELS: Record<ConfigKey, { label: string; hint: string }> = {
  visit_confirmation_days: { label: 'Visit confirmation (days)', hint: 'Days before the visit for the coordinator to confirm the date.' },
  report_upload_weeks: { label: 'Report upload (weeks)', hint: 'Weeks after the visit date for the report deadline.' },
  recommendations_review_days: { label: 'Recommendations (days)', hint: 'Days for the maintenance engineer to create recommendations.' },
  technical_review_days: { label: 'Technical review (days)', hint: 'Days for the technical engineer to complete a review.' },
};

routes.get('/settings', admin, async (c) => {
  const cfg = await getConfig(c.env.DB);
  return page(c, 'Settings', (
    <>
      <PageHeader title="Settings" sub="Workflow deadlines and maintenance jobs" />

      <Card title="Task Deadlines">
        <form method="post" action="/settings">
          <div class="form-grid">
            {(Object.keys(CONFIG_LABELS) as ConfigKey[]).map((key) => (
              <Field label={CONFIG_LABELS[key].label} hint={CONFIG_LABELS[key].hint}>
                <input type="number" name={key} min={1} max={365} required value={cfg[key]} />
              </Field>
            ))}
          </div>
          <div class="btn-row">
            <button type="submit" class="btn btn--primary" data-busy="Saving…">Save Settings</button>
            <ActionButton action="/settings/reset" label="Reset to Defaults" class="btn"
              confirm={`Reset all deadlines to their defaults (${Object.values(CONFIG_DEFAULTS).join(', ')})?`} />
          </div>
        </form>
      </Card>

      <Card title="How the Workflow Runs">
        <ol style="margin:0; padding-left:1.25rem; display:grid; gap:0.4rem; font-size:0.9rem">
          <li><strong>Visit scheduled</strong> - the daily job creates visits from active routines, {'{'}call horizon{'}'} months ahead.</li>
          <li><strong>Date confirmation</strong> - the vendor coordinator confirms {cfg.visit_confirmation_days} days before the visit.</li>
          <li><strong>Report upload</strong> - the report is due {cfg.report_upload_weeks} weeks after the visit.</li>
          <li><strong>Recommendations</strong> - the maintenance engineer raises them within {cfg.recommendations_review_days} days.</li>
          <li><strong>Technical review</strong> - reviewed within {cfg.technical_review_days} days (when the routine requires it).</li>
          <li><strong>Completion</strong> - once every recommendation is resolved, the visit is closed.</li>
        </ol>
      </Card>

      <Card title="Maintenance Jobs">
        <p class="muted">
          Both jobs run automatically every day at 06:00 UTC (Cloudflare cron trigger). Run them now if you've just added routines
          or want overdue tasks flagged immediately.
        </p>
        <div class="btn-row mt">
          <ActionButton action="/settings/generate-visits" label="Generate Visits Now" class="btn btn--primary" busy="Generating…" />
          <ActionButton action="/settings/expire-tasks" label="Flag Overdue Tasks Now" class="btn" busy="Checking…" />
        </div>
      </Card>
    </>
  ));
});

routes.post('/settings', admin, async (c) => {
  const form = await c.req.formData();
  try {
    for (const key of Object.keys(CONFIG_LABELS) as ConfigKey[]) {
      await setConfigValue(c.env.DB, key, String(form.get(key) ?? ''), c.get('realUser').id);
    }
    flash(c, 'Settings saved.');
  } catch (err) {
    flash(c, err instanceof Error ? err.message : 'Invalid settings.', 'err');
  }
  return c.redirect('/settings');
});

routes.post('/settings/reset', admin, async (c) => {
  for (const [key, value] of Object.entries(CONFIG_DEFAULTS)) {
    await setConfigValue(c.env.DB, key as ConfigKey, String(value), c.get('realUser').id);
  }
  flash(c, 'Settings reset to defaults.');
  return c.redirect('/settings');
});

routes.post('/settings/generate-visits', admin, async (c) => {
  const result = await generateVisits(c.env.DB);
  const detail = result.created.slice(0, 5).join(', ') + (result.created.length > 5 ? ` (+${result.created.length - 5} more)` : '');
  flash(
    c,
    result.created.length === 0
      ? 'No new visits needed - everything within each routine\'s horizon already exists.'
      : `Created ${result.created.length} visit(s): ${detail}`,
    result.errors.length ? 'err' : 'ok'
  );
  return c.redirect('/settings');
});

routes.post('/settings/expire-tasks', admin, async (c) => {
  const n = await expireTasks(c.env.DB);
  flash(c, n === 0 ? 'No tasks are past their due date.' : `Marked ${n} task(s) overdue.`);
  return c.redirect('/settings');
});

// ---------- Audit log ----------

interface AuditRow {
  id: number; table_name: string; record_id: string | null; action: string;
  actor_name: string | null; old_data: string | null; new_data: string | null; created_at: string;
}

function changeSummary(row: AuditRow): string {
  try {
    if (row.action === 'INSERT') {
      const data = JSON.parse(row.new_data ?? '{}');
      return data.plan_number ?? data.full_name ?? data.name ?? data.file_name ?? data.description?.slice(0, 60) ?? data.status ?? '';
    }
    if (row.action === 'UPDATE' && row.old_data && row.new_data) {
      const oldData = JSON.parse(row.old_data);
      const newData = JSON.parse(row.new_data);
      const changed = Object.keys(newData)
        .filter((k) => k !== 'updated_at' && JSON.stringify(oldData[k]) !== JSON.stringify(newData[k]))
        .map((k) => `${k}: ${JSON.stringify(oldData[k])} → ${JSON.stringify(newData[k])}`);
      return changed.slice(0, 3).join('; ') + (changed.length > 3 ? ` (+${changed.length - 3} more)` : '');
    }
    if (row.action === 'DELETE') {
      const data = JSON.parse(row.old_data ?? '{}');
      return data.plan_number ?? data.full_name ?? data.name ?? data.file_name ?? '';
    }
  } catch { /* fall through */ }
  return '';
}

routes.get('/audit', admin, async (c) => {
  const table = c.req.query('table') ?? 'all';
  const before = parseInt(c.req.query('before') ?? '', 10);
  const where: string[] = [];
  const params: unknown[] = [];
  if (table !== 'all') { where.push('a.table_name = ?'); params.push(table); }
  if (Number.isInteger(before)) { where.push('a.id < ?'); params.push(before); }

  const rows = await all<AuditRow>(
    c.env.DB,
    `SELECT a.id, a.table_name, a.record_id, a.action, a.old_data, a.new_data, a.created_at, u.full_name AS actor_name
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY a.id DESC LIMIT 100`,
    ...params
  );
  const tables = ['all', 'visits', 'tasks', 'recommendations', 'routines', 'vendors', 'users', 'visit_reports', 'system_config'];
  const ACTION_TONES: Record<string, 'green' | 'blue' | 'red'> = { INSERT: 'green', UPDATE: 'blue', DELETE: 'red' };

  return page(c, 'Audit Log', (
    <>
      <PageHeader title="Audit Log" sub="Every change to core data, recorded automatically - append-only" />
      <Card pad={false}>
        <form class="filterbar" method="get" action="/audit">
          <select name="table" data-autosubmit aria-label="Filter by table">
            {tables.map((t) => <option value={t} selected={table === t}>{t === 'all' ? 'All tables' : t}</option>)}
          </select>
          <span class="muted">{rows.length === 100 ? 'Latest 100 entries' : `${rows.length} entries`}</span>
        </form>
        {rows.length === 0 ? (
          <EmptyState title="No audit entries" hint="Changes to visits, tasks, users and more are recorded here." />
        ) : (
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Table</th><th>Change</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr>
                    <td style="white-space:nowrap">{fmtDateTime(r.created_at)}</td>
                    <td>{r.actor_name ?? <span class="muted">system</span>}</td>
                    <td><Badge tone={ACTION_TONES[r.action] ?? 'gray'}>{r.action}</Badge></td>
                    <td class="mono">{r.table_name}</td>
                    <td><div class="desc-clip mono">{changeSummary(r)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rows.length === 100 && (
          <div class="filterbar" style="border-top:1px solid var(--border); border-bottom:0">
            <a class="btn btn--sm" href={`/audit?table=${table}&before=${rows[rows.length - 1]!.id}`}>Older entries →</a>
          </div>
        )}
      </Card>
    </>
  ));
});

export default routes;
