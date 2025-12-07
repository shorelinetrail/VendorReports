'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, Search, SortAsc, SortDesc, Eye } from 'lucide-react';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import Link from 'next/link';

interface MaintenanceReport {
  id: string;
  scheduled_date: string;
  confirmed_date: string | null;
  status: string;
  report_file_path: string | null;
  report_uploaded_at: string | null;
  routine: {
    plan_number: string;
    description: string;
    vendor: { name: string };
  };
  vendor_coordinator: { full_name: string };
}

type SortField = 'scheduled_date' | 'report_uploaded_at' | 'plan_number' | 'vendor';
type SortOrder = 'asc' | 'desc';

export default function MaintenanceReportsPage() {
  const { hasRole } = useAuth();
  const [reports, setReports] = useState<MaintenanceReport[]>([]);
  const [filteredReports, setFilteredReports] = useState<MaintenanceReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [vendorFilter, setVendorFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortField, setSortField] = useState<SortField>('report_uploaded_at');
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
        .from('maintenance_visits')
        .select(`
          id,
          scheduled_date,
          confirmed_date,
          status,
          report_file_path,
          report_uploaded_at,
          routine:maintenance_routines(
            plan_number,
            description,
            vendor:vendors(name)
          ),
          vendor_coordinator:users!maintenance_visits_vendor_coordinator_id_fkey(full_name)
        `)
        .not('report_file_path', 'is', null)
        .order('report_uploaded_at', { ascending: false });

      const reportsData = (data || []) as unknown as MaintenanceReport[];
      setReports(reportsData);

      // Extract unique vendors
      const uniqueVendors = [...new Set(reportsData.map(r => r.routine?.vendor?.name).filter(Boolean))];
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
        r.routine?.plan_number?.toLowerCase().includes(term) ||
        r.routine?.description?.toLowerCase().includes(term) ||
        r.routine?.vendor?.name?.toLowerCase().includes(term)
      );
    }

    // Apply vendor filter
    if (vendorFilter !== 'all') {
      filtered = filtered.filter(r => r.routine?.vendor?.name === vendorFilter);
    }

    // Apply status filter
    if (statusFilter !== 'all') {
      filtered = filtered.filter(r => r.status === statusFilter);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let valueA: string | null = null;
      let valueB: string | null = null;

      switch (sortField) {
        case 'scheduled_date':
          valueA = a.scheduled_date;
          valueB = b.scheduled_date;
          break;
        case 'report_uploaded_at':
          valueA = a.report_uploaded_at;
          valueB = b.report_uploaded_at;
          break;
        case 'plan_number':
          valueA = a.routine?.plan_number || '';
          valueB = b.routine?.plan_number || '';
          break;
        case 'vendor':
          valueA = a.routine?.vendor?.name || '';
          valueB = b.routine?.vendor?.name || '';
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
    if (!report.report_file_path) return;

    try {
      const { data, error } = await supabase.storage
        .from('reports')
        .download(report.report_file_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${report.routine?.plan_number || 'report'}-${format(new Date(report.scheduled_date), 'yyyy-MM-dd')}.${report.report_file_path.split('.').pop()}`;
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Maintenance Reports</h1>
          <p className="text-gray-600">View and download uploaded maintenance reports</p>
        </div>
        <Link href="/reports">
          <Button variant="secondary">
            View Analytics
          </Button>
        </Link>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Search by plan, description, or vendor..."
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
                onClick={() => toggleSort('report_uploaded_at')}
              >
                Uploaded <SortIcon field="report_uploaded_at" />
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
              <TableCell colSpan={7} className="text-center text-gray-500 py-8">
                <FileText className="w-12 h-12 mx-auto text-gray-300 mb-2" />
                No maintenance reports found matching your filters.
              </TableCell>
            </TableRow>
          ) : (
            filteredReports.map((report) => (
              <TableRow key={report.id}>
                <TableCell className="font-medium">
                  <Link href={`/visits/${report.id}`} className="text-primary-600 hover:underline">
                    {report.routine?.plan_number}
                  </Link>
                </TableCell>
                <TableCell>{report.routine?.vendor?.name}</TableCell>
                <TableCell>
                  {format(new Date(report.scheduled_date), 'MMM d, yyyy')}
                </TableCell>
                <TableCell>
                  {report.report_uploaded_at
                    ? format(new Date(report.report_uploaded_at), 'MMM d, yyyy')
                    : '-'}
                </TableCell>
                <TableCell>{report.vendor_coordinator?.full_name}</TableCell>
                <TableCell>
                  <Badge variant={getStatusVariant(report.status)}>
                    {report.status.replace(/_/g, ' ')}
                  </Badge>
                </TableCell>
                <TableCell align="right">
                  <div className="flex items-center justify-end space-x-2">
                    <Link href={`/visits/${report.id}`}>
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
