import { requireAuth, hasRole } from '@/lib/auth';
import PageHeader from '@/components/ui/PageHeader';
import UsersView from './UsersView';
import type { User } from '@/types/database';

export default async function UsersPage() {
  const { supabase, profile, realProfile } = await requireAuth();
  const isAdmin = hasRole(profile, 'admin');

  const { data } = await supabase.from('users').select('*').order('full_name');

  return (
    <div className="space-y-6">
      <PageHeader title="Users" description="Accounts and their workflow roles" />
      <UsersView users={(data ?? []) as User[]} isAdmin={isAdmin} selfId={realProfile.id} />
    </div>
  );
}
