/** /reports - browse & download uploaded report files. /analytics - trends and stats. */
import { Hono } from 'hono';
import { all } from '../db';
import { fmtDate, fmtDateTime, fmtMonth, monthKey, monthStart, todayStr } from '../dates';
import { csvResponse } from '../csv';
import { page, Card, PageHeader, EmptyState, StatCard, visitBadge, Icon } from '../ui';
import { VISIT_STATUS_LABELS, type App, type VisitStatus } from '../types';

const routes = new Hono<App>();

// ---------- Report browser ----------

interface ReportRow {
  id: string; visit_id: string; file_name: string; uploaded_at: string; uploaded_by_name: string;
  plan_number: string; description: string; vendor_name: string; scheduled_date: string; status: VisitStatus;
}

const SORTS: Record<string, string> = {
  plan: 'r.plan_number', vendor: 've.name', visit: 'v.scheduled_date', uploaded: 'vr.uploaded_at',
};

routes.get('/reports', async (c) => {
  const db = c.env.DB;
  const q = (c.req.query('q') ?? '').trim();
  const vendor = c.req.query('vendor') ?? 'all';
  const status = c.req.query('status') ?? 'all';
  const sort = SORTS[c.req.query('sort') ?? ''] ? c.req.query('sort')! : 'uploaded';
  const dir = c.req.query('dir') === 'asc' ? 'ASC' : 'DESC';

  const where: string[] = [];
  const params: unknown[] = [];
  if (q) {
    where.push('(r.plan_number LIKE ? OR r.description LIKE ? OR ve.name LIKE ? OR vr.file_name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (vendor !== 'all') { where.push('ve.id = ?'); params.push(vendor); }
  if (status !== 'all') { where.push('v.status = ?'); params.push(status); }

  const [reports, vendors] = await Promise.all([
    all<ReportRow>(
      db,
      `SELECT vr.id, vr.visit_id, vr.file_name, vr.uploaded_at, u.full_name AS uploaded_by_name,
              r.plan_number, r.description, ve.name AS vendor_name, v.scheduled_date, v.status
       FROM visit_reports vr
       JOIN visits v ON v.id = vr.visit_id
       JOIN routines r ON r.id = v.routine_id
       JOIN vendors ve ON ve.id = r.vendor_id
       JOIN users u ON u.id = vr.uploaded_by_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY ${SORTS[sort]} ${dir}`,
      ...params
    ),
    all<{ id: string; name: string }>(
      db,
      `SELECT DISTINCT ve.id, ve.name FROM visit_reports vr
       JOIN visits v ON v.id = vr.visit_id JOIN routines r ON r.id = v.routine_id JOIN vendors ve ON ve.id = r.vendor_id
       ORDER BY ve.name`
    ),
  ]);

  const sortLink = (key: string, label: string) => {
    const nextDir = sort === key && dir === 'DESC' ? 'asc' : 'desc';
    const arrow = sort === key ? (dir === 'ASC' ? ' ↑' : ' ↓') : '';
    const params = new URLSearchParams({ q, vendor, status, sort: key, dir: nextDir });
    return <a href={`/reports?${params}`} style="color:inherit">{label}{arrow}</a>;
  };

  return page(c, 'Reports', (
    <>
      <PageHeader title="Maintenance Reports" sub="Browse and download every uploaded report" />
      <Card pad={false}>
        <form class="filterbar" method="get" action="/reports">
          <input name="q" value={q} placeholder="Search plan, vendor, file…" class="grow" aria-label="Search reports" />
          <select name="vendor" data-autosubmit aria-label="Filter by vendor">
            <option value="all">All vendors</option>
            {vendors.map((v) => <option value={v.id} selected={vendor === v.id}>{v.name}</option>)}
          </select>
          <select name="status" data-autosubmit aria-label="Filter by visit status">
            <option value="all">All statuses</option>
            {(['report_uploaded', 'recommendations_created', 'in_review', 'completed'] as VisitStatus[]).map((s) => (
              <option value={s} selected={status === s}>{VISIT_STATUS_LABELS[s]}</option>
            ))}
          </select>
          <button class="btn btn--sm" type="submit">Search</button>
          <span class="muted">{reports.length} report{reports.length === 1 ? '' : 's'}</span>
        </form>
        {reports.length === 0 ? (
          <EmptyState title="No reports found" hint="Reports uploaded on visits appear here." />
        ) : (
          <div class="tbl-wrap">
            <table class="tbl">
              <thead>
                <tr>
                  <th>{sortLink('plan', 'Plan')}</th><th>File</th><th>{sortLink('vendor', 'Vendor')}</th>
                  <th>{sortLink('visit', 'Visit Date')}</th><th>{sortLink('uploaded', 'Uploaded')}</th>
                  <th>By</th><th>Status</th><th class="actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr data-href={`/visits/${r.visit_id}`}>
                    <td><a class="rowlink" href={`/visits/${r.visit_id}`}>{r.plan_number}</a></td>
                    <td><div class="desc-clip">{r.file_name}</div></td>
                    <td>{r.vendor_name}</td>
                    <td>{fmtDate(r.scheduled_date)}</td>
                    <td>{fmtDateTime(r.uploaded_at)}</td>
                    <td>{r.uploaded_by_name}</td>
                    <td>{visitBadge(r.status)}</td>
                    <td class="actions">
                      <a class="btn btn--sm btn--icon" href={`/visits/${r.visit_id}/reports/${r.id}/view`} target="_blank" title="View in browser" aria-label="View report in browser"><Icon name="eye" size={15} /></a>
                      <a class="btn btn--sm btn--icon" href={`/visits/${r.visit_id}/reports/${r.id}/download`} title="Download report" aria-label="Download report"><Icon name="download" size={15} /></a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  ));
});

// ---------- Analytics ----------

interface AnalyticsData {
  months: number;
  visits: { status: VisitStatus; scheduled_date: string; vendor_name: string }[];
  recs: { status: string; due_date: string | null; created_at: string; completed_at: string | null; vendor_name: string }[];
}

async function loadAnalytics(db: D1Database, months: number): Promise<AnalyticsData> {
  const from = monthStart(-(months - 1));
  const [visits, recs] = await Promise.all([
    all<AnalyticsData['visits'][number]>(
      db,
      `SELECT v.status, v.scheduled_date, ve.name AS vendor_name
       FROM visits v JOIN routines r ON r.id = v.routine_id JOIN vendors ve ON ve.id = r.vendor_id
       WHERE v.scheduled_date >= ?`,
      from
    ),
    all<AnalyticsData['recs'][number]>(
      db,
      `SELECT rec.status, rec.due_date, rec.created_at, rec.completed_at, ve.name AS vendor_name
       FROM recommendations rec JOIN visits v ON v.id = rec.visit_id
       JOIN routines r ON r.id = v.routine_id JOIN vendors ve ON ve.id = r.vendor_id
       WHERE rec.created_at >= ?`,
      from
    ),
  ]);
  return { months, visits, recs };
}

function summarize(data: AnalyticsData) {
  const { visits, recs } = data;
  const today = todayStr();
  const completedVisits = visits.filter((v) => v.status === 'completed').length;
  const completedRecs = recs.filter((r) => r.status === 'completed');
  const durations = completedRecs
    .filter((r) => r.completed_at)
    .map((r) => (new Date(r.completed_at!).getTime() - new Date(r.created_at).getTime()) / 86400_000);
  return {
    totalVisits: visits.length,
    completedVisits,
    pendingVisits: visits.filter((v) => !['completed', 'cancelled'].includes(v.status)).length,
    completionRate: visits.length ? Math.round((completedVisits / visits.length) * 100) : 0,
    totalRecs: recs.length,
    openRecs: recs.filter((r) => r.status === 'open').length,
    overdueRecs: recs.filter((r) => r.due_date && r.due_date < today && !['completed', 'cancelled'].includes(r.status)).length,
    avgCompletionDays: durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : 0,
  };
}

function vendorStats(data: AnalyticsData) {
  const map = new Map<string, { visits: number; completed: number; recs: number }>();
  const get = (name: string) => {
    if (!map.has(name)) map.set(name, { visits: 0, completed: 0, recs: 0 });
    return map.get(name)!;
  };
  for (const v of data.visits) {
    const s = get(v.vendor_name);
    s.visits++;
    if (v.status === 'completed') s.completed++;
  }
  for (const r of data.recs) get(r.vendor_name).recs++;
  return [...map.entries()].sort((a, b) => b[1].visits - a[1].visits);
}

routes.get('/analytics', async (c) => {
  const months = [3, 6, 12].includes(parseInt(c.req.query('months') ?? '', 10)) ? parseInt(c.req.query('months')!, 10) : 6;
  const data = await loadAnalytics(c.env.DB, months);
  const s = summarize(data);

  // Monthly trend buckets
  const buckets = Array.from({ length: months }, (_, i) => monthKey(monthStart(-(months - 1 - i))));
  const trend = buckets.map((m) => ({
    month: m,
    visits: data.visits.filter((v) => monthKey(v.scheduled_date) === m).length,
    completed: data.visits.filter((v) => monthKey(v.scheduled_date) === m && v.status === 'completed').length,
    recs: data.recs.filter((r) => monthKey(r.created_at) === m).length,
  }));
  const trendMax = Math.max(1, ...trend.flatMap((t) => [t.visits, t.recs]));

  const statusCounts = (Object.keys(VISIT_STATUS_LABELS) as VisitStatus[])
    .map((st) => ({ status: st, count: data.visits.filter((v) => v.status === st).length }))
    .filter((x) => x.count > 0);
  const statusMax = Math.max(1, ...statusCounts.map((x) => x.count));
  const vendors = vendorStats(data);

  // Simple grouped-bar SVG for the monthly trend
  const bw = 9, group = 34, chartH = 120;
  const chartW = trend.length * group + 10;
  const bar = (i: number, offset: number, value: number, color: string) => {
    const h = Math.round((value / trendMax) * (chartH - 20));
    return <rect x={10 + i * group + offset} y={chartH - h} width={bw} height={h} rx="2" fill={color}><title>{value}</title></rect>;
  };

  return page(c, 'Analytics', (
    <>
      <PageHeader title="Analytics" sub={`Maintenance performance over the last ${months} months`}>
        <form method="get" action="/analytics" class="inline">
          <select name="months" data-autosubmit aria-label="Date range">
            {[3, 6, 12].map((m) => <option value={m} selected={months === m}>Last {m} months</option>)}
          </select>
        </form>
        <a class="btn" href={`/analytics/export?months=${months}`}><Icon name="download" size={16} /> Export CSV</a>
      </PageHeader>

      <div class="stats">
        <StatCard label="Total Visits" value={s.totalVisits} href="/visits" icon="clipboard" tone="blue" />
        <StatCard label="Completion Rate" value={`${s.completionRate}%`} href="/visits?status=completed" icon="trend" tone="green" />
        <StatCard label="Recommendations" value={s.totalRecs} href="/recommendations" icon="file" tone="purple" />
        <StatCard label="Avg. Days to Complete" value={s.avgCompletionDays} href="/recommendations" icon="clock" tone="amber" />
      </div>

      <div class="grid-2">
        <Card title="Monthly Trend">
          <div class="chart">
            <svg viewBox={`0 0 ${chartW} ${chartH + 18}`} role="img" aria-label="Visits and recommendations per month">
              {trend.map((t, i) => (
                <>
                  {bar(i, 0, t.visits, '#3b82f6')}
                  {bar(i, bw + 1, t.completed, '#16a34a')}
                  {bar(i, 2 * (bw + 1), t.recs, '#8b5cf6')}
                  <text x={10 + i * group + 14} y={chartH + 13} font-size="7" text-anchor="middle" fill="#64748b">
                    {fmtMonth(t.month).slice(0, 3)}
                  </text>
                </>
              ))}
            </svg>
            <div class="chart-legend">
              <span style="--dot:#3b82f6">Visits scheduled</span>
              <span style="--dot:#16a34a">Visits completed</span>
              <span style="--dot:#8b5cf6">Recommendations</span>
            </div>
          </div>
        </Card>

        <Card title="Visit Status Distribution">
          {statusCounts.length === 0 ? <p class="muted">No visits in this period.</p> : (
            <div style="display:grid; gap:0.5rem">
              {statusCounts.map((x) => (
                <div>
                  <div style="display:flex; justify-content:space-between; font-size:0.83rem">
                    <span>{VISIT_STATUS_LABELS[x.status]}</span>
                    <strong>{x.count} ({Math.round((x.count / s.totalVisits) * 100)}%)</strong>
                  </div>
                  <div style="background:var(--bg); border-radius:4px; height:8px">
                    <div class={`cal__evt evt--${x.status}`} style={`height:8px; width:${Math.round((x.count / statusMax) * 100)}%`}></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card title="Vendor Performance" pad={false}>
        {vendors.length === 0 ? <EmptyState title="No vendor activity in this period" /> : (
          <div class="tbl-wrap">
            <table class="tbl">
              <thead><tr><th>Vendor</th><th class="num">Visits</th><th class="num">Completed</th><th class="num">Recommendations</th><th class="num">Completion</th></tr></thead>
              <tbody>
                {vendors.map(([name, v]) => (
                  <tr>
                    <td>{name}</td>
                    <td class="num">{v.visits}</td>
                    <td class="num">{v.completed}</td>
                    <td class="num">{v.recs}</td>
                    <td class="num">{v.visits ? Math.round((v.completed / v.visits) * 100) : 0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div class="stats">
        <StatCard label="Completed Visits" value={s.completedVisits} href="/visits?status=completed" icon="check" tone="green" />
        <StatCard label="Pending Visits" value={s.pendingVisits} href="/visits" icon="clock" tone="amber" />
        <StatCard label="Open Recommendations" value={s.openRecs} href="/recommendations?status=open" icon="file" tone="blue" />
        <StatCard label="Overdue Recommendations" value={s.overdueRecs} href="/recommendations?status=active" icon="alert" tone="red" />
      </div>
    </>
  ));
});

routes.get('/analytics/export', async (c) => {
  const months = [3, 6, 12].includes(parseInt(c.req.query('months') ?? '', 10)) ? parseInt(c.req.query('months')!, 10) : 6;
  const data = await loadAnalytics(c.env.DB, months);
  const s = summarize(data);
  const rows: unknown[][] = [
    ['VendorTrak analytics export', `Last ${months} months`, `Generated ${todayStr()}`],
    [],
    ['Metric', 'Value'],
    ['Total visits', s.totalVisits],
    ['Completed visits', s.completedVisits],
    ['Pending visits', s.pendingVisits],
    ['Completion rate %', s.completionRate],
    ['Total recommendations', s.totalRecs],
    ['Open recommendations', s.openRecs],
    ['Overdue recommendations', s.overdueRecs],
    ['Avg days to complete recommendation', s.avgCompletionDays],
    [],
    ['Vendor', 'Visits', 'Completed', 'Recommendations', 'Completion %'],
    ...vendorStats(data).map(([name, v]) => [name, v.visits, v.completed, v.recs, v.visits ? Math.round((v.completed / v.visits) * 100) : 0]),
  ];
  return csvResponse(`vendortrak-analytics-${months}mo.csv`, rows);
});

export default routes;
