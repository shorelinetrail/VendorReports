'use client';

import { useState, useEffect, ReactNode } from 'react';
import { X, Eye, Users, ChevronDown } from 'lucide-react';
import Sidebar from './Sidebar';
import Header from './Header';
import { useAuth } from '@/contexts/AuthContext';
import { createClient } from '@/lib/supabase/client';
import { User } from '@/types/database';

interface DashboardLayoutProps {
  children: ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { isImpersonating, userProfile, realUserProfile, stopImpersonation, startImpersonation } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const supabase = createClient();

  const isAdmin = realUserProfile?.role === 'admin';
  const showAdminBar = isAdmin;

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin]);

  const fetchUsers = async () => {
    const { data } = await supabase
      .from('users')
      .select('*')
      .order('full_name');
    if (data) setUsers(data);
  };

  const handleSelectUser = (user: User) => {
    startImpersonation(user);
    setDropdownOpen(false);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Admin Role Testing Bar */}
      {showAdminBar && (
        <div className={`fixed top-0 left-0 right-0 z-50 px-4 py-2 ${
          isImpersonating
            ? 'bg-yellow-500 text-yellow-900'
            : 'bg-gray-800 text-gray-100'
        }`}>
          <div className="flex items-center justify-between max-w-screen-2xl mx-auto">
            <div className="flex items-center">
              <Users className="w-4 h-4 mr-2" />
              <span className="text-sm font-medium mr-4">
                {isImpersonating
                  ? `Viewing as: ${userProfile?.full_name} (${userProfile?.role?.replace(/_/g, ' ')})`
                  : 'Admin Mode'
                }
              </span>
            </div>

            <div className="flex items-center space-x-3">
              {/* User Selector Dropdown */}
              <div className="relative">
                <button
                  onClick={() => setDropdownOpen(!dropdownOpen)}
                  className={`flex items-center text-sm px-3 py-1 rounded ${
                    isImpersonating
                      ? 'bg-yellow-400 hover:bg-yellow-300 text-yellow-900'
                      : 'bg-gray-700 hover:bg-gray-600 text-gray-100'
                  }`}
                >
                  <Eye className="w-4 h-4 mr-1" />
                  View as User
                  <ChevronDown className="w-4 h-4 ml-1" />
                </button>

                {dropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setDropdownOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border z-50 max-h-80 overflow-y-auto">
                      <div className="p-2">
                        <p className="text-xs text-gray-500 px-2 py-1 font-medium">Select a user to view as:</p>
                        {users
                          .filter(u => u.id !== realUserProfile?.id)
                          .map(user => (
                            <button
                              key={user.id}
                              onClick={() => handleSelectUser(user)}
                              className={`w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 ${
                                userProfile?.id === user.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'
                              }`}
                            >
                              <span className="font-medium">{user.full_name}</span>
                              <span className="text-gray-500 text-xs block">
                                {user.role.replace(/_/g, ' ')}
                              </span>
                            </button>
                          ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Stop Impersonation Button */}
              {isImpersonating && (
                <button
                  onClick={stopImpersonation}
                  className="flex items-center bg-yellow-400 hover:bg-yellow-300 text-yellow-900 px-3 py-1 rounded text-sm font-medium"
                >
                  <X className="w-4 h-4 mr-1" />
                  Stop
                </button>
              )}
            </div>
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
        className={`fixed left-0 z-30 transform lg:relative lg:translate-x-0 transition-transform duration-200 ease-in-out ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } ${showAdminBar ? 'top-10 bottom-0' : 'inset-y-0'}`}
      >
        <Sidebar />
      </div>

      {/* Main content */}
      <div className={`flex-1 flex flex-col overflow-hidden ${showAdminBar ? 'pt-10' : ''}`}>
        <Header onMenuClick={() => setSidebarOpen(!sidebarOpen)} />

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
