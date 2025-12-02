// Force dynamic rendering for all dashboard pages
export const dynamic = 'force-dynamic';

export default function Template({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
