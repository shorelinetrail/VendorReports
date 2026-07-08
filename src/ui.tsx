/** Shared page shell + UI primitives (server-rendered, no client framework). */
import type { Context } from 'hono';
import { raw } from 'hono/html';
import type { Child, FC } from 'hono/jsx';
import { activeUsers, takeFlash } from './auth';
import { all } from './db';
import { fmtDate } from './dates';
import { todayStr } from './dates';
import {
  isAdmin, ROLE_LABELS, TASK_TYPE_LABELS, VISIT_STATUS_LABELS, REC_STATUS_LABELS,
  type App, type RecommendationStatus, type TaskStatus, type TaskType, type User, type UserRole, type VisitStatus,
} from './types';

// ---- Icons (lucide-style inline SVG) ----

const ICON_PATHS: Record<string, string> = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  tasks: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  chart: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="9" y1="22" x2="9" y2="18"/><line x1="15" y1="22" x2="15" y2="18"/><line x1="8" y1="6" x2="10" y2="6"/><line x1="14" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="10" y2="10"/><line x1="14" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="10" y2="14"/><line x1="14" y1="14" x2="16" y2="14"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  history: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
  edit: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  play: '<polygon points="5 3 19 12 5 21 5 3"/>',
  rotate: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  archive: '<rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><line x1="10" y1="12" x2="14" y2="12"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  'user-x': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/>',
  'user-check': '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><polyline points="17 11 19 13 23 9"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  tick: '<polyline points="20 6 9 17 4 12"/>',
};

/** Icon-only row-action button that opens a modal; the label shows as a tooltip. */
export const IconModalBtn: FC<{ modal: string; icon: string; label: string; class?: string }> = (props) => (
  <button type="button" class={`btn btn--sm btn--icon ${props.class ?? ''}`} data-modal={props.modal} title={props.label} aria-label={props.label}>
    <Icon name={props.icon} size={15} />
  </button>
);

export const Icon: FC<{ name: string; size?: number }> = ({ name, size = 18 }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
  >{raw(ICON_PATHS[name] ?? '')}</svg>
);

// ---- Navigation ----

const NAV: { href: string; label: string; icon: string; roles?: UserRole[] }[] = [
  { href: '/', label: 'Dashboard', icon: 'dashboard' },
  { href: '/tasks', label: 'My Tasks', icon: 'tasks' },
  { href: '/visits', label: 'Visits', icon: 'clipboard' },
  { href: '/routines', label: 'Routines', icon: 'calendar' },
  { href: '/recommendations', label: 'Recommendations', icon: 'file', roles: ['admin', 'maintenance_engineer', 'technical_engineer'] },
  { href: '/reports', label: 'Reports', icon: 'download' },
  { href: '/analytics', label: 'Analytics', icon: 'chart' },
  { href: '/vendors', label: 'Vendors', icon: 'building', roles: ['admin'] },
  { href: '/users', label: 'Users', icon: 'users', roles: ['admin'] },
  { href: '/audit', label: 'Audit Log', icon: 'history', roles: ['admin'] },
  { href: '/settings', label: 'Settings', icon: 'settings', roles: ['admin'] },
];

// ---- Badges ----

type Tone = 'gray' | 'blue' | 'amber' | 'green' | 'red' | 'purple';

export const Badge: FC<{ tone: Tone; children?: Child }> = ({ tone, children }) => (
  <span class={`badge badge--${tone}`}>{children}</span>
);

const VISIT_TONES: Record<VisitStatus, Tone> = {
  scheduled: 'amber', date_confirmed: 'blue', report_uploaded: 'blue',
  recommendations_created: 'purple', in_review: 'purple', completed: 'green', cancelled: 'gray',
};

export const visitBadge = (status: VisitStatus) => <Badge tone={VISIT_TONES[status]}>{VISIT_STATUS_LABELS[status]}</Badge>;

const REC_TONES: Record<RecommendationStatus, Tone> = {
  open: 'amber', in_review: 'blue', approved: 'green', completed: 'green', cancelled: 'gray',
};

export const recBadge = (status: RecommendationStatus) => <Badge tone={REC_TONES[status]}>{REC_STATUS_LABELS[status]}</Badge>;

/** Task badge with due-date awareness: overdue/due-today/due-soon override pending. */
export function taskBadge(status: TaskStatus, dueDate: string) {
  if (status === 'completed') return <Badge tone="green">Completed</Badge>;
  if (status === 'cancelled') return <Badge tone="gray">Cancelled</Badge>;
  const today = todayStr();
  if (status === 'overdue' || dueDate < today) return <Badge tone="red">Overdue</Badge>;
  if (dueDate === today) return <Badge tone="amber">Due Today</Badge>;
  return <Badge tone="gray">Pending</Badge>;
}

export const isTaskOverdue = (status: TaskStatus, dueDate: string) =>
  status === 'overdue' || (dueDate < todayStr() && status !== 'completed' && status !== 'cancelled');

// ---- Building blocks ----

export const PageHeader: FC<{ title: Child; sub?: string; children?: Child }> = ({ title, sub, children }) => (
  <div class="page-head">
    <div>
      <h1>{title}</h1>
      {sub && <p class="muted">{sub}</p>}
    </div>
    {children && <div class="page-head__actions">{children}</div>}
  </div>
);

export const Card: FC<{ title?: Child; children?: Child; actions?: Child; pad?: boolean }> = ({ title, children, actions, pad = true }) => (
  <section class="card">
    {(title || actions) && (
      <header class="card__head">
        <h2>{title}</h2>
        {actions && <div>{actions}</div>}
      </header>
    )}
    <div class={pad ? 'card__body' : ''}>{children}</div>
  </section>
);

export const StatCard: FC<{ label: string; value: Child; href: string; icon: string; tone: Tone }> = ({ label, value, href, icon, tone }) => (
  <a class={`stat stat--${tone}`} href={href}>
    <span class="stat__icon"><Icon name={icon} size={20} /></span>
    <span class="stat__value">{value}</span>
    <span class="stat__label">{label}</span>
  </a>
);

export const EmptyState: FC<{ title: string; hint?: string; children?: Child }> = ({ title, hint, children }) => (
  <div class="empty">
    <p class="empty__title">{title}</p>
    {hint && <p class="muted">{hint}</p>}
    {children}
  </div>
);

/** <dialog> modal; open it with any element carrying data-modal="<id>", or on page load via autoOpen. */
export const Modal: FC<{ id: string; title: string; children?: Child; autoOpen?: boolean }> = ({ id, title, children, autoOpen }) => (
  <dialog id={id} class="modal" aria-label={title} {...(autoOpen ? { 'data-open-on-load': '' } : {})}>
    <header class="modal__head">
      <h2>{title}</h2>
      <button type="button" class="btn btn--ghost" data-close aria-label="Close">✕</button>
    </header>
    {children}
  </dialog>
);

export const ModalButtons: FC<{ submit: string; busy?: string; danger?: boolean }> = ({ submit, busy, danger }) => (
  <div class="modal__buttons">
    <button type="button" class="btn" data-close>Cancel</button>
    <button type="submit" class={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} data-busy={busy ?? 'Saving…'}>{submit}</button>
  </div>
);

export const Field: FC<{ label: string; hint?: string; children?: Child }> = ({ label, hint, children }) => (
  <label class="field">
    <span class="field__label">{label}</span>
    {children}
    {hint && <span class="field__hint">{hint}</span>}
  </label>
);

/** One-click POST button (optionally with a confirm prompt), rendered as an inline form. */
export const ActionButton: FC<{
  action: string; label: Child; confirm?: string; class?: string; busy?: string; hidden?: Record<string, string>; title?: string;
}> = (props) => (
  <form method="post" action={props.action} class="inline" data-confirm={props.confirm}>
    {props.hidden && Object.entries(props.hidden).map(([k, v]) => <input type="hidden" name={k} value={v} />)}
    <button type="submit" class={props.class ?? 'btn btn--sm'} data-busy={props.busy ?? 'Working…'} title={props.title} aria-label={props.title}>
      {props.label}
    </button>
  </form>
);

/** Icon-only POST action for table rows; the label shows as a tooltip. */
export const IconAction: FC<{ action: string; icon: string; label: string; confirm?: string; class?: string }> = (props) => (
  <ActionButton
    action={props.action}
    label={<Icon name={props.icon} size={15} />}
    confirm={props.confirm}
    class={`btn btn--sm btn--icon ${props.class ?? ''}`}
    busy="…"
    title={props.label}
  />
);

// ---- Page shell ----

interface Notification { label: string; detail: string; due: string | null; overdue: boolean; href: string }

async function getNotifications(c: Context<App>): Promise<Notification[]> {
  const user = c.get('user');
  const items: Notification[] = [];
  const tasks = await all<{ id: string; task_type: TaskType; due_date: string; status: TaskStatus; visit_id: string; plan_number: string }>(
    c.env.DB,
    `SELECT t.id, t.task_type, t.due_date, t.status, t.visit_id, COALESCE(r.plan_number, 'Ad-hoc ' || v.notification_number, 'Ad-hoc') AS plan_number
     FROM tasks t JOIN visits v ON v.id = t.visit_id LEFT JOIN routines r ON r.id = v.routine_id
     WHERE t.assigned_to_id = ? AND t.status IN ('pending', 'overdue')
     ORDER BY t.due_date LIMIT 5`,
    user.id
  );
  for (const t of tasks) {
    items.push({
      label: TASK_TYPE_LABELS[t.task_type], detail: t.plan_number, due: t.due_date,
      overdue: isTaskOverdue(t.status, t.due_date), href: `/visits/${t.visit_id}`,
    });
  }
  if (isAdmin(user) || user.role === 'technical_engineer') {
    const recs = await all<{ id: string; description: string; visit_id: string; plan_number: string }>(
      c.env.DB,
      `SELECT rec.id, rec.description, rec.visit_id, COALESCE(r.plan_number, 'Ad-hoc ' || v.notification_number, 'Ad-hoc') AS plan_number
       FROM recommendations rec JOIN visits v ON v.id = rec.visit_id LEFT JOIN routines r ON r.id = v.routine_id
       WHERE rec.status = 'in_review' ORDER BY rec.created_at DESC LIMIT 3`
    );
    for (const r of recs) {
      items.push({
        label: 'Recommendation awaiting review', detail: `${r.plan_number}: ${r.description.slice(0, 60)}`,
        due: null, overdue: false, href: `/visits/${r.visit_id}`,
      });
    }
  }
  // Overdue recommendations chase whoever owes the follow-through: the action
  // assignee, the visit's maintenance engineer, and admins.
  const overdueRecs = await all<{ description: string; due_date: string; visit_id: string; plan_number: string }>(
    c.env.DB,
    `SELECT rec.description, rec.due_date, rec.visit_id, COALESCE(r.plan_number, 'Ad-hoc ' || v.notification_number, 'Ad-hoc') AS plan_number
     FROM recommendations rec JOIN visits v ON v.id = rec.visit_id LEFT JOIN routines r ON r.id = v.routine_id
     WHERE rec.due_date < ? AND rec.status IN ('open', 'in_review', 'approved')
       AND v.status NOT IN ('completed', 'cancelled')
       AND (? OR rec.action_assigned_to_id = ? OR v.maintenance_engineer_id = ?)
     ORDER BY rec.due_date LIMIT 3`,
    todayStr(), isAdmin(user) ? 1 : 0, user.id, user.id
  );
  for (const r of overdueRecs) {
    items.push({
      label: 'Recommendation overdue', detail: `${r.plan_number}: ${r.description.slice(0, 60)}`,
      due: r.due_date, overdue: true, href: `/visits/${r.visit_id}`,
    });
  }
  return items;
}

/** Renders a full page inside the app shell (sidebar + header + flash toast). */
export async function page(c: Context<App>, title: string, body: Child) {
  const user = c.get('user');
  const realUser = c.get('realUser');
  const isImpersonating = user.id !== realUser.id;
  const flash = takeFlash(c);
  const path = new URL(c.req.url).pathname;
  const impUsers = isAdmin(realUser) ? (await activeUsers(c.env.DB)).filter((u) => u.id !== realUser.id) : [];
  const notifications = await getNotifications(c);
  const overdueCount = notifications.filter((n) => n.overdue).length;

  const doc = (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · VendorTrak</title>
        <link rel="stylesheet" href="/app.css" />
        <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'><rect width='24' height='24' rx='5' fill='%232563eb'/><text x='12' y='17' font-size='13' fill='white' text-anchor='middle' font-family='sans-serif' font-weight='bold'>VT</text></svg>" />
      </head>
      <body>
        <input type="checkbox" id="nav-toggle" class="nav-toggle" aria-hidden="true" />
        <div class="shell">
          <aside class="sidebar">
            <div class="sidebar__brand">
              <span class="sidebar__logo">VT</span>
              <span>VendorTrak</span>
            </div>
            <nav class="sidebar__nav" aria-label="Main">
              {NAV.filter((n) => !n.roles || n.roles.includes(user.role) || (n.roles.includes('admin') && isAdmin(user))).map((n) => {
                const active = n.href === '/' ? path === '/' : path === n.href || path.startsWith(n.href + '/');
                return (
                  <a href={n.href} class={`nav-item ${active ? 'nav-item--active' : ''}`} aria-current={active ? 'page' : undefined}>
                    <Icon name={n.icon} /> {n.label}
                  </a>
                );
              })}
            </nav>
            <div class="sidebar__foot">
              <div class="sidebar__user">
                <strong>{user.full_name}</strong>
                <span>{ROLE_LABELS[user.role]}{user.role !== 'admin' && isAdmin(user) ? ' · Admin' : ''}</span>
              </div>
              <button type="button" class="nav-item nav-item--button" data-modal="change-password">
                <Icon name="key" /> Change password
              </button>
              <form method="post" action="/logout">
                <button type="submit" class="nav-item nav-item--button"><Icon name="logout" /> Sign out</button>
              </form>
            </div>
          </aside>

          <div class="main">
            {isAdmin(realUser) && (
              <div class={`imp-bar ${isImpersonating ? 'imp-bar--active' : ''}`}>
                {isImpersonating ? (
                  <>
                    <span>Viewing as <strong>{user.full_name}</strong> ({ROLE_LABELS[user.role]})</span>
                    <ActionButton action="/impersonate/stop" label="Stop impersonating" class="btn btn--sm" />
                  </>
                ) : (
                  <>
                    <span>Admin mode</span>
                    <form method="post" action="/impersonate" class="inline">
                      <select name="user_id" data-autosubmit aria-label="View the app as another user">
                        <option value="">View as user…</option>
                        {impUsers.map((u) => (
                          <option value={u.id}>{u.full_name} ({ROLE_LABELS[u.role]})</option>
                        ))}
                      </select>
                    </form>
                  </>
                )}
              </div>
            )}

            <header class="topbar">
              <label for="nav-toggle" class="topbar__menu" aria-label="Toggle navigation">☰</label>
              <h1 class="topbar__title">{title}</h1>
              {path !== '/visits' && (
                <form method="get" action="/visits" class="topbar__search">
                  <input name="q" type="search" placeholder="Search visits…" aria-label="Search visits" />
                </form>
              )}
              <details class="dropdown">
                <summary class="topbar__bell" aria-label={`Notifications (${notifications.length})`}>
                  <Icon name="bell" size={20} />
                  {notifications.length > 0 && (
                    <span class={`topbar__bell-count ${overdueCount > 0 ? 'topbar__bell-count--red' : ''}`}>{notifications.length}</span>
                  )}
                </summary>
                <div class="dropdown__panel">
                  <h3>Notifications</h3>
                  {notifications.length === 0 && <p class="muted">Nothing needs your attention.</p>}
                  {notifications.map((n) => (
                    <a href={n.href} class={`dropdown__item ${n.overdue ? 'dropdown__item--overdue' : ''}`}>
                      <strong>{n.label}</strong>
                      <span>{n.detail}</span>
                      {n.due && <span class={n.overdue ? 'text-red' : 'muted'}>{n.overdue ? 'Overdue: ' : 'Due: '}{fmtDate(n.due)}</span>}
                    </a>
                  ))}
                  <a href="/tasks" class="dropdown__all">View all tasks →</a>
                </div>
              </details>
              <span class="topbar__avatar" title={`${user.full_name} - ${ROLE_LABELS[user.role]}`}>
                {user.full_name.charAt(0).toUpperCase()}
              </span>
            </header>

            <main class="content">{body}</main>
          </div>
        </div>
        <label for="nav-toggle" class="nav-backdrop" aria-hidden="true"></label>
        <Modal id="change-password" title="Change Password">
          <form method="post" action="/account/password">
            <Field label="Current password">
              <input type="password" name="current_password" required autocomplete="current-password" />
            </Field>
            <Field label="New password" hint="At least 8 characters.">
              <input type="password" name="new_password" required minlength={8} autocomplete="new-password" />
            </Field>
            <ModalButtons submit="Change Password" />
          </form>
        </Modal>
        {flash && <div class={`toast toast--${flash.kind}`} role="status">{flash.message}</div>}
        <script src="/app.js" defer></script>
      </body>
    </html>
  );
  return c.html(`<!DOCTYPE html>${doc}`);
}

/** Minimal shell for unauthenticated pages (login / setup). */
export function authPage(c: Context, title: string, body: Child) {
  const doc = (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title} · VendorTrak</title>
        <link rel="stylesheet" href="/app.css" />
      </head>
      <body class="auth-body">
        <div class="auth-card">
          <div class="auth-brand"><span class="sidebar__logo">VT</span></div>
          <h1>{title}</h1>
          {body}
        </div>
        <script src="/app.js" defer></script>
      </body>
    </html>
  );
  return c.html(`<!DOCTYPE html>${doc}`);
}
