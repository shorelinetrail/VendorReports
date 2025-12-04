'use client';

import { useEffect, useState } from 'react';
import { Calendar, CheckSquare, AlertTriangle, FileText, ClipboardList, TrendingUp } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { format, isAfter, isBefore, addDays } from 'date-fns';

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
  routine: {
    plan_number: string;
    description: string;
    vendor: {
      name: string;
    };
  };
}

interface PendingTask {
  id: string;
  task_type: string;
  due_date: string;
  status: string;
  visit: {
    routine: {
      plan_number: string;
      vendor: {
        name: string;
      };
    };
  };
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
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const fetchDashboardData = async () => {
      // Wait for auth to finish loading
      if (authLoading) return;

      // If no user profile after auth loaded, just stop loading
      if (!userProfile) {
        setLoading(false);
        return;
      }

      try {
        // Fetch stats
        const [routinesRes, visitsRes, tasksRes, recommendationsRes] = await Promise.all([
          supabase.from('maintenance_routines').select('id', { count: 'exact' }).eq('is_active', true),
          supabase.from('maintenance_visits').select('id', { count: 'exact' }).not('status', 'in', '("completed","cancelled")'),
          supabase.from('tasks').select('id, status, due_date').eq('assigned_to_id', userProfile.id).in('status', ['pending', 'in_progress']),
          supabase.from('recommendations').select('id', { count: 'exact' }).eq('status', 'open'),
        ]);

        const today = new Date();
        const overdueTasks = tasksRes.data?.filter(t =>
          isBefore(new Date(t.due_date), today) && t.status !== 'completed'
        ).length || 0;

        setStats({
          totalRoutines: routinesRes.count || 0,
          activeVisits: visitsRes.count || 0,
          pendingTasks: tasksRes.data?.length || 0,
          overdueTasks,
          openRecommendations: recommendationsRes.count || 0,
          completedThisMonth: 0,
        });

        // Fetch upcoming visits
        const { data: visitsData } = await supabase
          .from('maintenance_visits')
          .select(`
            id,
            scheduled_date,
            status,
            routine:maintenance_routines(
              plan_number,
              description,
              vendor:vendors(name)
            )
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
            visit:maintenance_visits(
              routine:maintenance_routines(
                plan_number,
                vendor:vendors(name)
              )
            )
          `)
          .eq('assigned_to_id', userProfile.id)
          .in('status', ['pending', 'in_progress'])
          .order('due_date', { ascending: true })
          .limit(5);

        setPendingTasks(tasksData as unknown as PendingTask[] || []);
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, [userProfile, authLoading]);

  const statCards = [
    { title: 'Active Routines', value: stats.totalRoutines, icon: Calendar, color: 'bg-blue-500' },
    { title: 'Active Visits', value: stats.activeVisits, icon: ClipboardList, color: 'bg-green-500' },
    { title: 'My Pending Tasks', value: stats.pendingTasks, icon: CheckSquare, color: 'bg-yellow-500' },
    { title: 'Overdue Tasks', value: stats.overdueTasks, icon: AlertTriangle, color: 'bg-red-500' },
    { title: 'Open Recommendations', value: stats.openRecommendations, icon: FileText, color: 'bg-purple-500' },
    { title: 'Completed This Month', value: stats.completedThisMonth, icon: TrendingUp, color: 'bg-teal-500' },
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
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600">Welcome back, {userProfile?.full_name}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {statCards.map((stat) => (
          <Card key={stat.title}>
            <CardContent className="p-6">
              <div className="flex items-center">
                <div className={`${stat.color} p-3 rounded-lg`}>
                  <stat.icon className="w-6 h-6 text-white" />
                </div>
                <div className="ml-4">
                  <p className="text-sm text-gray-500">{stat.title}</p>
                  <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
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
                  <div key={visit.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="font-medium text-gray-900">
                        {visit.routine?.plan_number}
                      </p>
                      <p className="text-sm text-gray-500">
                        {visit.routine?.vendor?.name}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-medium text-gray-900">
                        {format(new Date(visit.scheduled_date), 'MMM d, yyyy')}
                      </p>
                      <Badge variant={getStatusVariant(visit.status)} size="sm">
                        {visit.status.replace('_', ' ')}
                      </Badge>
                    </div>
                  </div>
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
                    <div key={task.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-medium text-gray-900">
                          {formatTaskType(task.task_type)}
                        </p>
                        <p className="text-sm text-gray-500">
                          {task.visit?.routine?.plan_number} - {task.visit?.routine?.vendor?.name}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={`text-sm font-medium ${isOverdue ? 'text-red-600' : 'text-gray-900'}`}>
                          {format(new Date(task.due_date), 'MMM d, yyyy')}
                        </p>
                        <Badge variant={isOverdue ? 'overdue' : 'pending'} size="sm">
                          {isOverdue ? 'Overdue' : task.status.replace('_', ' ')}
                        </Badge>
                      </div>
                    </div>
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
