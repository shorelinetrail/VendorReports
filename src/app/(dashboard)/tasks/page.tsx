'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Clock, AlertTriangle, Eye } from 'lucide-react';
import { format, isBefore, isToday, addDays } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Task, TaskStatus, TaskType } from '@/types/database';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Select from '@/components/ui/Select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import Link from 'next/link';

interface TaskWithDetails extends Omit<Task, 'visit' | 'assigned_to'> {
  visit: {
    id: string;
    scheduled_date: string;
    routine: {
      plan_number: string;
      description: string;
      vendor: { name: string };
    };
  };
  assigned_to: {
    full_name: string;
  };
}

export default function TasksPage() {
  const { userProfile, hasRole, loading: authLoading } = useAuth();
  const [tasks, setTasks] = useState<TaskWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [showAllUsers, setShowAllUsers] = useState(false);
  const supabase = createClient();

  const isAdmin = hasRole('admin');

  useEffect(() => {
    fetchTasks();
  }, [userProfile, showAllUsers, authLoading]);

  const fetchTasks = async () => {
    // Wait for auth to finish loading
    if (authLoading) return;

    // If no user profile after auth loaded, stop loading
    if (!userProfile) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      let query = supabase
        .from('tasks')
        .select(`
          *,
          visit:maintenance_visits(
            id,
            scheduled_date,
            routine:maintenance_routines(
              plan_number,
              description,
              vendor:vendors(name)
            )
          ),
          assigned_to:users!tasks_assigned_to_id_fkey(full_name)
        `)
        .order('due_date', { ascending: true });

      if (!showAllUsers) {
        query = query.eq('assigned_to_id', userProfile.id);
      }

      const { data, error } = await query;

      if (error) throw error;
      setTasks(data as unknown as TaskWithDetails[]);
    } catch (err) {
      console.error('Error fetching tasks:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteTask = async (taskId: string) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({
          status: 'completed' as TaskStatus,
          completed_at: new Date().toISOString(),
        })
        .eq('id', taskId);

      if (error) throw error;
      await fetchTasks();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const handleStartTask = async (taskId: string) => {
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ status: 'in_progress' as TaskStatus })
        .eq('id', taskId);

      if (error) throw error;
      await fetchTasks();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      alert(message);
    }
  };

  const formatTaskType = (type: TaskType): string => {
    const labels: Record<TaskType, string> = {
      confirm_visit_date: 'Confirm Visit Date',
      upload_report: 'Upload Report',
      create_recommendations: 'Create Recommendations',
      review_recommendations: 'Review Recommendations',
      technical_review: 'Technical Review',
    };
    return labels[type] || type;
  };

  const getTaskTypeColor = (type: TaskType): string => {
    const colors: Record<TaskType, string> = {
      confirm_visit_date: 'bg-blue-100 text-blue-800',
      upload_report: 'bg-purple-100 text-purple-800',
      create_recommendations: 'bg-green-100 text-green-800',
      review_recommendations: 'bg-yellow-100 text-yellow-800',
      technical_review: 'bg-orange-100 text-orange-800',
    };
    return colors[type] || 'bg-gray-100 text-gray-800';
  };

  const getStatusInfo = (task: TaskWithDetails) => {
    const today = new Date();
    const dueDate = new Date(task.due_date);

    if (task.status === 'completed') {
      return { variant: 'completed' as const, label: 'Completed' };
    }
    if (task.status === 'cancelled') {
      return { variant: 'cancelled' as const, label: 'Cancelled' };
    }
    if (isBefore(dueDate, today)) {
      return { variant: 'overdue' as const, label: 'Overdue' };
    }
    if (isToday(dueDate)) {
      return { variant: 'warning' as const, label: 'Due Today' };
    }
    if (isBefore(dueDate, addDays(today, 3))) {
      return { variant: 'warning' as const, label: 'Due Soon' };
    }
    if (task.status === 'in_progress') {
      return { variant: 'in_progress' as const, label: 'In Progress' };
    }
    return { variant: 'pending' as const, label: 'Pending' };
  };

  const filteredTasks = tasks.filter((task) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'overdue') {
      return isBefore(new Date(task.due_date), new Date()) && task.status !== 'completed' && task.status !== 'cancelled';
    }
    return task.status === statusFilter;
  });

  const statusOptions = [
    { value: 'all', label: 'All Tasks' },
    { value: 'pending', label: 'Pending' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'completed', label: 'Completed' },
    { value: 'cancelled', label: 'Cancelled' },
  ];

  const taskCounts = {
    pending: tasks.filter((t) => t.status === 'pending').length,
    in_progress: tasks.filter((t) => t.status === 'in_progress').length,
    overdue: tasks.filter((t) => isBefore(new Date(t.due_date), new Date()) && t.status !== 'completed' && t.status !== 'cancelled').length,
    completed: tasks.filter((t) => t.status === 'completed').length,
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Tasks</h1>
          <p className="text-gray-600">Manage your assigned maintenance tasks</p>
        </div>
      </div>

      {/* Task Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <Clock className="w-8 h-8 text-yellow-500" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">Pending</p>
                <p className="text-2xl font-bold">{taskCounts.pending}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <Clock className="w-8 h-8 text-blue-500" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">In Progress</p>
                <p className="text-2xl font-bold">{taskCounts.in_progress}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <AlertTriangle className="w-8 h-8 text-red-500" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">Overdue</p>
                <p className="text-2xl font-bold">{taskCounts.overdue}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center">
              <CheckCircle className="w-8 h-8 text-green-500" />
              <div className="ml-3">
                <p className="text-sm text-gray-500">Completed</p>
                <p className="text-2xl font-bold">{taskCounts.completed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center space-x-4">
            <div className="w-48">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                options={statusOptions}
              />
            </div>
            {isAdmin && (
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={showAllUsers}
                  onChange={(e) => setShowAllUsers(e.target.checked)}
                  className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <span className="text-sm text-gray-600">Show all users tasks</span>
              </label>
            )}
            <span className="text-sm text-gray-500">
              Showing {filteredTasks.length} tasks
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Tasks Table */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task Type</TableHead>
            <TableHead>Plan / Vendor</TableHead>
            {showAllUsers && <TableHead>Assigned To</TableHead>}
            <TableHead>Due Date</TableHead>
            <TableHead>Status</TableHead>
            <TableHead align="right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredTasks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={showAllUsers ? 6 : 5} className="text-center text-gray-500">
                No tasks found.
              </TableCell>
            </TableRow>
          ) : (
            filteredTasks.map((task) => {
              const statusInfo = getStatusInfo(task);
              return (
                <TableRow key={task.id}>
                  <TableCell>
                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium ${getTaskTypeColor(task.task_type)}`}>
                      {formatTaskType(task.task_type)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <p className="font-medium">{task.visit?.routine?.plan_number}</p>
                    <p className="text-sm text-gray-500">{task.visit?.routine?.vendor?.name}</p>
                  </TableCell>
                  {showAllUsers && (
                    <TableCell>{task.assigned_to?.full_name}</TableCell>
                  )}
                  <TableCell>
                    <p className={statusInfo.variant === 'overdue' ? 'text-red-600 font-medium' : ''}>
                      {format(new Date(task.due_date), 'MMM d, yyyy')}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
                  </TableCell>
                  <TableCell align="right">
                    <div className="flex items-center justify-end space-x-2">
                      <Link href={`/visits/${task.visit?.id}`}>
                        <Button variant="ghost" size="sm" title="View Visit">
                          <Eye className="w-4 h-4" />
                        </Button>
                      </Link>
                      {task.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleStartTask(task.id)}
                          title="Start Task"
                        >
                          <Clock className="w-4 h-4 text-blue-500" />
                        </Button>
                      )}
                      {(task.status === 'pending' || task.status === 'in_progress') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCompleteTask(task.id)}
                          title="Complete Task"
                        >
                          <CheckCircle className="w-4 h-4 text-green-500" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>
    </div>
  );
}
