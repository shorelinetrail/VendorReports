'use client';

import { useState, useEffect, useRef } from 'react';
import { Bell, Menu, Search, Clock, AlertTriangle, FileText, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { format, isBefore } from 'date-fns';
import Link from 'next/link';

interface Notification {
  id: string;
  type: 'task' | 'recommendation' | 'visit';
  title: string;
  description: string;
  link: string;
  isOverdue: boolean;
  date: string;
}

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { userProfile } = useAuth();
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowNotifications(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const fetchNotifications = async () => {
    if (!userProfile) return;

    setLoading(true);
    try {
      const today = new Date();
      const notifs: Notification[] = [];

      // Fetch pending/overdue tasks for this user
      const { data: tasks } = await supabase
        .from('tasks')
        .select(`
          id,
          task_type,
          due_date,
          status,
          visit:maintenance_visits(
            id,
            routine:maintenance_routines(plan_number)
          )
        `)
        .eq('assigned_to_id', userProfile.id)
        .in('status', ['pending', 'in_progress'])
        .order('due_date', { ascending: true })
        .limit(5);

      tasks?.forEach((task) => {
        const isOverdue = isBefore(new Date(task.due_date), today);
        const taskTypeLabels: Record<string, string> = {
          confirm_visit_date: 'Confirm Visit Date',
          upload_report: 'Upload Report',
          create_recommendations: 'Create Recommendations',
          review_recommendations: 'Review Recommendations',
          technical_review: 'Technical Review',
        };

        const visit = task.visit as unknown as { id: string; routine: { plan_number: string } } | null;
        notifs.push({
          id: `task-${task.id}`,
          type: 'task',
          title: taskTypeLabels[task.task_type] || task.task_type,
          description: `Plan: ${visit?.routine?.plan_number || 'Unknown'}`,
          link: `/visits/${visit?.id}`,
          isOverdue,
          date: task.due_date,
        });
      });

      // Fetch open recommendations needing review (for technical engineers)
      if (userProfile.role === 'admin' || userProfile.role === 'technical_engineer') {
        const { data: recs } = await supabase
          .from('recommendations')
          .select(`
            id,
            description,
            due_date,
            status,
            visit:maintenance_visits(
              id,
              routine:maintenance_routines(plan_number)
            )
          `)
          .eq('status', 'in_review')
          .order('created_at', { ascending: false })
          .limit(3);

        recs?.forEach((rec) => {
          const isOverdue = rec.due_date ? isBefore(new Date(rec.due_date), today) : false;
          notifs.push({
            id: `rec-${rec.id}`,
            type: 'recommendation',
            title: 'Review Needed',
            description: rec.description?.substring(0, 50) + '...' || 'Recommendation',
            link: '/recommendations',
            isOverdue,
            date: rec.due_date || '',
          });
        });
      }

      setNotifications(notifs);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBellClick = () => {
    setShowNotifications(!showNotifications);
    if (!showNotifications) {
      fetchNotifications();
    }
  };

  const overdueCount = notifications.filter(n => n.isOverdue).length;
  const totalCount = notifications.length;

  return (
    <header className="bg-white border-b border-gray-200 h-16 flex items-center justify-between px-4 lg:px-6">
      {/* Left side - Menu toggle and search */}
      <div className="flex items-center">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-md text-gray-600 hover:bg-gray-100"
        >
          <Menu className="w-6 h-6" />
        </button>

        <div className="hidden md:flex items-center ml-4 lg:ml-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search..."
              className="pl-10 pr-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 w-64"
            />
          </div>
        </div>
      </div>

      {/* Right side - Notifications and user */}
      <div className="flex items-center space-x-4">
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={handleBellClick}
            className="relative p-2 rounded-md text-gray-600 hover:bg-gray-100"
          >
            <Bell className="w-6 h-6" />
            {totalCount > 0 && (
              <span className={`absolute top-0 right-0 w-5 h-5 text-xs flex items-center justify-center rounded-full text-white ${overdueCount > 0 ? 'bg-red-500' : 'bg-primary-500'}`}>
                {totalCount}
              </span>
            )}
          </button>

          {/* Notifications Dropdown */}
          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border border-gray-200 z-50">
              <div className="p-3 border-b border-gray-200 flex items-center justify-between">
                <h3 className="font-semibold text-gray-900">Notifications</h3>
                <button
                  onClick={() => setShowNotifications(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="max-h-96 overflow-y-auto">
                {loading ? (
                  <div className="p-4 text-center text-gray-500">Loading...</div>
                ) : notifications.length === 0 ? (
                  <div className="p-4 text-center text-gray-500">
                    No pending notifications
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <Link
                      key={notif.id}
                      href={notif.link}
                      onClick={() => setShowNotifications(false)}
                      className={`block p-3 border-b border-gray-100 hover:bg-gray-50 ${notif.isOverdue ? 'bg-red-50' : ''}`}
                    >
                      <div className="flex items-start">
                        <div className={`p-2 rounded-full ${notif.isOverdue ? 'bg-red-100' : 'bg-gray-100'}`}>
                          {notif.type === 'task' && (
                            <Clock className={`w-4 h-4 ${notif.isOverdue ? 'text-red-500' : 'text-gray-500'}`} />
                          )}
                          {notif.type === 'recommendation' && (
                            <FileText className={`w-4 h-4 ${notif.isOverdue ? 'text-red-500' : 'text-purple-500'}`} />
                          )}
                          {notif.type === 'visit' && (
                            <AlertTriangle className={`w-4 h-4 ${notif.isOverdue ? 'text-red-500' : 'text-yellow-500'}`} />
                          )}
                        </div>
                        <div className="ml-3 flex-1">
                          <p className={`text-sm font-medium ${notif.isOverdue ? 'text-red-700' : 'text-gray-900'}`}>
                            {notif.title}
                          </p>
                          <p className="text-xs text-gray-500">{notif.description}</p>
                          {notif.date && (
                            <p className={`text-xs mt-1 ${notif.isOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
                              {notif.isOverdue ? 'Overdue: ' : 'Due: '}
                              {format(new Date(notif.date), 'MMM d, yyyy')}
                            </p>
                          )}
                        </div>
                      </div>
                    </Link>
                  ))
                )}
              </div>

              <div className="p-2 border-t border-gray-200">
                <Link
                  href="/tasks"
                  onClick={() => setShowNotifications(false)}
                  className="block text-center text-sm text-primary-600 hover:text-primary-700 py-2"
                >
                  View all tasks
                </Link>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center">
          <div className="w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center text-white font-medium text-sm">
            {userProfile?.full_name?.charAt(0)?.toUpperCase() || 'U'}
          </div>
          <div className="hidden sm:block ml-3">
            <p className="text-sm font-medium text-gray-900">{userProfile?.full_name}</p>
            <p className="text-xs text-gray-500 capitalize">{userProfile?.role?.replace('_', ' ')}</p>
          </div>
        </div>
      </div>
    </header>
  );
}
