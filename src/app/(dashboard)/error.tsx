'use client';

import { AlertTriangle } from 'lucide-react';
import Button from '@/components/ui/Button';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="rounded-full bg-red-50 p-3">
        <AlertTriangle className="h-6 w-6 text-red-500" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-gray-900">Something went wrong</h2>
      <p className="mt-1 max-w-md text-sm text-gray-500">
        {error.message || 'An unexpected error occurred while loading this page.'}
      </p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
