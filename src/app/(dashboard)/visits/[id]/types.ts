import type { Recommendation, Task, MaintenanceVisit, User } from '@/types/database';

// Shapes of the joined queries on the visit detail page, shared by its
// server page and client islands.

export interface VisitDetail
  extends Omit<MaintenanceVisit, 'routine' | 'vendor_coordinator' | 'maintenance_engineer' | 'technical_engineer'> {
  routine: {
    id: string;
    plan_number: string;
    description: string;
    requires_technical_review: boolean;
    vendor: { id: string; name: string } | null;
  } | null;
  vendor_coordinator: { id: string; full_name: string; email: string } | null;
  maintenance_engineer: { id: string; full_name: string; email: string } | null;
  technical_engineer: { id: string; full_name: string; email: string } | null;
}

export interface RecommendationDetail
  extends Omit<Recommendation, 'visit' | 'created_by' | 'reviewed_by' | 'action_assigned_to'> {
  created_by: { full_name: string } | null;
  reviewed_by: { full_name: string } | null;
  action_assigned_to: { id: string; full_name: string } | null;
}

export interface ReportDetail {
  id: string;
  file_path: string;
  file_name: string;
  uploaded_at: string;
  notes: string | null;
  uploaded_by: { full_name: string } | null;
}

export type TaskDetail = Task;

/** Permissions computed once on the server and passed to the client islands. */
export interface VisitPermissions {
  isAdmin: boolean;
  isMaintenanceEngineer: boolean;
  canConfirmDate: boolean;
  canUploadReport: boolean;
  canCreateRecommendation: boolean;
  canReview: boolean;
  canReschedule: boolean;
  canCloseVisit: boolean;
  canReopenVisit: boolean;
  canEditNotification: boolean;
  canReassign: boolean;
}

export type UserOption = Pick<User, 'id' | 'full_name' | 'role'>;
