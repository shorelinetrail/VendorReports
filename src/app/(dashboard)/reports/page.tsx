'use client';

import { useEffect, useState } from 'react';
import { Download, Calendar, TrendingUp, PieChart, BarChart3 } from 'lucide-react';
import { format, subMonths, startOfMonth, endOfMonth, eachMonthOfInterval } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import Select from '@/components/ui/Select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart as RechartsPie,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';

interface ReportStats {
  totalVisits: number;
  completedVisits: number;
  pendingVisits: number;
  totalRecommendations: number;
  completedRecommendations: number;
  openRecommendations: number;
  overdueRecommendations: number;
  averageCompletionDays: number;
}

interface VendorStats {
  name: string;
  visits: number;
  recommendations: number;
  completed: number;
}

interface MonthlyData {
  month: string;
  visits: number;
  recommendations: number;
  completed: number;
}

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899'];

export default function ReportsPage() {
  const { hasRole } = useAuth();
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState('6');
  const [stats, setStats] = useState<ReportStats>({
    totalVisits: 0,
    completedVisits: 0,
    pendingVisits: 0,
    totalRecommendations: 0,
    completedRecommendations: 0,
    openRecommendations: 0,
    overdueRecommendations: 0,
    averageCompletionDays: 0,
  });
  const [vendorStats, setVendorStats] = useState<VendorStats[]>([]);
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [statusData, setStatusData] = useState<{ name: string; value: number }[]>([]);
  const supabase = createClient();

  useEffect(() => {
    fetchReportData();
  }, [dateRange]);

  const fetchReportData = async () => {
    setLoading(true);
    const months = parseInt(dateRange);
    const startDate = startOfMonth(subMonths(new Date(), months - 1));
    const endDate = endOfMonth(new Date());

    try {
      // Fetch visits
      const { data: visitsData } = await supabase
        .from('maintenance_visits')
        .select(`
          id,
          status,
          scheduled_date,
          created_at,
          routine:maintenance_routines(
            vendor:vendors(name)
          )
        `)
        .gte('scheduled_date', startDate.toISOString())
        .lte('scheduled_date', endDate.toISOString());

      // Fetch recommendations
      const { data: recommendationsData } = await supabase
        .from('recommendations')
        .select(`
          id,
          status,
          due_date,
          created_at,
          completed_at,
          visit:maintenance_visits(
            scheduled_date,
            routine:maintenance_routines(
              vendor:vendors(name)
            )
          )
        `)
        .gte('created_at', startDate.toISOString())
        .lte('created_at', endDate.toISOString());

      // Calculate stats - use 'as unknown as' to handle Supabase nested query types
      type VisitRow = { status: string; scheduled_date: string; routine?: { vendor?: { name: string } } };
      type RecRow = { status: string; due_date: string | null; completed_at: string | null; created_at: string; visit?: { routine?: { vendor?: { name: string } } } };
      const visits = (visitsData || []) as unknown as VisitRow[];
      const recommendations = (recommendationsData || []) as unknown as RecRow[];

      const completedVisits = visits.filter((v) => v.status === 'completed').length;
      const pendingVisits = visits.filter((v) => !['completed', 'cancelled'].includes(v.status)).length;

      const completedRecs = recommendations.filter((r) => r.status === 'completed').length;
      const openRecs = recommendations.filter((r) => r.status === 'open').length;
      const overdueRecs = recommendations.filter((r) =>
        r.due_date &&
        new Date(r.due_date) < new Date() &&
        !['completed', 'cancelled'].includes(r.status)
      ).length;

      // Calculate average completion days
      const completedWithDates = recommendations.filter((r) => r.completed_at && r.created_at);
      const avgDays = completedWithDates.length > 0
        ? completedWithDates.reduce((acc, r) => {
            const days = (new Date(r.completed_at!).getTime() - new Date(r.created_at).getTime()) / (1000 * 60 * 60 * 24);
            return acc + days;
          }, 0) / completedWithDates.length
        : 0;

      setStats({
        totalVisits: visits.length,
        completedVisits,
        pendingVisits,
        totalRecommendations: recommendations.length,
        completedRecommendations: completedRecs,
        openRecommendations: openRecs,
        overdueRecommendations: overdueRecs,
        averageCompletionDays: Math.round(avgDays),
      });

      // Calculate vendor stats
      const vendorMap = new Map<string, VendorStats>();
      visits.forEach((v) => {
        const vendorName = v.routine?.vendor?.name || 'Unknown';
        if (!vendorMap.has(vendorName)) {
          vendorMap.set(vendorName, { name: vendorName, visits: 0, recommendations: 0, completed: 0 });
        }
        const vendor = vendorMap.get(vendorName)!;
        vendor.visits++;
        if (v.status === 'completed') vendor.completed++;
      });

      recommendations.forEach((r) => {
        const vendorName = r.visit?.routine?.vendor?.name || 'Unknown';
        if (vendorMap.has(vendorName)) {
          vendorMap.get(vendorName)!.recommendations++;
        }
      });

      setVendorStats(Array.from(vendorMap.values()).sort((a, b) => b.visits - a.visits).slice(0, 10));

      // Calculate monthly data
      const monthsInterval = eachMonthOfInterval({ start: startDate, end: endDate });
      const monthly = monthsInterval.map(monthDate => {
        const monthStart = startOfMonth(monthDate);
        const monthEnd = endOfMonth(monthDate);

        const monthVisits = visits.filter(v => {
          const date = new Date(v.scheduled_date);
          return date >= monthStart && date <= monthEnd;
        });

        const monthRecs = recommendations.filter(r => {
          const date = new Date(r.created_at);
          return date >= monthStart && date <= monthEnd;
        });

        return {
          month: format(monthDate, 'MMM yyyy'),
          visits: monthVisits.length,
          recommendations: monthRecs.length,
          completed: monthVisits.filter(v => v.status === 'completed').length,
        };
      });

      setMonthlyData(monthly);

      // Status distribution
      const statusCounts = {
        'Scheduled': visits.filter(v => v.status === 'scheduled').length,
        'Date Confirmed': visits.filter(v => v.status === 'date_confirmed').length,
        'Report Uploaded': visits.filter(v => v.status === 'report_uploaded').length,
        'In Review': visits.filter(v => v.status === 'in_review').length,
        'Completed': visits.filter(v => v.status === 'completed').length,
        'Cancelled': visits.filter(v => v.status === 'cancelled').length,
      };

      setStatusData(
        Object.entries(statusCounts)
          .filter(([_, value]) => value > 0)
          .map(([name, value]) => ({ name, value }))
      );

    } catch (err) {
      console.error('Error fetching report data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    // Create CSV data
    const csvData = [
      ['Metric', 'Value'],
      ['Total Visits', stats.totalVisits],
      ['Completed Visits', stats.completedVisits],
      ['Pending Visits', stats.pendingVisits],
      ['Total Recommendations', stats.totalRecommendations],
      ['Completed Recommendations', stats.completedRecommendations],
      ['Open Recommendations', stats.openRecommendations],
      ['Overdue Recommendations', stats.overdueRecommendations],
      ['Average Completion Days', stats.averageCompletionDays],
      [],
      ['Vendor', 'Visits', 'Recommendations', 'Completed'],
      ...vendorStats.map(v => [v.name, v.visits, v.recommendations, v.completed]),
    ];

    const csv = csvData.map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `maintenance-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const dateRangeOptions = [
    { value: '3', label: 'Last 3 Months' },
    { value: '6', label: 'Last 6 Months' },
    { value: '12', label: 'Last 12 Months' },
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
          <h1 className="text-2xl font-bold text-gray-900">Analytics Dashboard</h1>
          <p className="text-gray-600">View maintenance statistics and performance trends</p>
        </div>
        <div className="flex items-center space-x-4">
          <div className="w-48">
            <Select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value)}
              options={dateRangeOptions}
            />
          </div>
          <Button variant="secondary" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <Calendar className="w-8 h-8 text-blue-500" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">Total Visits</p>
                <p className="text-2xl font-bold">{stats.totalVisits}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <TrendingUp className="w-8 h-8 text-green-500" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">Completion Rate</p>
                <p className="text-2xl font-bold">
                  {stats.totalVisits > 0 ? Math.round((stats.completedVisits / stats.totalVisits) * 100) : 0}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <PieChart className="w-8 h-8 text-purple-500" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">Total Recommendations</p>
                <p className="text-2xl font-bold">{stats.totalRecommendations}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <BarChart3 className="w-8 h-8 text-orange-500" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">Avg. Completion Days</p>
                <p className="text-2xl font-bold">{stats.averageCompletionDays}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Trend Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Monthly Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="visits" stroke="#3B82F6" name="Visits" />
                <Line type="monotone" dataKey="recommendations" stroke="#F59E0B" name="Recommendations" />
                <Line type="monotone" dataKey="completed" stroke="#10B981" name="Completed" />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Visit Status Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <RechartsPie>
                <Pie
                  data={statusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </RechartsPie>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Vendor Performance */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Vendor Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={vendorStats}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="visits" fill="#3B82F6" name="Visits" />
                <Bar dataKey="recommendations" fill="#F59E0B" name="Recommendations" />
                <Bar dataKey="completed" fill="#10B981" name="Completed" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Completed Visits</p>
            <p className="text-3xl font-bold text-green-600">{stats.completedVisits}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Pending Visits</p>
            <p className="text-3xl font-bold text-yellow-600">{stats.pendingVisits}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Open Recommendations</p>
            <p className="text-3xl font-bold text-blue-600">{stats.openRecommendations}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-500">Overdue Recommendations</p>
            <p className="text-3xl font-bold text-red-600">{stats.overdueRecommendations}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
