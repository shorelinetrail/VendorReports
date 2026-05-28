'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileText, Search, SortAsc, SortDesc, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import Link from 'next/link';

interface MaintenanceReport {
  id: string;
  file_path: string;
  file_name: string;
  uploaded_at: string;
  visit: {
    id: string;
    scheduled_date: string;
    status: string;
    routine: {
      plan_number: string;
      description: string;
      vendor: { name: string };
    };
  } | null;
  uploaded_by: { full_name: string } | null;
}

type SortField = 'scheduled_date' | 'uploaded_at' | 'plan_number' | 'vendor';
type SortOrder = 'asc' | 'desc';

export default function MaintenanceReportsPage() {
  const router = useRouter();
  const [reports, setReports] = useState<MaintenanceReport[]>([]);
  const [filteredReports, setFilteredReports] = useState<MaintenanceReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('uploaded_at');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [vendors, setVendors] = useState<string[]>([]);
  const supabase = createClient();

  useEffect(() => {
    fetchReports();
  }, []);

  useEffect(() => {
    applyFiltersAndSort();
  }, [reports, searchTerm, vendorFilter, statusFilter, sortField, sortOrder]);

  const fetchReports = async () => {
    setLoading(true);
    try {
      const { data } = await supabase
        .from('visit_reports')
        .select(`
          id,
          file_path,
          file_name,
          uploaded_at,
          visit:maintenance_visits(
            id,
            scheduled_date,
            status,
            routine:maintenance_routines(
              plan_number,
              description,
              vendor:vendors(name)
            )
          ),
          uploaded_by:users!visit_reports_uploaded_by_id_fkey(full_name)
        `)
        .order('uploaded_at', { ascending: false });

      const reportsData = (data || []) as unknown as MaintenanceReport[];
      setReports(reportsData);

      // Extract unique vendors
      const uniqueVendors = [...new Set(reportsData.map(r => r.visit?.routine?.vendor?.name).filter(Boolean))];
      setVendors(uniqueVendors as string[]);
    } catch (err) {
      console.error('Error fetching reports:', err);
    } finally {
      setLoading(false);
    }
  };

  const applyFiltersAndSort = () => {
    let filtered = [...reports];

    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(r =>
        r.visit?.routine?.plan_number?.toLowerCase().includes(term) ||
        r.visit?.routine?.description?.toLowerCase().includes(term) ||
        r.visit?.routine?.vendor?.name?.toLowerCase().includes(term) ||
        r.file_name?.toLowerCase().includes(term)
      );
    }

    // Apply vendor filter
    if (vendorFilter !== 'all') {
      filtered = filtered.filter(r => r.visit?.routine?.vendor?.name === vendorFilter);
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(r => r.visit?.status === statusFilter);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let valueA: string | null = null;
      let valueB: string | null = null;

      switch (sortField) {
        case 'scheduled_date':
          valueA = a.visit?.scheduled_date || '';
          valueB = b.visit?.scheduled_date || '';
          break;
        case 'uploaded_at':
          valueA = a.uploaded_at;
          valueB = b.uploaded_at;
          break;
        case 'plan_number':
          valueA = a.visit?.routine?.plan_number || '';
          valueB = b.visit?.routine?.plan_number || '';
          break;
        case 'vendor':
          valueA = a.visit?.routine?.vendor?.name || '';
          valueB = b.visit?.routine?.vendor?.name || '';
          break;
      }

      if (!valueA && !valueB) return 0;
      if (!valueA) return sortOrder === 'asc' ? 1 : -1;
      if (!valueB) return sortOrder === 'asc' ? -1 : 1;

      const comparison = valueA.localeCompare(valueB);
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    setFilteredReports(filtered);
  };

  const handleDownload = async (report: MaintenanceReport) => {
    if (!report.file_path) return;

    try {
      const { data, error } = await supabase.storage
        .from('reports')
        .download(report.file_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = report.file_name || report.file_path.split('/').pop() || 'report';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return sortOrder === 'asc' ? (
      <SortAsc className="w-4 h-4 inline ml-1" />
    ) : (
      <SortDesc className="w-4 h-4 inline ml-1" />
    );
  };

  const getStatusVariant = (status: string): 'pending' | 'in_progress' | 'completed' | 'cancelled' => {
    const variants: Record<string, 'pending' | 'in_progress' | 'completed' | 'cancelled'> = {
      scheduled: 'pending',
      date_confirmed: 'in_progress',
      report_uploaded: 'in_progress',
      recommendations_created: 'in_progress',
      in_review: 'in_progress',
      completed: 'completed',
      cancelled: 'cancelled',
    };
    return variants[status] || 'pending';
  };

  const statusOptions = [
    { value: 'all', label: 'All Statuses' },
    { value: 'report_uploaded', label: 'Report Uploaded' },
    { value: 'recommendations_created', label: 'Recommendations Created' },
    { value: 'in_review', label: 'In Review' },
    { value: 'completed', label: 'Completed' },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Maintenance Reports</h1>
        <p className="text-gray-600">View and download uploaded maintenance reports</p>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search by plan, description, vendor, or file..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              options={[
                { value: 'all', label: 'All Vendors' },
                ...vendors.map(v => ({ value: v, label: v })),
              ]}
            />
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={statusOptions}
            />
            <div className="flex items-center text-sm text-gray-500">
              Showing {filteredReports.length} of {reports.length} reports
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Reports Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <span
                className="cursor-pointer hover:text-primary-600"
                onClick={() => toggleSort('plan_number')}
              >
                Plan Number <SortIcon field="plan_number" />
              </span>
            </TableHead>
            <TableHead>File</TableHead>
            <TableHead>
              <span
                className="cursor-pointer hover:text-primary-600"
                onClick={() => toggleSort('vendor')}
              >
                Vendor <SortIcon field="vendor" />
              </span>
            </TableHead>
            <TableHead>
              <span
                className="cursor-pointer hover:text-primary-600"
                onClick={() => toggleSort('scheduled_date')}
              >
                Visit Date <SortIcon field="scheduled_date" />
              </span>
            </TableHead>
            <TableHead>
              <span
                className="cursor-pointer hover:text-primary-600"
                onClick={() => toggleSort('uploaded_at')}
              >
                Uploaded <SortIcon field="uploaded_at" />
              </span>
            </TableHead>
            <TableHead>Uploaded By</TableHead>
            <TableHead>Status</TableHead>
            <TableHead align="right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredReports.length === 0 ? (
            <TableRow>
              <TableCell colSpan={8} className="text-center text-gray-500 py-8">
                <FileText className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                No maintenance reports found matching your filters.
              </TableCell>
            </TableRow>
          ) : (
            filteredReports.map((report) => (
              <TableRow key={report.id} onClick={() => report.visit?.id && router.push(`/visits/${report.visit.id}`)}>
                <TableCell className="font-medium">
                  <span className="text-primary-600">{report.visit?.routine?.plan_number}</span>
                  {report.visit?.routine?.description && (
                    <p className="text-xs text-gray-500 font-normal whitespace-normal max-w-xs">{report.visit.routine.description}</p>
                  )}
                </TableCell>
                <TableCell className="max-w-xs truncate">{report.file_name}</TableCell>
                <TableCell>{report.visit?.routine?.vendor?.name}</TableCell>
                <TableCell>
                  {report.visit?.scheduled_date
                    ? format(new Date(report.visit.scheduled_date), 'MMM d, yyyy')
                    : '-'}
                </TableCell>
                <TableCell>
                  {report.uploaded_at
                    ? format(new Date(report.uploaded_at), 'MMM d, yyyy')
                    : '-'}
                </TableCell>
                <TableCell>{report.uploaded_by?.full_name}</TableCell>
                <TableCell>
                  <Badge variant={getStatusVariant(report.visit?.status || '')}>
                    {(report.visit?.status || '').replace(/_/g, ' ')}
                  </Badge>
                </TableCell>
                <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center justify-end space-x-2">
                    <Link href={`/visits/${report.visit?.id}`}>
                      <Button variant="ghost" size="sm" title="View Visit">
                        <Eye className="w-4 h-4" />
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownload(report)}
                      title="Download Report"
                    >
                      <Download className="w-4 h-4 text-blue-500" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
