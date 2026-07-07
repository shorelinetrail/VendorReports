'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';

interface SortHeaderProps {
  field: string;
  defaultField: string;
  defaultOrder?: 'asc' | 'desc';
  children: React.ReactNode;
}

/** Clickable column header bound to `sort`/`order` URL params. */
export default function SortHeader({ field, defaultField, defaultOrder = 'desc', children }: SortHeaderProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeField = searchParams.get('sort') ?? defaultField;
  const activeOrder = (searchParams.get('order') ?? defaultOrder) as 'asc' | 'desc';
  const isActive = activeField === field;

  function toggle() {
    const params = new URLSearchParams(searchParams.toString());
    params.set('sort', field);
    params.set('order', isActive && activeOrder === 'desc' ? 'asc' : 'desc');
    router.push(`?${params.toString()}`, { scroll: false });
  }

  const Icon = !isActive ? ArrowUpDown : activeOrder === 'asc' ? ArrowUp : ArrowDown;

  return (
    <button
      type="button"
      onClick={toggle}
      className={`inline-flex items-center gap-1 uppercase tracking-wider ${isActive ? 'text-gray-900' : 'hover:text-gray-700'}`}
    >
      {children}
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
