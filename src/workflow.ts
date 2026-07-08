import { all, first, run, insertRow, updateRow, now, type Db } from './db';
import { addDays, addMonths, todayStr } from './dates';
import {
  isAdmin as isAdminUser,
  type Recommendation, type Routine, type Task, type TaskType, type User, type Visit, type VisitStatus,
} from './types';

// ---- System configuration ----

export const CONFIG_DEFAULTS = {
  visit_confirmation_days: 14,
  report_upload_weeks: 2,
  recommendations_review_days: 7,
  technical_review_days: 7,
} as const;

export type ConfigKey = keyof typeof CONFIG_DEFAULTS;
export type Config = Record<ConfigKey, number>;

export async function getConfig(db: Db): Promise<Config> {
  const rows = await all<{ config_key: string; config_value: string }>(db, 'SELECT config_key, config_value FROM system_config');
  const cfg = { ...CONFIG_DEFAULTS } as Config;
  for (const row of rows) {
    if (row.config_key in cfg) {
      const n = parseInt(row.config_value, 10);
      if (Number.isFinite(n)) cfg[row.config_key as ConfigKey] = n;
    }
  }
  return cfg;
}

/** Validates (whole number 1–365, matching the old DB trigger) and saves one config value. */
export async function setConfigValue(db: Db, key: ConfigKey, value: string, actorId: string | null) {
  if (!/^\d+$/.test(value.trim()) || +value < 1 || +value > 365) {
    throw new Error(`"${key}" must be a whole number between 1 and 365`);
  }
  const old = await first<{ config_value: string }>(db, 'SELECT config_value FROM system_config WHERE config_key = ?', key);
  await run(
    db,
    `INSERT INTO system_config (config_key, config_value) VALUES (?, ?)
     ON CONFLICT (config_key) DO UPDATE SET config_value = excluded.config_value`,
    key, value.trim()
  );
  await run(
    db,
    'INSERT INTO audit_log (table_name, record_id, action, actor_id, old_data, new_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    'system_config', key, old ? 'UPDATE' : 'INSERT', actorId,
    old ? JSON.stringify(old) : null, JSON.stringify({ config_value: value.trim() }), now()
  );
}

// ---- Visit generation (daily cron + manual admin trigger) ----

/**
 * For every active routine, projects scheduled dates from start_date at
 * interval_months spacing out to today + call_horizon_months, creates any
 * missing visits (deduped on routine+date), and seeds the confirm-date task
 * when its due date is still in the future.
 */
export async function generateVisits(db: Db): Promise<{ created: string[]; errors: string[] }> {
  const routines = await all<Routine>(db, 'SELECT * FROM routines WHERE is_active = 1');
  const cfg = await getConfig(db);
  const today = todayStr();
  const created: string[] = [];
  const errors: string[] = [];

  for (const routine of routines) {
    const horizon = addMonths(today, routine.call_horizon_months ?? 2);
    let date = routine.start_date;
    while (date < today) date = addMonths(date, routine.interval_months);

    for (; date <= horizon; date = addMonths(date, routine.interval_months)) {
      const exists = await first(db, 'SELECT id FROM visits WHERE routine_id = ? AND scheduled_date = ?', routine.id, date);
      if (exists) continue;
      try {
        const visit = await insertRow<Visit>(db, 'visits', {
          routine_id: routine.id,
          scheduled_date: date,
          status: 'scheduled',
          vendor_coordinator_id: routine.vendor_coordinator_id,
          maintenance_engineer_id: routine.maintenance_engineer_id,
          technical_engineer_id: routine.technical_engineer_id,
        }, null);
        created.push(`${routine.plan_number} - ${date}`);

        // Confirm task for every new visit; a visit already inside the
        // confirmation window is due immediately rather than never tasked.
        const due = addDays(date, -cfg.visit_confirmation_days);
        await insertRow(db, 'tasks', {
          visit_id: visit.id,
          task_type: 'confirm_visit_date',
          assigned_to_id: routine.vendor_coordinator_id,
          status: 'pending',
          due_date: due > today ? due : today,
        }, null);
      } catch (err) {
        errors.push(`${routine.plan_number} (${date}): ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  return { created, errors };
}

/**
 * Self-heal: any open visit that is ready to close but has no close_visit task
 * gets one. Covers historical data and any transition path that missed seeding.
 */
export async function sweepCloseTasks(db: Db): Promise<void> {
  const candidates = await all<Visit>(
    db, `SELECT * FROM visits WHERE status IN ('report_uploaded', 'recommendations_created', 'in_review')`);
  for (const visit of candidates) await maybeCreateCloseTask(db, visit, null);
}

// ---- Task expiry (daily cron + manual admin trigger) ----

/** Flips past-due pending/in-progress tasks to 'overdue'. Returns how many changed. */
export async function expireTasks(db: Db): Promise<number> {
  const due = await all<{ id: string }>(
    db, "SELECT id FROM tasks WHERE due_date < ? AND status = 'pending'", todayStr());
  for (const t of due) await updateRow(db, 'tasks', t.id, { status: 'overdue' }, null);
  return due.length;
}

// ---- Task helpers used by visit transitions ----

export async function createTask(
  db: Db,
  visitId: string,
  type: TaskType,
  assignedToId: string,
  dueDate: string,
  actorId: string | null,
  notes?: string
): Promise<Task> {
  return insertRow<Task>(db, 'tasks', {
    visit_id: visitId, task_type: type, assigned_to_id: assignedToId,
    status: 'pending', due_date: dueDate, notes: notes ?? null,
  }, actorId);
}

const OPEN_TASK_STATUSES = "('pending', 'overdue')";

/** Creates a task unless one of the same type is already open on the visit. */
export async function createTaskOnce(
  db: Db,
  visitId: string,
  type: TaskType,
  assignedToId: string,
  dueDate: string,
  actorId: string | null,
  notes?: string
) {
  const open = await first(
    db, `SELECT id FROM tasks WHERE visit_id = ? AND task_type = ? AND status IN ${OPEN_TASK_STATUSES}`, visitId, type);
  if (!open) await createTask(db, visitId, type, assignedToId, dueDate, actorId, notes);
}

/** Marks open tasks of a type on a visit as completed (optionally only those assigned to one user). */
export async function completeOpenTasks(db: Db, visitId: string, type: TaskType, actorId: string | null, assignedToId?: string) {
  const rows = await all<{ id: string }>(
    db,
    `SELECT id FROM tasks WHERE visit_id = ? AND task_type = ? AND status IN ${OPEN_TASK_STATUSES}` +
      (assignedToId ? ' AND assigned_to_id = ?' : ''),
    ...(assignedToId ? [visitId, type, assignedToId] : [visitId, type])
  );
  for (const t of rows) await updateRow(db, 'tasks', t.id, { status: 'completed', completed_at: now() }, actorId);
}

export async function cancelOpenTasks(db: Db, visitId: string, type: TaskType, actorId: string | null) {
  const rows = await all<{ id: string }>(
    db, `SELECT id FROM tasks WHERE visit_id = ? AND task_type = ? AND status IN ${OPEN_TASK_STATUSES}`, visitId, type);
  for (const t of rows) await updateRow(db, 'tasks', t.id, { status: 'cancelled' }, actorId);
}

/** Statuses from which a visit can be wrapped up (report is in, or explicitly absent). */
export const POST_REPORT_STAGES: VisitStatus[] = ['report_uploaded', 'recommendations_created', 'in_review'];

/**
 * Seeds a close_visit task for the maintenance engineer (due in 3 days) once
 * the visit is genuinely ready: report stage passed, every recommendation
 * resolved (a visit with zero recommendations counts, provided the ME has no
 * open create-recommendations check outstanding).
 */
export async function maybeCreateCloseTask(db: Db, visit: Visit, actorId: string | null) {
  if (!POST_REPORT_STAGES.includes(visit.status)) return;
  const recs = await all<Recommendation>(db, 'SELECT * FROM recommendations WHERE visit_id = ?', visit.id);
  if (!recs.every((r) => r.status === 'completed' || r.status === 'cancelled')) return;
  const openCheck = await first(
    db, `SELECT id FROM tasks WHERE visit_id = ? AND task_type = 'create_recommendations' AND status IN ${OPEN_TASK_STATUSES}`, visit.id);
  if (openCheck) return;
  await createTaskOnce(db, visit.id, 'close_visit', visit.maintenance_engineer_id, addDays(todayStr(), 3), actorId);
}

// ---- Per-visit permissions (single source of truth for who can do what) ----

export interface VisitPerms {
  isAdmin: boolean;
  isCoordinator: boolean;
  isMaintEngineer: boolean;
  isTechEngineer: boolean;
  isOpen: boolean;
  hasReports: boolean;
  pendingRecsCheck: boolean;
  canConfirmDate: boolean;
  canUploadReport: boolean;
  canCreateRec: boolean;
  canReview: boolean;
  canReschedule: boolean;
  canCancel: boolean;
  canClose: boolean;
  canReopen: boolean;
  canReassign: boolean;
}

export function visitPerms(user: User, visit: Visit, reportCount: number, recs: Recommendation[], tasks: Task[] = []): VisitPerms {
  const isAdmin = isAdminUser(user);
  const isCoordinator = user.id === visit.vendor_coordinator_id;
  const isMaintEngineer = user.id === visit.maintenance_engineer_id;
  const isTechEngineer = user.id === visit.technical_engineer_id;
  const isOpen = visit.status !== 'completed' && visit.status !== 'cancelled';
  const hasReports = reportCount > 0 || !!visit.no_report_reason;
  // An open create-recommendations task means a report is awaiting the ME's
  // judgement (add recommendations or confirm none) - the visit isn't ready
  // to close until that's answered.
  const pendingRecsCheck = tasks.some((t) =>
    t.task_type === 'create_recommendations' && ['pending', 'overdue'].includes(t.status));

  return {
    isAdmin, isCoordinator, isMaintEngineer, isTechEngineer, isOpen, hasReports,
    canConfirmDate: (isCoordinator || isAdmin) && visit.status === 'scheduled',
    // Reports/attachments can be added at any point in the visit's life
    // (including after completion - a late report prompts a recommendations
    // check); only cancelled visits are closed to uploads.
    canUploadReport: (isCoordinator || isAdmin) && visit.status !== 'cancelled',
    canCreateRec: (isMaintEngineer || isAdmin) && hasReports && isOpen,
    canReview: isTechEngineer || isAdmin,
    canReschedule: (isCoordinator || isAdmin) && isOpen,
    canCancel: (isCoordinator || isAdmin) && isOpen,
    // Closeable once the report stage has passed, every recommendation is
    // resolved (zero recommendations qualifies - the pending-check gate ensures
    // the ME actively confirmed that), and no recommendations check is open.
    canClose: (isMaintEngineer || isAdmin) && POST_REPORT_STAGES.includes(visit.status) &&
      recs.every((r) => r.status === 'completed' || r.status === 'cancelled') && !pendingRecsCheck,
    pendingRecsCheck,
    // The assigned team (or an admin) may reopen completed AND cancelled
    // visits; it's audited, so who reopened is always on record.
    canReopen: (isCoordinator || isMaintEngineer || isTechEngineer || isAdmin) &&
      (visit.status === 'completed' || visit.status === 'cancelled'),
    canReassign: isAdmin && isOpen,
  };
}

/** Who the visit is waiting on, for the workflow banner. */
export function waitingFor(visit: Visit, team: { coordinator?: string; maintEngineer?: string; techEngineer?: string }): string | null {
  switch (visit.status) {
    case 'scheduled': return `${team.coordinator ?? 'Vendor coordinator'} to confirm the visit date`;
    case 'date_confirmed': return `${team.coordinator ?? 'Vendor coordinator'} to upload the maintenance report`;
    case 'report_uploaded': return `${team.maintEngineer ?? 'Maintenance engineer'} to create recommendations`;
    case 'recommendations_created': return `${team.maintEngineer ?? 'Maintenance engineer'} to complete and close the visit`;
    case 'in_review': return `${team.techEngineer ?? 'Technical engineer'} to review recommendations`;
    default: return null;
  }
}
