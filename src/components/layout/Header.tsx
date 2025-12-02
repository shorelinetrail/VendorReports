'use client';

import { Bell, Menu, Search } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

interface HeaderProps {
  onMenuClick: () => void;
}

export default function Header({ onMenuClick }: HeaderProps) {
  const { userProfile } = useAuth();

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
        <button className="relative p-2 rounded-md text-gray-600 hover:bg-gray-100">
          <Bell className="w-6 h-6" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
        </button>

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
