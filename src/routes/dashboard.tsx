import { Hono } from 'hono';
import { all, first } from '../db';
import { addDays, fmtDate, fmtMonth, monthStart, todayStr } from '../dates';
import { page, StatCard, Card, EmptyState, taskBadge, visitBadge, isTaskOverdue } from '../ui';
import { TASK_TYPE_LABELS, VISIT_STATUS_LABELS } from '../types';
import type { App, TaskStatus, TaskType, VisitStatus } from '../types';

interface CalVisit { id: string; scheduled_date: string; status: VisitStatus; plan_number: string; vendor_name: string; description: string }

/** 42 day-strings (Mon-start, 6 weeks) covering the given YYYY-MM month. */
function calendarDays(month: string): string[] {
  const [y = 2026, m = 1] = month.split('-').map(Number);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const start = Date.UTC(y, m - 1, 1 - lead);
  return Array.from({ length: 42 }, (_, i) => new Date(start + i * 86400_000).toISOString().slice(0, 10));
}

const shiftMonth = (month: string, by: number) => {
  const [y = 2026, m = 1] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + by;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
};

const routes = new Hono<App>();

routes.get('/', async (c) => {
  const db = c.env.DB;
  const user = c.get('user');
  const today = todayStr();
  const month = /^\d{4}-\d{2}$/.test(c.req.query('cal') ?? '') ? c.req.query('cal')! : today.slice(0, 7);
  const selected = c.req.query('date') ?? null;
  const days = calendarDays(month);

  const [counts, myTasks, upcoming, calVisits, selectedVisits] = await Promise.all([
    first<{ routines: number; visits: number; open_recs: number; completed_month: number }>(
      db,
      `SELECT
         (SELECT COUNT(*) FROM routines WHERE is_active = 1) AS routines,
         (SELECT COUNT(*) FROM visits WHERE status NOT IN ('completed', 'cancelled')) AS visits,
         (SELECT COUNT(*) FROM recommendations WHERE status = 'open') AS open_recs,
         (SELECT COUNT(*) FROM visits WHERE status = 'completed' AND completed_at >= ?) AS completed_month`,
      monthStart()
    ),
    all<{ id: string; task_type: TaskType; due_date: string; status: TaskStatus; visit_id: string; plan_number: string; vendor_name: string }>(
      db,
      `SELECT t.id, t.task_type, t.due_date, t.status, t.visit_id, r.plan_number, ve.name AS vendor_name
       FROM tasks t JOIN visits v ON v.id = t.visit_id JOIN routines r ON r.id = v.routine_id JOIN vendors ve ON ve.id = r.vendor_id
       WHERE t.assigned_to_id = ? AND t.status IN ('pending', 'in_progress', 'overdue')
       ORDER BY t.due_date`,
      user.id
    ),
    all<{ id: string; scheduled_date: string; status: VisitStatus; plan_number: string; vendor_name: string }>(
      db,
      `SELECT v.id, v.scheduled_date, v.status, r.plan_number, ve.name AS vendor_name
       FROM visits v JOIN routines r ON r.id = v.routine_id JOIN vendors ve ON ve.id = r.vendor_id
       WHERE v.scheduled_date BETWEEN ? AND ? AND v.status NOT IN ('completed', 'cancelled')
       ORDER BY v.scheduled_date LIMIT 5`,
      today, addDays(today, 30)
    ),
    all<CalVisit>(
      db,
      `SELECT v.id, v.scheduled_date, v.status, r.plan_number, r.description, ve.name AS vendor_name
       FROM visits v JOIN routines r ON r.id = v.routine_id JOIN vendors ve ON ve.id = r.vendor_id
       WHERE v.scheduled_date BETWEEN ? AND ? ORDER BY v.scheduled_date`,
      days[0]!, days[41]!
    ),
    selected
      ? all<CalVisit>(
          db,
          `SELECT v.id, v.scheduled_date, v.status, r.plan_number, r.description, ve.name AS vendor_name
           FROM visits v JOIN routines r ON r.id = v.routine_id JOIN vendors ve ON ve.id = r.vendor_id
           WHERE v.scheduled_date = ? ORDER BY r.plan_number`,
          selected
        )
      : Promise.resolve([] as CalVisit[]),
  ]);

  const overdueCount = myTasks.filter((t) => isTaskOverdue(t.status, t.due_date)).length;
  const byDay = new Map<string, CalVisit[]>();
  for (const v of calVisits) {
    const list = byDay.get(v.scheduled_date) ?? [];
    list.push(v);
    byDay.set(v.scheduled_date, list);
  }
  const keepCal = (date?: string) => `/?cal=${month}${date ? `&date=${date}` : ''}`;

  return page(c, 'Dashboard', (
    <>
      <div class="stats">
        <StatCard label="Active Routines" value={counts?.routines ?? 0} href="/routines" icon="calendar" tone="blue" />
        <StatCard label="Active Visits" value={counts?.visits ?? 0} href="/visits" icon="clipboard" tone="green" />
        <StatCard label="My Pending Tasks" value={myTasks.length} href="/tasks" icon="tasks" tone="amber" />
        <StatCard label="My Overdue Tasks" value={overdueCount} href="/tasks?status=overdue" icon="alert" tone="red" />
        <StatCard label="Open Recommendations" value={counts?.open_recs ?? 0} href="/recommendations" icon="file" tone="purple" />
        <StatCard label="Completed This Month" value={counts?.completed_month ?? 0} href="/visits?status=completed" icon="trend" tone="gray" />
      </div>

      <div class="grid-2">
        <Card
          title="Visit Calendar"
          actions={
            <div class="btn-row">
              <a class="btn btn--sm" href={`/?cal=${shiftMonth(month, -1)}`} aria-label="Previous month">←</a>
              <a class="btn btn--sm" href="/">Today</a>
              <a class="btn btn--sm" href={`/?cal=${shiftMonth(month, 1)}`} aria-label="Next month">→</a>
            </div>
          }
        >
          <div class="cal">
            <div class="cal__head"><strong>{fmtMonth(month)}</strong></div>
            <div class="cal__grid">
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div class="cal__dow">{d}</div>)}
              {days.map((day) => {
                const events = byDay.get(day) ?? [];
                const classes = [
                  'cal__day',
                  day.slice(0, 7) !== month ? 'cal__day--out' : '',
                  day === today ? 'cal__day--today' : '',
                  day === selected ? 'cal__day--selected' : '',
                ].join(' ');
                return (
                  <a href={keepCal(day)} class={classes}>
                    <span class="cal__num">{parseInt(day.slice(8), 10)}</span>
                    {events.slice(0, 3).map((v) => (
                      <span class={`cal__evt evt--${v.status}`} title={`${v.plan_number} — ${v.vendor_name} (${VISIT_STATUS_LABELS[v.status]})`}>
                        {v.plan_number}
                      </span>
                    ))}
                    {events.length > 3 && <span class="cal__more">+{events.length - 3} more</span>}
                  </a>
                );
              })}
            </div>
            <div class="cal__legend">
              <span style="--dot:#f59e0b">Scheduled</span>
              <span style="--dot:#3b82f6">Confirmed / Report</span>
              <span style="--dot:#7c3aed">In Review</span>
              <span style="--dot:#16a34a">Completed</span>
            </div>
          </div>
        </Card>

        <Card title={selected ? fmtDate(selected) : 'Selected Date'} actions={selected && <a class="btn btn--sm" href={keepCal()}>Clear</a>}>
          {!selected && <p class="muted">Click a date in the calendar to see its visits.</p>}
          {selected && selectedVisits.length === 0 && <p class="muted">No visits scheduled for this date.</p>}
          {selectedVisits.map((v) => (
            <a href={`/visits/${v.id}`} class="dropdown__item">
              <strong>{v.plan_number} — {v.vendor_name}</strong>
              <span>{v.description.slice(0, 90)}</span>
              {visitBadge(v.status)}
            </a>
          ))}
        </Card>
      </div>

      <div class="grid-2">
        <Card title="Upcoming Visits (next 30 days)" pad={false}>
          {upcoming.length === 0 ? (
            <EmptyState title="No upcoming visits scheduled" />
          ) : (
            <table class="tbl">
              <tbody>
                {upcoming.map((v) => (
                  <tr>
                    <td>
                      <a class="rowlink" href={`/visits/${v.id}`}>{v.plan_number}</a>
                      <div class="muted">{v.vendor_name}</div>
                    </td>
                    <td>{fmtDate(v.scheduled_date)}</td>
                    <td class="actions">{visitBadge(v.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="My Pending Tasks" actions={<a class="btn btn--sm" href="/tasks">All tasks</a>} pad={false}>
          {myTasks.length === 0 ? (
            <EmptyState title="No pending tasks" hint="You're all caught up." />
          ) : (
            <table class="tbl">
              <tbody>
                {myTasks.slice(0, 5).map((t) => (
                  <tr>
                    <td>
                      <a class="rowlink" href={`/visits/${t.visit_id}`}>{TASK_TYPE_LABELS[t.task_type]}</a>
                      <div class="muted">{t.plan_number} — {t.vendor_name}</div>
                    </td>
                    <td class={isTaskOverdue(t.status, t.due_date) ? 'text-red' : ''}>{fmtDate(t.due_date)}</td>
                    <td class="actions">{taskBadge(t.status, t.due_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  ));
});

export default routes;
