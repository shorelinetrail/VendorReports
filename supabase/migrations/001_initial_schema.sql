-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create custom types
CREATE TYPE user_role AS ENUM ('admin', 'vendor_coordinator', 'maintenance_engineer', 'technical_engineer');
CREATE TYPE visit_status AS ENUM ('scheduled', 'date_confirmed', 'report_uploaded', 'recommendations_created', 'in_review', 'completed', 'cancelled');
CREATE TYPE task_type AS ENUM ('confirm_visit_date', 'upload_report', 'create_recommendations', 'review_recommendations', 'technical_review');
CREATE TYPE task_status AS ENUM ('pending', 'in_progress', 'completed', 'overdue', 'cancelled');
CREATE TYPE recommendation_status AS ENUM ('open', 'in_review', 'approved', 'completed', 'cancelled');

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'vendor_coordinator',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vendors table
CREATE TABLE vendors (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    contact_email TEXT,
    contact_phone TEXT,
    address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Maintenance Routines table
CREATE TABLE maintenance_routines (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plan_number TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    vendor_id UUID NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
    interval_months INTEGER NOT NULL CHECK (interval_months > 0),
    start_date DATE NOT NULL,
    call_horizon_months INTEGER NOT NULL DEFAULT 1 CHECK (call_horizon_months >= 0),
    vendor_coordinator_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    maintenance_engineer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    technical_engineer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Maintenance Visits table
CREATE TABLE maintenance_visits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    routine_id UUID NOT NULL REFERENCES maintenance_routines(id) ON DELETE RESTRICT,
    scheduled_date DATE NOT NULL,
    confirmed_date DATE,
    notification_number TEXT,
    status visit_status NOT NULL DEFAULT 'scheduled',
    vendor_coordinator_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    maintenance_engineer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    technical_engineer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    report_file_path TEXT,
    report_uploaded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tasks table
CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    visit_id UUID NOT NULL REFERENCES maintenance_visits(id) ON DELETE CASCADE,
    task_type task_type NOT NULL,
    assigned_to_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    status task_status NOT NULL DEFAULT 'pending',
    due_date DATE NOT NULL,
    completed_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Recommendations table
CREATE TABLE recommendations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    visit_id UUID NOT NULL REFERENCES maintenance_visits(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    sap_notification_number TEXT,
    due_date DATE,
    status recommendation_status NOT NULL DEFAULT 'open',
    created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    sent_for_review BOOLEAN DEFAULT FALSE,
    technical_review_response TEXT,
    reviewed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- System configuration table
CREATE TABLE system_config (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    config_key TEXT NOT NULL UNIQUE,
    config_value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default system configuration
INSERT INTO system_config (config_key, config_value, description) VALUES
    ('visit_confirmation_days', '14', 'Days before visit due date for vendor coordinator to confirm'),
    ('report_upload_weeks', '2', 'Weeks after visit date for report upload deadline'),
    ('recommendations_review_days', '7', 'Days for maintenance engineer to create recommendations'),
    ('technical_review_days', '7', 'Days for technical engineer to complete review');

-- Create indexes for better query performance
CREATE INDEX idx_maintenance_routines_vendor ON maintenance_routines(vendor_id);
CREATE INDEX idx_maintenance_routines_coordinator ON maintenance_routines(vendor_coordinator_id);
CREATE INDEX idx_maintenance_visits_routine ON maintenance_visits(routine_id);
CREATE INDEX idx_maintenance_visits_status ON maintenance_visits(status);
CREATE INDEX idx_maintenance_visits_scheduled_date ON maintenance_visits(scheduled_date);
CREATE INDEX idx_tasks_visit ON tasks(visit_id);
CREATE INDEX idx_tasks_assigned ON tasks(assigned_to_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_recommendations_visit ON recommendations(visit_id);
CREATE INDEX idx_recommendations_status ON recommendations(status);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_vendors_updated_at BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_maintenance_routines_updated_at BEFORE UPDATE ON maintenance_routines FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_maintenance_visits_updated_at BEFORE UPDATE ON maintenance_visits FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_recommendations_updated_at BEFORE UPDATE ON recommendations FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_system_config_updated_at BEFORE UPDATE ON system_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_routines ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_config ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view all users" ON users FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage users" ON users FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);
CREATE POLICY "Users can update own profile" ON users FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "Users can insert their own profile" ON users FOR INSERT TO authenticated WITH CHECK (id = auth.uid());

-- Vendors policies
CREATE POLICY "Authenticated users can view vendors" ON vendors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage vendors" ON vendors FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- Maintenance routines policies
CREATE POLICY "Authenticated users can view routines" ON maintenance_routines FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and coordinators can manage routines" ON maintenance_routines FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'vendor_coordinator'))
);

-- Maintenance visits policies
CREATE POLICY "Authenticated users can view visits" ON maintenance_visits FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins and coordinators can manage visits" ON maintenance_visits FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'vendor_coordinator'))
);
CREATE POLICY "Assigned users can update visits" ON maintenance_visits FOR UPDATE TO authenticated USING (
    vendor_coordinator_id = auth.uid() OR maintenance_engineer_id = auth.uid() OR technical_engineer_id = auth.uid()
);

-- Tasks policies
CREATE POLICY "Authenticated users can view tasks" ON tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "Assigned users can manage their tasks" ON tasks FOR ALL TO authenticated USING (
    assigned_to_id = auth.uid() OR EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- Recommendations policies
CREATE POLICY "Authenticated users can view recommendations" ON recommendations FOR SELECT TO authenticated USING (true);
CREATE POLICY "Engineers can manage recommendations" ON recommendations FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role IN ('admin', 'maintenance_engineer', 'technical_engineer'))
);

-- System config policies
CREATE POLICY "Authenticated users can view config" ON system_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins can manage config" ON system_config FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);

-- Create storage bucket for reports
INSERT INTO storage.buckets (id, name, public) VALUES ('reports', 'reports', false);

-- Storage policies for reports bucket
CREATE POLICY "Authenticated users can upload reports" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'reports'
);

CREATE POLICY "Authenticated users can view reports" ON storage.objects FOR SELECT TO authenticated USING (
    bucket_id = 'reports'
);

CREATE POLICY "Admins can delete reports" ON storage.objects FOR DELETE TO authenticated USING (
    bucket_id = 'reports' AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
);
