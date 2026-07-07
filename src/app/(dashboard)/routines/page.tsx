import { addMonths, format } from 'date-fns';
import { requireAuth, hasRole } from '@/lib/auth';
import { asDate, todayISO } from '@/lib/labels';
import PageHeader from '@/components/ui/PageHeader';
import RoutinesView, { type RoutineRow } from './RoutinesView';
import type { MaintenanceRoutine, VisitStatus } from '@/types/database';

interface VisitStub {
  routine_id: string;
  scheduled_date: string;
  status: VisitStatus;
}

/**
 * Next due date for a routine: if its latest visit is completed, one interval
 * after it; if a visit is pending, that visit's date; otherwise the start date.
 */
function nextDueDate(routine: MaintenanceRoutine, visits: VisitStub[]): string {
  const latest = visits.find((v) => v.status === 'completed') ?? visits[0];
  if (latest?.status === 'completed') {
    return format(addMonths(asDate(latest.scheduled_date), routine.interval_months), 'yyyy-MM-dd');
  }
  if (latest) return latest.scheduled_date;
  return routine.start_date;
}

export default async function RoutinesPage() {
  const { supabase, profile } = await requireAuth();
  const canManage = hasRole(profile, ['admin', 'vendor_coordinator']);

  const [routinesRes, vendorsRes, usersRes, visitsRes] = await Promise.all([
    supabase
      .from('maintenance_routines')
      .select('*, vendor:vendors(name)')
      .order('plan_number'),
    supabase.from('vendors').select('id, name, is_active').order('name'),
    supabase.from('users').select('id, full_name, email, role, is_active').order('full_name'),
    supabase
      .from('maintenance_visits')
      .select('routine_id, scheduled_date, status')
      .order('scheduled_date', { ascending: false }),
  ]);

  const visitsByRoutine = new Map<string, VisitStub[]>();
  for (const visit of (visitsRes.data ?? []) as VisitStub[]) {
    visitsByRoutine.set(visit.routine_id, [...(visitsByRoutine.get(visit.routine_id) ?? []), visit]);
  }

  const today = todayISO();
  const routines: RoutineRow[] = ((routinesRes.data ?? []) as (MaintenanceRoutine & { vendor: { name: string } | null })[]).map(
    (routine) => {
      const due = nextDueDate(routine, visitsByRoutine.get(routine.id) ?? []);
      return {
        id: routine.id,
        plan_number: routine.plan_number,
        description: routine.description,
        vendor_id: routine.vendor_id,
        interval_months: routine.interval_months,
        start_date: routine.start_date,
        call_horizon_months: routine.call_horizon_months,
        vendor_coordinator_id: routine.vendor_coordinator_id,
        maintenance_engineer_id: routine.maintenance_engineer_id,
        technical_engineer_id: routine.technical_engineer_id,
        is_active: routine.is_active,
        requires_technical_review: routine.requires_technical_review ?? true,
        vendorName: routine.vendor?.name ?? '-',
        nextDue: due,
        nextDueOverdue: due < today,
      };
    },
  );

  const vendors = vendorsRes.data ?? [];
  const users = usersRes.data ?? [];

  // Sample values for the CSV template.
  const sampleVendor = vendors.find((v) => v.is_active)?.name ?? 'Vendor Name';
  const emailFor = (role: string, fallback: string) =>
    users.find((u) => u.role === role && u.is_active)?.email ?? fallback;

  const templateRows: (string | number)[][] = [
    [
      'plan_number',
      'description',
      'vendor_name',
      'interval_months',
      'start_date',
      'call_horizon_months',
      'vendor_coordinator_email',
      'maintenance_engineer_email',
      'technical_engineer_email',
      'is_active',
      'requires_technical_review',
    ],
    [
      'MP-001',
      'Annual maintenance for equipment XYZ',
      sampleVendor,
      12,
      todayISO(),
      1,
      emailFor('vendor_coordinator', 'coordinator@example.com'),
      emailFor('maintenance_engineer', 'engineer@example.com'),
      emailFor('technical_engineer', 'tech@example.com'),
      'true',
      'true',
    ],
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Maintenance Routines"
        description="Recurring maintenance plans that generate visits automatically"
      />
      <RoutinesView
        routines={routines}
        vendors={vendors}
        users={users}
        canManage={canManage}
        templateRows={templateRows}
      />
    </div>
  );
}
