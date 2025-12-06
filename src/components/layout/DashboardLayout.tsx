'use client';

import { useState, ReactNode } from 'react';
import { X, Eye } from 'lucide-react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useAuth } from '@/contexts/AuthContext';

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isImpersonating, userProfile, stopImpersonation } = useAuth();

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Impersonation Banner */}
      {isImpersonating && (
        <div className="fixed top-0 left-0 right-0 bg-yellow-500 text-yellow-900 z-50 px-4 py-2">
          <div className="flex items-center justify-center">
            <Eye className="w-4 h-4 mr-2" />
            <span className="text-sm font-medium">
              Viewing as: {userProfile?.full_name} ({userProfile?.role?.replace(/_/g, ' ')})
            </span>
            <button
              onClick={stopImpersonation}
              className="ml-4 flex items-center text-yellow-900 hover:text-yellow-800 bg-yellow-400 hover:bg-yellow-300 px-3 py-1 rounded text-sm font-medium"
            >
              <X className="w-4 h-4 mr-1" />
              Stop
            </button>
          </div>
        </div>
      )}

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div
        className={`fixed inset-y-0 left-0 z-30 transform lg:relative lg:translate-x-0 transition-transform duration-200 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${isImpersonating ? 'pt-10' : ''}`}
      >
        <Sidebar />
      </div>

      {/* Main content */}
      <div className={`flex-1 flex flex-col overflow-hidden ${isImpersonating ? 'pt-10' : ''}`}>
        <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
