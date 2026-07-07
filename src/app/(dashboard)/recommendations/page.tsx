import { AlertTriangle, CheckCircle, Eye, FileText } from 'lucide-react';
import { requireAuth, hasRole } from '@/lib/auth';
import { isOverdue, REC_STATUS_LABELS } from '@/lib/labels';
import PageHeader from '@/components/ui/PageHeader';
import StatCard from '@/components/ui/StatCard';
import FilterSelect from '@/components/ui/FilterSelect';
import { Card, CardContent } from '@/components/ui/Card';
import RecommendationsTable, { type RecommendationListRow } from './RecommendationsTable';
import type { RecommendationStatus, User } from '@/types/database';

export default async function RecommendationsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { supabase, profile } = await requireAuth();
  const params = await searchParams;
  const statusFilter = params.status ?? 'open';

  const isAdmin = hasRole(profile, 'admin');
  const canReview = hasRole(profile, ['admin', 'technical_engineer']);

  const [recsRes, usersRes] = await Promise.all([
    supabase
      .from('recommendations')
      .select(
        `id, description, sap_notification_number, due_date, status, sent_for_review, review_decision, technical_review_response,
        visit:maintenance_visits(id, maintenance_engineer_id, technical_engineer_id, routine:maintenance_routines(plan_number, vendor:vendors(name))),
        created_by:users!recommendations_created_by_id_fkey(full_name)`,
      )
      .order('created_at', { ascending: false }),
    canReview
      ? supabase.from('users').select('id, full_name, role').eq('is_active', true).order('full_name')
      : Promise.resolve({ data: [] }),
  ]);

  const recommendations = (recsRes.data ?? []) as unknown as RecommendationListRow[];
  const users = (usersRes.data ?? []) as Pick<User, 'id' | 'full_name' | 'role'>[];

  const counts = {
    open: recommendations.filter((r) => r.status === 'open').length,
    inReview: recommendations.filter((r) => r.status === 'in_review').length,
    approved: recommendations.filter((r) => r.status === 'approved').length,
    overdue: recommendations.filter((r) => isOverdue(r.due_date, r.status)).length,
  };

  const filtered =
    statusFilter === 'all' ? recommendations : recommendations.filter((r) => r.status === statusFilter);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Recommendations"
        description="Action items raised from maintenance reports across all visits"
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Open" value={counts.open} icon={FileText} color="yellow" href="/recommendations?status=open" />
        <StatCard title="In Review" value={counts.inReview} icon={Eye} color="blue" href="/recommendations?status=in_review" />
        <StatCard title="Approved" value={counts.approved} icon={CheckCircle} color="green" href="/recommendations?status=approved" />
        <StatCard title="Overdue" value={counts.overdue} icon={AlertTriangle} color="red" />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <FilterSelect
            param="status"
            defaultValue="open"
            className="w-48"
            options={[
              { value: 'all', label: 'All Statuses' },
              ...(Object.keys(REC_STATUS_LABELS) as RecommendationStatus[]).map((status) => ({
                value: status,
                label: REC_STATUS_LABELS[status],
              })),
            ]}
          />
          <p className="text-sm text-gray-500">
            Showing {filtered.length} of {recommendations.length} recommendations
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <RecommendationsTable
            recommendations={filtered}
            users={users}
            profileId={profile.id}
            isAdmin={isAdmin}
          />
        </CardContent>
      </Card>
    </div>
  );
}
