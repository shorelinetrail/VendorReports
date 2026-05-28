'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Calendar,
  ClipboardList,
  FileText,
  Users,
  Building2,
  Settings,
  LogOut,
  CheckSquare,
  BarChart3,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const navigation = [
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

interface SidebarProps {
  onItemClick?: () => void;
}

export default function Sidebar({ onItemClick }: SidebarProps) {
  const pathname = usePathname();
  const { userProfile, signOut, loading } = useAuth();

  // Show all navigation items based on role, or show all if no role yet (fallback)
  const userRole = userProfile?.role || 'vendor_coordinator';
  const filteredNavigation = navigation.filter(
    (item) => item.roles.includes(userRole)
  );

  // Show loading skeleton only briefly while auth is initializing
  if (loading) {
    return (
      <div className="flex flex-col h-full bg-gray-900 text-white w-64">
        {/* Logo */}
        <div className="flex items-center h-16 px-6 border-b border-gray-800">
          <Building2 className="w-8 h-8 text-primary-500" />
          <span className="ml-3 text-lg font-semibold">VendorTrak</span>
        </div>
        {/* Loading skeleton */}
        <nav className="flex-1 px-4 py-4 space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 bg-gray-800 rounded-md animate-pulse" />
          ))}
        </nav>
        <div className="p-4 border-t border-gray-800">
          <div className="h-12 bg-gray-800 rounded-md animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white w-64">
      {/* Logo */}
      <div className="flex items-center h-16 px-6 border-b border-gray-800">
        <Building2 className="w-8 h-8 text-primary-500" />
        <span className="ml-3 text-lg font-semibold">Vendor Reports</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {filteredNavigation.map((item) => {
          // Special case: Analytics (/reports) should only be active at exact path
          const isActive = item.href === '/reports'
            ? pathname === '/reports'
            : pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.name}
              href={item.href}
              onClick={onItemClick}
              className={`flex items-center px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <item.icon className="w-5 h-5 mr-3" />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* User info and logout */}
      <div className="p-4 border-t border-gray-800">
        <div className="mb-3">
          <p className="text-sm font-medium text-white truncate">{userProfile?.full_name}</p>
          <p className="text-xs text-gray-400 capitalize">{userProfile?.role?.replace('_', ' ')}</p>
        </div>
        <button
          onClick={signOut}
          className="flex items-center w-full px-3 py-2 text-sm text-gray-300 rounded-md hover:bg-gray-800 hover:text-white transition-colors"
        >
          <LogOut className="w-5 h-5 mr-3" />
          Sign Out
        </button>
      </div>
    </div>
  );
}
