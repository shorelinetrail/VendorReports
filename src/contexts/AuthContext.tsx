'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { User, UserRole } from '@/types/database';

interface AuthContextType {
  user: SupabaseUser | null;
  userProfile: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signUp: (email: string, password: string, fullName: string, role: UserRole) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  hasRole: (roles: UserRole | UserRole[]) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SupabaseUser | null>(null);
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();

  useEffect(() => {
    const getSession = async () => {
      console.log('AuthContext: Getting session...');
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          console.error('AuthContext: Error getting session:', error.message);
        }

        console.log('AuthContext: Session exists:', !!session?.user);
        setUser(session?.user ?? null);

        if (session?.user) {
          // Don't await - let profile load in background so page can render
          fetchUserProfile(session.user);
        }
      } catch (err) {
        console.error('AuthContext: Exception in getSession:', err);
      }
      // Always set loading to false, don't wait for profile
      setLoading(false);
    };

    getSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('AuthContext: Auth state changed:', event);
      setUser(session?.user ?? null);
      setLoading(false);

      if (session?.user) {
        // Don't await - let profile load in background
        fetchUserProfile(session.user);
      } else {
        setUserProfile(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserProfile = async (authUser: SupabaseUser) => {
    console.log('AuthContext: Fetching user profile for:', authUser.id);

    // Create fallback profile immediately so UI can render
    const metadata = authUser.user_metadata;
    const fallbackProfile: User = {
      id: authUser.id,
      email: authUser.email || '',
      full_name: metadata?.full_name || metadata?.name || authUser.email?.split('@')[0] || 'User',
      role: (metadata?.role as UserRole) || 'vendor_coordinator',
      created_at: authUser.created_at,
      updated_at: authUser.updated_at || authUser.created_at,
    };

    // Set fallback immediately
    setUserProfile(fallbackProfile);

    // Then try to get the real profile from DB (with timeout)
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout')), 5000)
      );

      const fetchPromise = supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

      const { data, error } = await Promise.race([fetchPromise, timeoutPromise]) as { data: User | null; error: Error | null };

      if (!error && data) {
        console.log('AuthContext: User profile loaded from DB:', data.email, data.role);
        setUserProfile(data);
      } else if (error) {
        console.warn('AuthContext: Using fallback profile, DB error:', error.message);
      }
    } catch (err) {
      console.warn('AuthContext: Using fallback profile, fetch failed:', err);
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    return { error: error?.message ?? null };
  };

  const signUp = async (email: string, password: string, fullName: string, role: UserRole) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      return { error: error.message };
    }

    if (data.user) {
      // Create user profile
      const { error: profileError } = await supabase
        .from('users')
        .insert({
          id: data.user.id,
          email,
          full_name: fullName,
          role,
        });

      if (profileError) {
        return { error: profileError.message };
      }
    }

    return { error: null };
  };

  const signOut = async () => {
    console.log('AuthContext: Signing out...');
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error('AuthContext: Sign out error:', error.message);
      }
    } catch (err) {
      console.error('AuthContext: Sign out exception:', err);
    }

    setUser(null);
    setUserProfile(null);

    // Force redirect to login page
    window.location.href = '/login';
  };

  const hasRole = (roles: UserRole | UserRole[]) => {
    if (!userProfile) return false;
    const roleArray = Array.isArray(roles) ? roles : [roles];
    return roleArray.includes(userProfile.role);
  };

  return (
    <AuthContext.Provider value={{ user, userProfile, loading, signIn, signUp, signOut, hasRole }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
