'use client';

import { useEffect, useState, useMemo } from 'react';
import { Calendar as CalendarIcon, CheckSquare, AlertTriangle, FileText, ClipboardList, TrendingUp, ChevronRight, X } from 'lucide-react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Calendar, { CalendarEvent } from '@/components/ui/Calendar';
import { format, isBefore, startOfMonth, endOfMonth, addMonths, subMonths, addDays } from 'date-fns';

interface DashboardStats {
  totalRoutines: number;
  activeVisits: number;
  pendingTasks: number;
  overdueTasks: number;
  openRecommendations: number;
  completedThisMonth: number;
}

interface UpcomingVisit {
  id: string;
  scheduled_date: string;
  status: string;
  is_adhoc?: boolean;
  adhoc_description?: string | null;
  routine: { plan_number: string; description: string; vendor: { name: string } } | null;
  vendor: { name: string } | null;
}

interface PendingTask {
  id: string;
  task_type: string;
  due_date: string;
  status: string;
  visit_id: string;
  visit: {
    is_adhoc?: boolean;
    routine: { plan_number: string; vendor: { name: string } } | null;
    vendor: { name: string } | null;
  };
}

interface CalendarVisit {
  id: string;
  scheduled_date: string;
  status: string;
  is_adhoc?: boolean;
  adhoc_description?: string | null;
  routine: { plan_number: string; description: string; vendor: { name: string } } | null;
  vendor: { name: string } | null;
}

export default function DashboardPage() {
  const { userProfile, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<DashboardStats>({
    totalRoutines: 0,
    activeVisits: 0,
    pendingTasks: 0,
    overdueTasks: 0,
    openRecommendations: 0,
    completedThisMonth: 0,
  });
  const [upcomingVisits, setUpcomingVisits] = useState<UpcomingVisit[]>([]);
  const [pendingTasks, setPendingTasks] = useState<PendingTask[]>([]);
  const [calendarVisits, setCalendarVisits] = useState<CalendarVisit[]>([]);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedDateVisits, setSelectedDateVisits] = useState<CalendarEvent[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const fetchDashboardData = async () => {
      // Don't fetch if already loaded or currently loading
      if (dataLoaded || dataLoading) return;

      // Wait for auth to finish loading
      if (authLoading) return;

      // If no user profile, nothing to fetch
      if (!userProfile) return;

      setDataLoading(true);
      try {
        const today = new Date();
        const monthStart = startOfMonth(today).toISOString();
        const monthEnd = endOfMonth(today).toISOString();

        // Fetch stats
        const [routinesRes, visitsRes, tasksRes, recommendationsRes, completedRes] = await Promise.all([
          supabase.from('maintenance_routines').select('id', { count: 'exact' }).eq('is_active', true),
          supabase.from('maintenance_visits').select('id', { count: 'exact' }).not('status', 'in', '("completed","cancelled")'),
          supabase.from('tasks').select('id, status, due_date').eq('assigned_to_id', userProfile.id).in('status', ['pending', 'in_progress', 'overdue']),
          supabase.from('recommendations').select('id', { count: 'exact' }).eq('status', 'open'),
          supabase
            .from('maintenance_visits')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'completed')
            .gte('completed_at', monthStart)
            .lte('completed_at', monthEnd),
        ]);

        const overdueTasks = tasksRes.data?.filter((t: { due_date: string; status: string }) =>
          t.status === 'overdue' || (isBefore(new Date(t.due_date), today) && t.status !== 'completed')
        ).length || 0;

        setStats({
          totalRoutines: routinesRes.count || 0,
          activeVisits: visitsRes.count || 0,
          pendingTasks: tasksRes.data?.length || 0,
          overdueTasks,
          openRecommendations: recommendationsRes.count || 0,
          completedThisMonth: completedRes.count || 0,
        });

        // Fetch upcoming visits
        const { data: visitsData } = await supabase
          .from('maintenance_visits')
          .select(`
            id,
            scheduled_date,
            status,
            is_adhoc,
            adhoc_description,
            routine:maintenance_routines(
              plan_number,
              description,
              vendor:vendors(name)
            ),
            vendor:vendors!maintenance_visits_vendor_id_fkey(name)
          `)
          .gte('scheduled_date', today.toISOString().split('T')[0])
          .lte('scheduled_date', addDays(today, 30).toISOString().split('T')[0])
          .not('status', 'in', '("completed","cancelled")')
          .order('scheduled_date', { ascending: true })
          .limit(5);

        setUpcomingVisits(visitsData as unknown as UpcomingVisit[] || []);

        // Fetch pending tasks for user
        const { data: tasksData } = await supabase
          .from('tasks')
          .select(`
            id,
            task_type,
            due_date,
            status,
            visit_id,
            visit:maintenance_visits(
              is_adhoc,
              routine:maintenance_routines(
                plan_number,
                vendor:vendors(name)
              ),
              vendor:vendors!maintenance_visits_vendor_id_fkey(name)
            )
          `)
          .eq('assigned_to_id', userProfile.id)
          .in('status', ['pending', 'in_progress', 'overdue'])
          .order('due_date', { ascending: true })
          .limit(5);

        setPendingTasks(tasksData as unknown as PendingTask[] || []);

        // Fetch visits for calendar (3 months: previous, current, next)
        const calendarStart = subMonths(startOfMonth(new Date()), 1);
        const calendarEnd = addMonths(endOfMonth(new Date()), 1);
        const { data: calendarData } = await supabase
          .from('maintenance_visits')
          .select(`
            id,
            scheduled_date,
            status,
            is_adhoc,
            adhoc_description,
            routine:maintenance_routines(
              plan_number,
              description,
              vendor:vendors(name)
            ),
            vendor:vendors!maintenance_visits_vendor_id_fkey(name)
          `)
          .gte('scheduled_date', calendarStart.toISOString().split('T')[0])
          .lte('scheduled_date', calendarEnd.toISOString().split('T')[0])
          .order('scheduled_date', { ascending: true });

        setCalendarVisits(calendarData as unknown as CalendarVisit[] || []);
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setDataLoading(false);
        setDataLoaded(true);
      }
    };

    fetchDashboardData();
  }, [userProfile, authLoading, dataLoading, dataLoaded]);

  // Convert visits to calendar events
  const calendarEvents: CalendarEvent[] = useMemo(() => {
    return calendarVisits.map((visit) => ({
      id: visit.id,
      date: visit.scheduled_date,
      title: visit.routine?.plan_number || (visit.is_adhoc ? 'Breakdown' : 'Visit'),
      subtitle: visit.routine?.vendor?.name || visit.vendor?.name,
      status: visit.status as CalendarEvent['status'],
    }));
  }, [calendarVisits]);

  const handleDateClick = (date: Date, events: CalendarEvent[]) => {
    setSelectedDate(date);
    setSelectedDateVisits(events);
  };

  const handleCalendarEventClick = (event: CalendarEvent) => {
    window.location.href = `/visits/${event.id}`;
  };

  const statCards = [
    { title: 'Active Routines', value: stats.totalRoutines, icon: CalendarIcon, color: 'bg-blue-500', href: '/routines' },
    { title: 'Active Visits', value: stats.activeVisits, icon: ClipboardList, color: 'bg-green-500', href: '/visits' },
    { title: 'My Pending Tasks', value: stats.pendingTasks, icon: CheckSquare, color: 'bg-yellow-500', href: '/tasks' },
    { title: 'Overdue Tasks', value: stats.overdueTasks, icon: AlertTriangle, color: 'bg-red-500', href: '/tasks' },
    { title: 'Open Recommendations', value: stats.openRecommendations, icon: FileText, color: 'bg-purple-500', href: '/recommendations' },
    { title: 'Completed This Month', value: stats.completedThisMonth, icon: TrendingUp, color: 'bg-teal-500', href: '/visits?status=completed' },
  ];

  const formatTaskType = (type: string) => {
    const labels: Record<string, string> = {
      confirm_visit_date: 'Confirm Visit Date',
      upload_report: 'Upload Report',
      create_recommendations: 'Create Recommendations',
      review_recommendations: 'Review Recommendations',
      technical_review: 'Technical Review',
    };
    return labels[type] || type;
  };

  const getStatusVariant = (status: string) => {
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

  // Only show loading spinner during initial auth check
  if (authLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600">Welcome back, {userProfile?.full_name}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((stat) => (
          <Link key={stat.title} href={stat.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className={`${stat.color} p-3 rounded-lg`}>
                      <stat.icon className="w-6 h-6 text-white" />
                    </div>
                    <div className="ml-4">
                      <p className="text-sm text-gray-500">{stat.title}</p>
                      <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Calendar Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Visit Calendar</CardTitle>
          </CardHeader>
          <CardContent>
            <Calendar
              events={calendarEvents}
              onDateClick={handleDateClick}
              onEventClick={handleCalendarEventClick}
              selectedDate={selectedDate}
            />
          </CardContent>
        </Card>

        {/* Selected Date Panel */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                {selectedDate
                  ? format(selectedDate, 'EEEE, MMM d, yyyy')
                  : 'Select a Date'}
              </CardTitle>
              {selectedDate && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedDate(null);
                    setSelectedDateVisits([]);
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!selectedDate ? (
              <p className="text-gray-500 text-sm">Click on a date in the calendar to see scheduled visits.</p>
            ) : selectedDateVisits.length === 0 ? (
              <p className="text-gray-500 text-sm">No visits scheduled for this date.</p>
            ) : (
              <div className="space-y-3">
                {selectedDateVisits.map((event) => {
                  const visit = calendarVisits.find((v) => v.id === event.id);
                  return (
                    <Link key={event.id} href={`/visits/${event.id}`}>
                      <div className="p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                        <div className="flex items-start justify-between">
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-gray-900 truncate">
                              {event.title}
                            </p>
                            <p className="text-sm text-gray-500 truncate">
                              {visit?.routine?.vendor?.name || visit?.vendor?.name}
                            </p>
                            <p className="text-xs text-gray-400 mt-1 line-clamp-2">
                              {visit?.routine?.description || visit?.adhoc_description}
                            </p>
                          </div>
                          <Badge variant={getStatusVariant(event.status)} size="sm" className="flex-shrink-0 ml-2">
                            {event.status.replace('_', ' ')}
                          </Badge>
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Visits */}
        <Card>
          <CardHeader>
            <CardTitle>Upcoming Visits (Next 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingVisits.length === 0 ? (
              <p className="text-gray-500 text-sm">No upcoming visits scheduled.</p>
            ) : (
              <div className="space-y-4">
                {upcomingVisits.map((visit) => (
                  <Link key={visit.id} href={`/visits/${visit.id}`}>
                    <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                      <div>
                        <p className="font-medium text-gray-900">
                          {visit.routine?.plan_number || (visit.is_adhoc ? 'Breakdown' : 'Visit')}
                        </p>
                        <p className="text-sm text-gray-500">
                          {visit.routine?.vendor?.name || visit.vendor?.name}
                        </p>
                      </div>
                      <div className="flex items-center">
                        <div className="text-right mr-2">
                          <p className="text-sm font-medium text-gray-900">
                            {format(new Date(visit.scheduled_date), 'MMM d, yyyy')}
                          </p>
                          <Badge variant={getStatusVariant(visit.status)} size="sm">
                            {visit.status.replace('_', ' ')}
                          </Badge>
                        </div>
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* My Pending Tasks */}
        <Card>
          <CardHeader>
            <CardTitle>My Pending Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            {pendingTasks.length === 0 ? (
              <p className="text-gray-500 text-sm">No pending tasks.</p>
            ) : (
              <div className="space-y-4">
                {pendingTasks.map((task) => {
                  const isOverdue = isBefore(new Date(task.due_date), new Date());
                  return (
                    <Link key={task.id} href={`/visits/${task.visit_id}`}>
                      <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors cursor-pointer">
                        <div>
                          <p className="font-medium text-gray-900">
                            {formatTaskType(task.task_type)}
                          </p>
                          <p className="text-sm text-gray-500">
                            {(task.visit?.routine?.plan_number || (task.visit?.is_adhoc ? 'Breakdown' : 'Visit'))} - {task.visit?.routine?.vendor?.name || task.visit?.vendor?.name}
                          </p>
                        </div>
                        <div className="flex items-center">
                          <div className="text-right mr-2">
                            <p className={`text-sm font-medium ${isOverdue ? 'text-red-600' : 'text-gray-900'}`}>
                              {format(new Date(task.due_date), 'MMM d, yyyy')}
                            </p>
                            <Badge variant={isOverdue ? 'overdue' : 'pending'} size="sm">
                              {isOverdue ? 'Overdue' : task.status.replace('_', ' ')}
                            </Badge>
                          </div>
                          <ChevronRight className="w-4 h-4 text-gray-400" />
                        </div>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
