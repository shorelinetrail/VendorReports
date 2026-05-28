export type UserRole = 'admin' | 'vendor_coordinator' | 'maintenance_engineer' | 'technical_engineer';

export type VisitStatus = 'scheduled' | 'date_confirmed' | 'report_uploaded' | 'recommendations_created' | 'in_review' | 'completed' | 'cancelled';

export type TaskType =
  | 'confirm_visit_date'
  | 'upload_report'
  | 'create_recommendations'
  | 'review_recommendations'
  | 'technical_review'
  | 'close_visit';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';

export type RecommendationStatus = 'open' | 'in_review' | 'approved' | 'completed' | 'cancelled';

export type ReviewDecisionType = 'no_action' | 'request_sap' | 'other_action';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Vendor {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceRoutine {
  id: string;
  plan_number: string;
  description: string;
  vendor_id: string;
  vendor?: Vendor;
  interval_months: number;
  start_date: string;
  call_horizon_months: number;
  vendor_coordinator_id: string;
  vendor_coordinator?: User;
  maintenance_engineer_id: string;
  maintenance_engineer?: User;
  technical_engineer_id: string;
  technical_engineer?: User;
  is_active: boolean;
  requires_technical_review: boolean;
  created_at: string;
  updated_at: string;
}

export interface MaintenanceVisit {
  id: string;
  routine_id: string;
  routine?: MaintenanceRoutine;
  scheduled_date: string;
  confirmed_date: string | null;
  confirmed_at: string | null;
  notification_number: string | null;
  status: VisitStatus;
  vendor_coordinator_id: string;
  vendor_coordinator?: User;
  maintenance_engineer_id: string;
  maintenance_engineer?: User;
  technical_engineer_id: string;
  technical_engineer?: User;
  no_report_reason: string | null;
  recommendations_complete: boolean;
  no_recommendations_required: boolean;
  no_recommendations_at: string | null;
  no_recommendations_approved: boolean;
  no_recommendations_reviewed_by_id: string | null;
  no_recommendations_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  visit_id: string;
  visit?: MaintenanceVisit;
  task_type: TaskType;
  assigned_to_id: string;
  assigned_to?: User;
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
  visit?: MaintenanceVisit;
  description: string;
  sap_notification_number: string | null;
  due_date: string | null;
  status: RecommendationStatus;
  created_by_id: string;
  created_by?: User;
  sent_for_review: boolean;
  technical_review_response: string | null;
  review_decision: ReviewDecisionType | null;
  review_action_description: string | null;
  action_assigned_to_id: string | null;
  action_assigned_to?: User;
  reviewed_by_id: string | null;
  reviewed_by?: User;
  reviewed_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface SystemConfig {
  id: string;
  config_key: string;
  config_value: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface VisitReport {
  id: string;
  visit_id: string;
  visit?: MaintenanceVisit;
  file_path: string;
  file_name: string;
  uploaded_by_id: string;
  uploaded_by?: User;
  uploaded_at: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: number;
  table_name: string;
  record_id: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  actor_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
}

// Database response types
export interface Database {
  public: {
    Tables: {
      users: {
        Row: User;
        Insert: Omit<User, 'id' | 'created_at' | 'updated_at' | 'is_active'> & { is_active?: boolean };
        Update: Partial<Omit<User, 'id' | 'created_at' | 'updated_at'>>;
      };
      vendors: {
        Row: Vendor;
        Insert: Omit<Vendor, 'id' | 'created_at' | 'updated_at' | 'is_active'> & { is_active?: boolean };
        Update: Partial<Omit<Vendor, 'id' | 'created_at' | 'updated_at'>>;
      };
      maintenance_routines: {
        Row: MaintenanceRoutine;
        Insert: Omit<MaintenanceRoutine, 'id' | 'created_at' | 'updated_at' | 'vendor' | 'vendor_coordinator' | 'maintenance_engineer' | 'technical_engineer'>;
        Update: Partial<Omit<MaintenanceRoutine, 'id' | 'created_at' | 'updated_at' | 'vendor' | 'vendor_coordinator' | 'maintenance_engineer' | 'technical_engineer'>>;
      };
      maintenance_visits: {
        Row: MaintenanceVisit;
        Insert: Omit<MaintenanceVisit, 'id' | 'created_at' | 'updated_at' | 'routine' | 'vendor_coordinator' | 'maintenance_engineer' | 'technical_engineer'>;
        Update: Partial<Omit<MaintenanceVisit, 'id' | 'created_at' | 'updated_at' | 'routine' | 'vendor_coordinator' | 'maintenance_engineer' | 'technical_engineer'>>;
      };
      tasks: {
        Row: Task;
        Insert: Omit<Task, 'id' | 'created_at' | 'updated_at' | 'visit' | 'assigned_to'>;
        Update: Partial<Omit<Task, 'id' | 'created_at' | 'updated_at' | 'visit' | 'assigned_to'>>;
      };
      recommendations: {
        Row: Recommendation;
        Insert: Omit<Recommendation, 'id' | 'created_at' | 'updated_at' | 'visit' | 'created_by' | 'reviewed_by' | 'action_assigned_to'>;
        Update: Partial<Omit<Recommendation, 'id' | 'created_at' | 'updated_at' | 'visit' | 'created_by' | 'reviewed_by' | 'action_assigned_to'>>;
      };
      system_config: {
        Row: SystemConfig;
        Insert: Omit<SystemConfig, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<SystemConfig, 'id' | 'created_at' | 'updated_at'>>;
      };
      visit_reports: {
        Row: VisitReport;
        Insert: Omit<VisitReport, 'id' | 'created_at' | 'updated_at' | 'visit' | 'uploaded_by'>;
        Update: Partial<Omit<VisitReport, 'id' | 'created_at' | 'updated_at' | 'visit' | 'uploaded_by'>>;
      };
      audit_log: {
        Row: AuditLog;
        Insert: never;
        Update: never;
      };
    };
  };
}
