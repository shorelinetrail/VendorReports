import type { Db } from './db';
import type { Bucket } from './storage';

export type UserRole = 'admin' | 'vendor_coordinator' | 'maintenance_engineer' | 'technical_engineer';

export type VisitStatus =
  | 'scheduled'
  | 'date_confirmed'
  | 'report_uploaded'
  | 'recommendations_created'
  | 'in_review'
  | 'completed'
  | 'cancelled';

export type TaskType =
  | 'confirm_visit_date'
  | 'upload_report'
  | 'create_recommendations'
  | 'review_recommendations'
  | 'technical_review'
  | 'close_visit';

export type TaskStatus = 'pending' | 'completed' | 'overdue' | 'cancelled';
export type RecommendationStatus = 'open' | 'in_review' | 'approved' | 'completed' | 'cancelled';
export type ReviewDecision = 'no_action' | 'request_sap' | 'other_action';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  /** Admin rights on top of the functional role (the 'admin' role implies it). */
  is_admin: number;
  password_hash: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

/** The one check for admin powers: the pure admin role, or an admin flag on any role. */
export const isAdmin = (u: Pick<User, 'role' | 'is_admin'>) => u.role === 'admin' || !!u.is_admin;

export interface Vendor {
  id: string;
  name: string;
  vendor_number: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Routine {
  id: string;
  plan_number: string;
  description: string;
  vendor_id: string;
  interval_months: number;
  start_date: string;
  call_horizon_months: number;
  vendor_coordinator_id: string;
  maintenance_engineer_id: string;
  technical_engineer_id: string;
  requires_technical_review: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Visit {
  id: string;
  /** Null for ad-hoc visits, which carry vendor/description/review flag directly. */
  routine_id: string | null;
  vendor_id: string | null;
  description: string | null;
  requires_technical_review: number | null;
  scheduled_date: string;
  /** Last day of a multi-day visit; null for single-day. */
  end_date: string | null;
  confirmed_date: string | null;
  confirmed_at: string | null;
  notification_number: string | null;
  status: VisitStatus;
  vendor_coordinator_id: string;
  maintenance_engineer_id: string;
  technical_engineer_id: string;
  no_report_reason: string | null;
  reschedule_reason: string | null;
  rescheduled_at: string | null;
  rescheduled_from: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  visit_id: string;
  task_type: TaskType;
  assigned_to_id: string;
  status: TaskStatus;
  due_date: string;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Recommendation {
  id: string;
  visit_id: string;
  description: string;
  sap_notification_number: string | null;
  due_date: string | null;
  status: RecommendationStatus;
  created_by_id: string;
  sent_for_review: number;
  technical_review_response: string | null;
  review_decision: ReviewDecision | null;
  review_action_description: string | null;
  action_assigned_to_id: string | null;
  action_response: string | null;
  action_responded_at: string | null;
  reviewed_by_id: string | null;
  reviewed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface VisitComment {
  id: string;
  visit_id: string;
  author_id: string;
  body: string;
  created_at: string;
}

export interface VisitReport {
  id: string;
  visit_id: string;
  file_key: string;
  file_name: string;
  file_size: number;
  content_type: string | null;
  uploaded_by_id: string;
  uploaded_at: string;
  notes: string | null;
  /** Set when this report supersedes an older one (which is kept). */
  replaces_id: string | null;
}

export type Env = {
  DB: Db;
  REPORTS: Bucket;
};

/** Hono context bindings + per-request auth variables. */
export type App = {
  Bindings: Env;
  Variables: {
    /** Effective user (the impersonated user while impersonating). */
    user: User;
    /** The actually logged-in user; authorization that must not be spoofed checks this. */
    realUser: User;
    sessionToken: string;
  };
};

export const ROLES: UserRole[] = ['admin', 'vendor_coordinator', 'maintenance_engineer', 'technical_engineer'];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Admin',
  vendor_coordinator: 'Vendor Coordinator',
  maintenance_engineer: 'Maintenance Engineer',
  technical_engineer: 'Technical Engineer',
};

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  scheduled: 'Scheduled',
  date_confirmed: 'Date Confirmed',
  report_uploaded: 'Report Uploaded',
  recommendations_created: 'Recommendations Created',
  in_review: 'In Review',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  confirm_visit_date: 'Confirm Visit Date',
  upload_report: 'Upload Report',
  create_recommendations: 'Create Recommendations',
  review_recommendations: 'Respond to Recommendation',
  technical_review: 'Technical Review',
  close_visit: 'Close Visit',
};

export const REC_STATUS_LABELS: Record<RecommendationStatus, string> = {
  open: 'Open',
  in_review: 'In Review',
  approved: 'Approved',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export const REVIEW_DECISION_LABELS: Record<ReviewDecision, string> = {
  no_action: 'No further action required',
  request_sap: 'SAP notification requested',
  other_action: 'Other action required',
};
