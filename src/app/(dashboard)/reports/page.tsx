import { differenceInDays, eachMonthOfInterval, endOfMonth, format, isSameMonth, startOfMonth, subMonths } from 'date-fns';
import { BarChart3, Calendar, PieChart, TrendingUp } from 'lucide-react';
import { requireAuth } from '@/lib/auth';
import { asDate, todayISO, VISIT_STATUS_LABELS } from '@/lib/labels';
import PageHeader from '@/components/ui/PageHeader';
import StatCard from '@/components/ui/StatCard';
import FilterSelect from '@/components/ui/FilterSelect';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import EmptyState from '@/components/ui/EmptyState';
import TrendChart from '@/components/charts/TrendChart';
import BarList from '@/components/charts/BarList';
import GroupedBars from '@/components/charts/GroupedBars';
import ExportCsvButton from './ExportCsvButton';
import type { VisitStatus } from '@/types/database';

// Categorical palette (validated with the dataviz six-checks script).
const SERIES = [
  { label: 'Visits', color: '#2a78d6' },
  { label: 'Recommendations', color: '#eda100' },
  { label: 'Completed', color: '#1baf7a' },
];

interface VisitRow {
  id: string;
  status: VisitStatus;
  scheduled_date: string;
  routine: { vendor: { name: string } | null } | null;
}

interface RecRow {
  id: string;
  status: string;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
  visit: { routine: { vendor: { name: string } | null } | null } | null;
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { supabase } = await requireAuth();
  const params = await searchParams;
  const months = [3, 6, 12].includes(Number(params.range)) ? Number(params.range) : 6;

  const now = new Date();
  const startDate = startOfMonth(subMonths(now, months - 1));
  const endDate = endOfMonth(now);

  const [visitsRes, recsRes] = await Promise.all([
    supabase
      .from('maintenance_visits')
      .select('id, status, scheduled_date, routine:maintenance_routines(vendor:vendors(name))')
      .gte('scheduled_date', format(startDate, 'yyyy-MM-dd'))
      .lte('scheduled_date', format(endDate, 'yyyy-MM-dd')),
    supabase
      .from('recommendations')
      .select('id, status, due_date, created_at, completed_at, visit:maintenance_visits(routine:maintenance_routines(vendor:vendors(name)))')
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString()),
  ]);

  const visits = (visitsRes.data ?? []) as unknown as VisitRow[];
  const recs = (recsRes.data ?? []) as unknown as RecRow[];
  const today = todayISO();

  // Headline stats
  const completedVisits = visits.filter((v) => v.status === 'completed').length;
  const pendingVisits = visits.filter((v) => v.status !== 'completed' && v.status !== 'cancelled').length;
  const completedRecs = recs.filter((r) => r.status === 'completed').length;
  const openRecs = recs.filter((r) => r.status === 'open').length;
  const overdueRecs = recs.filter(
    (r) => r.due_date && r.due_date < today && r.status !== 'completed' && r.status !== 'cancelled',
  ).length;
  const completionDurations = recs
    .filter((r) => r.completed_at && r.created_at)
    .map((r) => differenceInDays(asDate(r.completed_at!), asDate(r.created_at)));
  const avgCompletionDays =
    completionDurations.length > 0
      ? Math.round(completionDurations.reduce((a, b) => a + b, 0) / completionDurations.length)
      : 0;

  // Monthly trend
  const monthly = eachMonthOfInterval({ start: startDate, end: endDate }).map((month) => ({
    label: format(month, 'MMM yyyy'),
    values: [
      visits.filter((v) => isSameMonth(asDate(v.scheduled_date), month)).length,
      recs.filter((r) => isSameMonth(asDate(r.created_at), month)).length,
      visits.filter((v) => v.status === 'completed' && isSameMonth(asDate(v.scheduled_date), month)).length,
    ],
  }));

  // Status distribution, in workflow order
  const statusItems = (Object.keys(VISIT_STATUS_LABELS) as VisitStatus[])
    .map((status) => ({
      label: VISIT_STATUS_LABELS[status],
      value: visits.filter((v) => v.status === status).length,
    }))
    .filter((item) => item.value > 0);

  // Per-vendor comparison (top 10 by visit count)
  const vendorMap = new Map<string, { visits: number; recommendations: number; completed: number }>();
  const bump = (name: string, key: 'visits' | 'recommendations' | 'completed') => {
    const entry = vendorMap.get(name) ?? { visits: 0, recommendations: 0, completed: 0 };
    entry[key]++;
    vendorMap.set(name, entry);
  };
  for (const visit of visits) {
    const name = visit.routine?.vendor?.name ?? 'Unknown';
    bump(name, 'visits');
    if (visit.status === 'completed') bump(name, 'completed');
  }
  for (const rec of recs) {
    bump(rec.visit?.routine?.vendor?.name ?? 'Unknown', 'recommendations');
  }
  const vendorStats = [...vendorMap.entries()]
    .map(([label, counts]) => ({ label, values: [counts.visits, counts.recommendations, counts.completed] }))
    .sort((a, b) => b.values[0] - a.values[0])
    .slice(0, 10);

  const csvRows: (string | number)[][] = [
    ['Metric', 'Value'],
    ['Total Visits', visits.length],
    ['Completed Visits', completedVisits],
    ['Pending Visits', pendingVisits],
    ['Total Recommendations', recs.length],
    ['Completed Recommendations', completedRecs],
    ['Open Recommendations', openRecs],
    ['Overdue Recommendations', overdueRecs],
    ['Average Completion Days', avgCompletionDays],
    [''],
    ['Vendor', 'Visits', 'Recommendations', 'Completed'],
    ...vendorStats.map((v) => [v.label, ...v.values]),
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="Maintenance statistics and performance trends">
        <FilterSelect
          param="range"
          defaultValue="6"
          className="w-40"
          options={[
            { value: '3', label: 'Last 3 Months' },
            { value: '6', label: 'Last 6 Months' },
            { value: '12', label: 'Last 12 Months' },
          ]}
        />
        <ExportCsvButton filename={`maintenance-report-${today}.csv`} rows={csvRows} />
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard title="Total Visits" value={visits.length} icon={Calendar} color="blue" />
        <StatCard
          title="Completion Rate"
          value={`${visits.length > 0 ? Math.round((completedVisits / visits.length) * 100) : 0}%`}
          icon={TrendingUp}
          color="green"
        />
        <StatCard title="Total Recommendations" value={recs.length} icon={PieChart} color="purple" />
        <StatCard title="Avg. Completion Days" value={avgCompletionDays} icon={BarChart3} color="orange" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 sm:gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly Trend</CardTitle>
          </CardHeader>
          <CardContent>
            {visits.length === 0 && recs.length === 0 ? (
              <EmptyState icon={TrendingUp} title="No data in this period" />
            ) : (
              <TrendChart data={monthly} series={SERIES} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Visit Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            {statusItems.length === 0 ? (
              <EmptyState icon={PieChart} title="No visits in this period" />
            ) : (
              <BarList items={statusItems} />
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Vendor Comparison (Top 10 by visits)</CardTitle>
          </CardHeader>
          <CardContent>
            {vendorStats.length === 0 ? (
              <EmptyState icon={BarChart3} title="No vendor activity in this period" />
            ) : (
              <GroupedBars groups={vendorStats} series={SERIES} />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-green-600">{completedVisits}</p>
          <p className="mt-1 text-sm text-gray-500">Completed Visits</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-yellow-600">{pendingVisits}</p>
          <p className="mt-1 text-sm text-gray-500">Pending Visits</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-blue-600">{openRecs}</p>
          <p className="mt-1 text-sm text-gray-500">Open Recommendations</p>
        </Card>
        <Card className="p-4 text-center">
          <p className="text-3xl font-bold text-red-600">{overdueRecs}</p>
          <p className="mt-1 text-sm text-gray-500">Overdue Recommendations</p>
        </Card>
      </div>
    </div>
  );
}
