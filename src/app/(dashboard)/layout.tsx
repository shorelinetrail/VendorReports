import { ReactNode } from 'react';
import ClientLayout from './ClientLayout';

// Force dynamic rendering for all dashboard pages
export const dynamic = 'force-dynamic';

export default function DashboardRootLayout({ children }: { children: ReactNode }) {
  return <ClientLayout>{children}</ClientLayout>;
}
