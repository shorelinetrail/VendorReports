'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  BarChart3,
  Bell,
  Building2,
  Calendar,
  CheckSquare,
  ChevronDown,
  ClipboardList,
  Clock,
  Eye,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { signOut, startImpersonation, stopImpersonation } from '@/lib/actions/session';
import { formatDate, ROLE_LABELS } from '@/lib/labels';
import type { User, UserRole } from '@/types/database';

export interface NotificationItem {
  id: string;
  kind: 'task' | 'recommendation';
  title: string;
  description: string;
  link: string;
  dueDate: string | null;
  isOverdue: boolean;
}

const NAVIGATION: { name: string; href: string; icon: LucideIcon; roles: UserRole[] }[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, roles: ['admin', 'vendor_coordinator', 'maintenance_engineer', 'technical_engineer'] },
  { name: 'My Tasks', href: '/tasks', icon: CheckSquare, roles: ['admin', 'vendor_coordinator', 'maintenance_engineer', 'technical_engineer'] },
  { name: 'Maintenance Routines', href: '/routines', icon: Calendar, roles: ['admin', 'vendor_coordinator', 'maintenance_engineer', 'technical_engineer'] },
  { name: 'Visits', href: '/visits', icon: ClipboardList, roles: ['admin', 'vendor_coordinator', 'maintenance_engineer', 'technical_engineer'] },
  { name: 'Recommendations', href: '/recommendations', icon: FileText, roles: ['admin', 'maintenance_engineer', 'technical_engineer'] },
  { name: 'Maintenance Reports', href: '/reports/maintenance', icon: FileText, roles: ['admin', 'vendor_coordinator', 'maintenance_engineer', 'technical_engineer'] },
  { name: 'Analytics', href: '/reports', icon: BarChart3, roles: ['admin', 'vendor_coordinator', 'maintenance_engineer', 'technical_engineer'] },
  { name: 'Vendors', href: '/vendors', icon: Building2, roles: ['admin'] },
  { name: 'Users', href: '/users', icon: Users, roles: ['admin'] },
  { name: 'Settings', href: '/settings', icon: Settings, roles: ['admin'] },
];

interface AppShellProps {
  profile: User;
  realProfile: User;
  isImpersonating: boolean;
  impersonationUsers: User[];
  notifications: NotificationItem[];
  children: ReactNode;
}

export default function AppShell({
  profile,
  realProfile,
  isImpersonating,
  impersonationUsers,
  notifications,
  children,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [viewAsOpen, setViewAsOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const viewAsRef = useRef<HTMLDivElement>(null);

  const isRealAdmin = realProfile.role === 'admin';
  const nav = NAVIGATION.filter((item) => item.roles.includes(profile.role));

  // Close dropdowns on outside click.
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setBellOpen(false);
      if (viewAsRef.current && !viewAsRef.current.contains(e.target as Node)) setViewAsOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  const isActive = (href: string) =>
    href === '/reports' ? pathname === '/reports' : pathname === href || pathname.startsWith(`${href}/`);

  const overdueCount = notifications.filter((n) => n.isOverdue).length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Admin / impersonation bar */}
      {isRealAdmin && (
        <div
          className={`fixed inset-x-0 top-0 z-50 flex h-10 items-center justify-between px-4 text-sm ${
            isImpersonating ? 'bg-yellow-500 text-yellow-900' : 'bg-gray-800 text-gray-100'
          }`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Users className="h-4 w-4 flex-shrink-0" />
            <span className="truncate font-medium">
              {isImpersonating
                ? `Viewing as: ${profile.full_name} (${ROLE_LABELS[profile.role]})`
                : 'Admin Mode'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative" ref={viewAsRef}>
              <button
                type="button"
                onClick={() => setViewAsOpen((o) => !o)}
                className="flex items-center gap-1 rounded px-2 py-1 hover:bg-black/10"
              >
                <Eye className="h-4 w-4" />
                <span className="hidden sm:inline">View as User</span>
                <ChevronDown className="h-3 w-3" />
              </button>
              {viewAsOpen && (
                <div className="absolute right-0 top-full z-50 mt-1 max-h-80 w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 text-gray-900 shadow-lg">
                  {impersonationUsers
                    .filter((u) => u.id !== realProfile.id)
                    .map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        onClick={async () => {
                          setViewAsOpen(false);
                          await startImpersonation(u.id);
                          router.refresh();
                        }}
                        className={`block w-full px-3 py-2 text-left text-sm hover:bg-gray-50 ${
                          isImpersonating && profile.id === u.id ? 'bg-blue-50 text-blue-700' : ''
                        }`}
                      >
                        <span className="block font-medium">{u.full_name}</span>
                        <span className="block text-xs text-gray-500">{ROLE_LABELS[u.role]}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
            {isImpersonating && (
              <button
                type="button"
                onClick={async () => {
                  await stopImpersonation();
                  router.refresh();
                }}
                className="flex items-center gap-1 rounded bg-black/10 px-2 py-1 font-medium hover:bg-black/20"
              >
                <X className="h-4 w-4" />
                Stop
              </button>
            )}
          </div>
        </div>
      )}

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed bottom-0 z-40 flex w-64 flex-col bg-gray-900 transition-transform lg:translate-x-0 ${
          isRealAdmin ? 'top-10' : 'top-0'
        } ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="flex items-center gap-2 px-4 py-5">
          <Building2 className="h-7 w-7 text-primary-400" />
          <span className="text-lg font-semibold text-white">Vendor Reports</span>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto px-2" aria-label="Main navigation">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setSidebarOpen(false)}
              aria-current={isActive(item.href) ? 'page' : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive(item.href)
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              {item.name}
            </Link>
          ))}
        </nav>
        <div className="border-t border-gray-800 p-4">
          <p className="truncate text-sm font-medium text-white">{profile.full_name}</p>
          <p className="text-xs text-gray-400">{ROLE_LABELS[profile.role]}</p>
          <button
            type="button"
            onClick={() => signOut()}
            className="mt-3 flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className={`lg:pl-64 ${isRealAdmin ? 'pt-10' : ''}`}>
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 sm:px-6">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            aria-label="Open navigation"
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <div className="flex items-center gap-3">
            {/* Notifications */}
            <div className="relative" ref={bellRef}>
              <button
                type="button"
                onClick={() => setBellOpen((o) => !o)}
                aria-label={`Notifications (${notifications.length})`}
                className="relative rounded-md p-2 text-gray-500 hover:bg-gray-100"
              >
                <Bell className="h-5 w-5" />
                {notifications.length > 0 && (
                  <span
                    className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${
                      overdueCount > 0 ? 'bg-red-500' : 'bg-primary-500'
                    }`}
                  >
                    {notifications.length}
                  </span>
                )}
              </button>
              {bellOpen && (
                <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-lg border border-gray-200 bg-white shadow-lg">
                  <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                    <p className="text-sm font-semibold text-gray-900">Notifications</p>
                    <button type="button" onClick={() => setBellOpen(false)} aria-label="Close notifications">
                      <X className="h-4 w-4 text-gray-400 hover:text-gray-600" />
                    </button>
                  </div>
                  <div className="max-h-80 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="px-4 py-6 text-center text-sm text-gray-500">No pending notifications</p>
                    ) : (
                      notifications.map((n) => (
                        <Link
                          key={n.id}
                          href={n.link}
                          onClick={() => setBellOpen(false)}
                          className={`block border-b border-gray-50 px-4 py-3 hover:bg-gray-50 ${
                            n.isOverdue ? 'bg-red-50' : ''
                          }`}
                        >
                          <div className="flex items-start gap-2">
                            {n.kind === 'task' ? (
                              <Clock className={`mt-0.5 h-4 w-4 flex-shrink-0 ${n.isOverdue ? 'text-red-500' : 'text-gray-400'}`} />
                            ) : (
                              <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-purple-500" />
                            )}
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900">{n.title}</p>
                              <p className="truncate text-xs text-gray-500">{n.description}</p>
                              {n.dueDate && (
                                <p className={`text-xs ${n.isOverdue ? 'font-medium text-red-600' : 'text-gray-400'}`}>
                                  {n.isOverdue ? 'Overdue: ' : 'Due: '}
                                  {formatDate(n.dueDate)}
                                </p>
                              )}
                            </div>
                          </div>
                        </Link>
                      ))
                    )}
                  </div>
                  <Link
                    href="/tasks"
                    onClick={() => setBellOpen(false)}
                    className="block border-t border-gray-100 px-4 py-2 text-center text-sm font-medium text-primary-600 hover:bg-gray-50"
                  >
                    View all tasks
                  </Link>
                </div>
              )}
            </div>

            {/* User chip */}
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-600 text-sm font-semibold text-white">
                {(profile.full_name?.[0] ?? 'U').toUpperCase()}
              </div>
              <div className="hidden sm:block">
                <p className="text-sm font-medium leading-tight text-gray-900">{profile.full_name}</p>
                <p className="text-xs leading-tight text-gray-500">{ROLE_LABELS[profile.role]}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
