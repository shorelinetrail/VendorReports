import Link from 'next/link';
import { Eye, FileText } from 'lucide-react';
import { requireAuth } from '@/lib/auth';
import { formatDate, VISIT_STATUS_LABELS, VISIT_STATUS_VARIANTS } from '@/lib/labels';
import PageHeader from '@/components/ui/PageHeader';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import EmptyState from '@/components/ui/EmptyState';
import FilterSelect from '@/components/ui/FilterSelect';
import SearchInput from '@/components/ui/SearchInput';
import SortHeader from '@/components/ui/SortHeader';
import { Card, CardContent } from '@/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import DownloadReportButton from './DownloadReportButton';
import type { VisitStatus } from '@/types/database';

interface ReportRow {
  id: string;
  file_path: string;
  file_name: string;
  uploaded_at: string;
  visit: {
    id: string;
    scheduled_date: string;
    status: VisitStatus;
    routine: { plan_number: string; description: string; vendor: { name: string } | null } | null;
  } | null;
  uploaded_by: { full_name: string } | null;
}

type SortField = 'uploaded_at' | 'scheduled_date' | 'plan_number' | 'vendor';

const SORT_ACCESSORS: Record<SortField, (r: ReportRow) => string> = {
  uploaded_at: (r) => r.uploaded_at ?? '',
  scheduled_date: (r) => r.visit?.scheduled_date ?? '',
  plan_number: (r) => r.visit?.routine?.plan_number ?? '',
  vendor: (r) => r.visit?.routine?.vendor?.name ?? '',
};

export default async function MaintenanceReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; vendor?: string; status?: string; sort?: string; order?: string }>;
}) {
  const { supabase } = await requireAuth();
  const params = await searchParams;

  const { data } = await supabase
    .from('visit_reports')
    .select(
      `id, file_path, file_name, uploaded_at,
      visit:maintenance_visits(id, scheduled_date, status, routine:maintenance_routines(plan_number, description, vendor:vendors(name))),
      uploaded_by:users!visit_reports_uploaded_by_id_fkey(full_name)`,
    )
    .order('uploaded_at', { ascending: false });

  const reports = (data ?? []) as unknown as ReportRow[];
  const vendors = [...new Set(reports.map((r) => r.visit?.routine?.vendor?.name).filter(Boolean))] as string[];

  const search = (params.q ?? '').toLowerCase();
  const sortField: SortField = (['uploaded_at', 'scheduled_date', 'plan_number', 'vendor'] as const).includes(
    params.sort as SortField,
  )
    ? (params.sort as SortField)
    : 'uploaded_at';
  const order = params.order === 'asc' ? 'asc' : 'desc';

  const filtered = reports
    .filter((report) => {
      if (params.vendor && params.vendor !== 'all' && report.visit?.routine?.vendor?.name !== params.vendor) {
        return false;
      }
      if (params.status && params.status !== 'all' && report.visit?.status !== params.status) return false;
      if (search) {
        const haystack = [
          report.visit?.routine?.plan_number,
          report.visit?.routine?.description,
          report.visit?.routine?.vendor?.name,
          report.file_name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const compared = SORT_ACCESSORS[sortField](a).localeCompare(SORT_ACCESSORS[sortField](b));
      return order === 'asc' ? compared : -compared;
    });

  return (
    <div className="space-y-6">
      <PageHeader title="Maintenance Reports" description="All uploaded report files across visits" />

      <Card>
        <CardContent className="flex flex-col gap-3 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchInput placeholder="Search plan, description, vendor, or file…" />
            <FilterSelect
              param="vendor"
              className="w-48"
              options={[{ value: 'all', label: 'All Vendors' }, ...vendors.map((v) => ({ value: v, label: v }))]}
            />
            <FilterSelect
              param="status"
              className="w-56"
              options={[
                { value: 'all', label: 'All Statuses' },
                { value: 'report_uploaded', label: 'Report Uploaded' },
                { value: 'recommendations_created', label: 'Recommendations Created' },
                { value: 'in_review', label: 'In Review' },
                { value: 'completed', label: 'Completed' },
              ]}
            />
          </div>
          <p className="text-sm text-gray-500">
            Showing {filtered.length} of {reports.length} reports
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filtered.length === 0 ? (
            <EmptyState
              icon={FileText}
              title="No maintenance reports found"
              description={reports.length === 0 ? 'Reports uploaded on visits will appear here.' : 'Try adjusting the filters.'}
            />
          ) : (
            <Table className="border-0">
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <SortHeader field="plan_number" defaultField="uploaded_at">
                      Plan Number
                    </SortHeader>
                  </TableHead>
                  <TableHead>File</TableHead>
                  <TableHead>
                    <SortHeader field="vendor" defaultField="uploaded_at">
                      Vendor
                    </SortHeader>
                  </TableHead>
                  <TableHead>
                    <SortHeader field="scheduled_date" defaultField="uploaded_at">
                      Visit Date
                    </SortHeader>
                  </TableHead>
                  <TableHead>
                    <SortHeader field="uploaded_at" defaultField="uploaded_at">
                      Uploaded
                    </SortHeader>
                  </TableHead>
                  <TableHead>Uploaded By</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead align="right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((report) => (
                  <TableRow key={report.id}>
                    <TableCell>
                      {report.visit ? (
                        <Link
                          href={`/visits/${report.visit.id}`}
                          className="font-medium text-primary-600 hover:text-primary-700"
                        >
                          {report.visit.routine?.plan_number ?? '-'}
                        </Link>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs truncate">{report.file_name}</TableCell>
                    <TableCell>{report.visit?.routine?.vendor?.name ?? '-'}</TableCell>
                    <TableCell>{formatDate(report.visit?.scheduled_date)}</TableCell>
                    <TableCell>{formatDate(report.uploaded_at)}</TableCell>
                    <TableCell>{report.uploaded_by?.full_name ?? '-'}</TableCell>
                    <TableCell>
                      {report.visit && (
                        <Badge variant={VISIT_STATUS_VARIANTS[report.visit.status]}>
                          {VISIT_STATUS_LABELS[report.visit.status]}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      <div className="flex items-center justify-end gap-1">
                        {report.visit && (
                          <Link href={`/visits/${report.visit.id}`}>
                            <Button variant="ghost" size="sm" title="View visit" aria-label="View visit">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                        )}
                        <DownloadReportButton reportId={report.id} fileName={report.file_name} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
