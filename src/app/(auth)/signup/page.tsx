'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import Button from '@/components/ui/Button';

// Public self-signup is disabled. Accounts are created by an administrator
// via the Users page (which uses the server-side admin API). This page is kept
// only to handle stale links and redirect to login.
export default function SignupPage() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => router.push('/login'), 5000);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="text-center mb-8">
          <div className="flex justify-center">
            <Building2 className="w-12 h-12 text-primary-600" />
          </div>
          <h2 className="mt-4 text-3xl font-bold text-gray-900">Registration is closed</h2>
        </div>

        <div className="bg-white py-8 px-6 shadow-md rounded-lg text-center space-y-4">
          <p className="text-sm text-gray-600">
            Accounts for VendorTrak are created by an administrator. Please contact your
            system administrator if you need access.
          </p>
          <Link href="/login">
            <Button className="w-full">Go to Sign In</Button>
          </Link>
          <p className="text-xs text-gray-400">You will be redirected to the sign-in page shortly.</p>
        </div>
      </div>
    </div>
  );
}
