'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export default function ShowAllToggle() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const showAll = searchParams.get('scope') === 'all';

  return (
    <label className="flex items-center gap-2 text-sm text-gray-700">
      <input
        type="checkbox"
        checked={showAll}
        onChange={(e) => {
          const params = new URLSearchParams(searchParams.toString());
          if (e.target.checked) {
            params.set('scope', 'all');
          } else {
            params.delete('scope');
          }
          router.push(`?${params.toString()}`, { scroll: false });
        }}
        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
      />
      Show all users&apos; tasks
    </label>
  );
}
