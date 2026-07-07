import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { requireAuth, hasRole } from '@/lib/auth';
import { formatDate, VISIT_STATUS_LABELS, VISIT_STATUS_VARIANTS } from '@/lib/labels';
import PageHeader from '@/components/ui/PageHeader';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import FilterSelect from '@/components/ui/FilterSelect';
import SearchInput from '@/components/ui/SearchInput';
import { Card, CardContent } from '@/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import CreateVisitButton from './CreateVisitButton';
import VisitRowActions from './VisitRowActions';
import type { VisitStatus } from '@/types/database';

interface VisitRow {
  id: string;
  scheduled_date: string;
  confirmed_date: string | null;
  notification_number: string | null;
  status: VisitStatus;
  vendor_coordinator_id: string;
  routine: { plan_number: string; vendor: { name: string } | null } | null;
}

export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; q?: string }>;
}) {
  const { supabase, profile } = await requireAuth();
  const params = await searchParams;
  const statusFilter = params.status ?? 'all';
  const search = (params.q ?? '').toLowerCase();

  const isAdmin = hasRole(profile, 'admin');
  const canManage = hasRole(profile, ['admin', 'vendor_coordinator']);

  const [visitsRes, routinesRes] = await Promise.all([
    supabase
      .from('maintenance_visits')
      .select(
        'id, scheduled_date, confirmed_date, notification_number, status, vendor_coordinator_id, routine:maintenance_routines(plan_number, vendor:vendors(name))',
      )
      .order('scheduled_date', { ascending: false }),
    canManage
      ? supabase
          .from('maintenance_routines')
          .select('id, plan_number, description')
          .eq('is_active', true)
          .order('plan_number')
      : Promise.resolve({ data: [] }),
  ]);

  const visits = (visitsRes.data ?? []) as unknown as VisitRow[];
  const filtered = visits.filter((v) => {
    if (statusFilter !== 'all' && v.status !== statusFilter) return false;
    if (search) {
      const haystack = `${v.routine?.plan_number ?? ''} ${v.routine?.vendor?.name ?? ''} ${v.notification_number ?? ''}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Maintenance Visits" description="Every visit generated from your routines, newest first">
        {canManage && <CreateVisitButton routines={routinesRes.data ?? []} />}
      </PageHeader>

      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <FilterSelect
              param="status"
              className="w-56"
              options={[
                { value: 'all', label: 'All Statuses' },
                ...(Object.keys(VISIT_STATUS_LABELS) as VisitStatus[]).map((status) => ({
                  value: status,
                  label: VISIT_STATUS_LABELS[status],
                })),
              ]}
            />
            <SearchInput placeholder="Search plan, vendor, notification…" />
          </div>
          <p className="text-sm text-gray-500">
            Showing {filtered.length} of {visits.length} visits
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="No visits found"
              description={
                visits.length === 0
                  ? 'Visits are generated automatically from active routines, or can be created manually.'
                  : 'No visits match the current filters.'
              }
            />
          ) : (
            <Table className="border-0">
              <TableHeader>
                <TableRow>
                  <TableHead>Plan Number</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Scheduled</TableHead>
                  <TableHead>Confirmed</TableHead>
                  <TableHead>Notification #</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((visit) => {
                  const isAssignedCoordinator = visit.vendor_coordinator_id === profile.id;
                  return (
                    <TableRow key={visit.id}>
                      <TableCell>
                        <Link href={`/visits/${visit.id}`} className="font-medium text-primary-600 hover:text-primary-700">
                          {visit.routine?.plan_number ?? '-'}
                        </Link>
                      </TableCell>
                      <TableCell>{visit.routine?.vendor?.name ?? '-'}</TableCell>
                      <TableCell>{formatDate(visit.scheduled_date)}</TableCell>
                      <TableCell>{formatDate(visit.confirmed_date)}</TableCell>
                      <TableCell>{visit.notification_number ?? '-'}</TableCell>
                      <TableCell>
                        <Badge variant={VISIT_STATUS_VARIANTS[visit.status]}>{VISIT_STATUS_LABELS[visit.status]}</Badge>
                      </TableCell>
                      <TableCell align="right">
                        <VisitRowActions
                          visitId={visit.id}
                          planNumber={visit.routine?.plan_number ?? ''}
                          scheduledDate={visit.scheduled_date}
                          canConfirm={visit.status === 'scheduled' && (isAssignedCoordinator || isAdmin)}
                          canUpload={visit.status === 'date_confirmed' && (isAssignedCoordinator || isAdmin)}
                          canDelete={isAdmin}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
