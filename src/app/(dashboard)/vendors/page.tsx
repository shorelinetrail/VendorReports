import { requireAuth, hasRole } from '@/lib/auth';
import PageHeader from '@/components/ui/PageHeader';
import VendorsView from './VendorsView';
import type { Vendor } from '@/types/database';

export default async function VendorsPage() {
  const { supabase, profile } = await requireAuth();
  const isAdmin = hasRole(profile, 'admin');

  const { data } = await supabase.from('vendors').select('*').order('name');

  return (
    <div className="space-y-6">
      <PageHeader title="Vendors" description="External companies that perform maintenance" />
      <VendorsView vendors={(data ?? []) as Vendor[]} isAdmin={isAdmin} />
    </div>
  );
}
