import { format, parseISO } from 'date-fns';
import type {
  RecommendationStatus,
  ReviewDecisionType,
  TaskStatus,
  TaskType,
  UserRole,
  VisitStatus,
} from '@/types/database';

// One source of truth for every status label, badge color, and date format.

export type BadgeVariant =
  | 'default'
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'overdue'
  | 'cancelled'
  | 'success'
  | 'warning'
  | 'error'
  | 'info';

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  scheduled: 'Scheduled',
  date_confirmed: 'Date Confirmed',
  report_uploaded: 'Report Uploaded',
  recommendations_created: 'Recommendations Created',
  in_review: 'In Review',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const VISIT_STATUS_VARIANTS: Record<VisitStatus, BadgeVariant> = {
  scheduled: 'pending',
  date_confirmed: 'in_progress',
  report_uploaded: 'in_progress',
  recommendations_created: 'in_progress',
  in_review: 'in_progress',
  completed: 'completed',
  cancelled: 'cancelled',
};

export const REC_STATUS_LABELS: Record<RecommendationStatus, string> = {
  open: 'Open',
  in_review: 'In Review',
  approved: 'Approved',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const REC_STATUS_VARIANTS: Record<RecommendationStatus, BadgeVariant> = {
  open: 'pending',
  in_review: 'in_progress',
  approved: 'info',
  completed: 'completed',
  cancelled: 'cancelled',
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  confirm_visit_date: 'Confirm Visit Date',
  upload_report: 'Upload Report',
  create_recommendations: 'Create Recommendations',
  review_recommendations: 'Review Recommendations',
  technical_review: 'Technical Review',
  close_visit: 'Close Visit',
};

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

export const TASK_STATUS_VARIANTS: Record<TaskStatus, BadgeVariant> = {
  pending: 'pending',
  in_progress: 'in_progress',
  completed: 'completed',
  overdue: 'overdue',
  cancelled: 'cancelled',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  vendor_coordinator: 'Vendor Coordinator',
  maintenance_engineer: 'Maintenance Engineer',
  technical_engineer: 'Technical Engineer',
};

export const REVIEW_DECISION_LABELS: Record<ReviewDecisionType, string> = {
  no_action: 'No Further Action',
  request_sap: 'SAP Notification Requested',
  other_action: 'Action Required',
};

/** Parse ISO strings as local time (date-only strings would otherwise shift a day in UTC-negative zones). */
export function asDate(value: string | Date): Date {
  return typeof value === 'string' ? parseISO(value) : value;
}

export function formatDate(value: string | Date | null | undefined, fallback = '-'): string {
  return value ? format(asDate(value), 'MMM d, yyyy') : fallback;
}

export function formatDateLong(value: string | Date | null | undefined, fallback = '-'): string {
  return value ? format(asDate(value), 'MMMM d, yyyy') : fallback;
}

export function formatDateTime(value: string | Date | null | undefined, fallback = '-'): string {
  return value ? format(asDate(value), 'MMM d, yyyy, h:mm a') : fallback;
}

/** Today as a local yyyy-MM-dd string (comparable with DB date columns). */
export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

/**
 * Date-based overdue check: strictly past its due date (a task due today is
 * not overdue yet), matching the daily expiry cron's semantics.
 */
export function isOverdue(
  dueDate: string | null | undefined,
  status?: string | null,
): boolean {
  if (!dueDate) return false;
  if (status === 'completed' || status === 'cancelled') return false;
  return dueDate.slice(0, 10) < todayISO();
}
