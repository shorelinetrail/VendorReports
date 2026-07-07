'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import Select from '@/components/ui/Select';

interface FilterSelectProps {
  param: string;
  label?: string;
  options: { value: string; label: string }[];
  defaultValue?: string;
  className?: string;
}

/** A <Select> bound to a URL search param, so filters survive reload and can be linked. */
export default function FilterSelect({ param, label, options, defaultValue = 'all', className }: FilterSelectProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const value = searchParams.get(param) ?? defaultValue;

  return (
    <Select
      label={label}
      name={param}
      value={value}
      options={options}
      className={className}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        if (e.target.value === defaultValue) {
          params.delete(param);
        } else {
          params.set(param, e.target.value);
        }
        router.push(`?${params.toString()}`, { scroll: false });
      }}
    />
  );
}
