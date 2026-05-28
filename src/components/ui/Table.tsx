'use client';

import { ReactNode, MouseEvent } from 'react';

interface TableProps {
  children: ReactNode;
  className?: string;
}

export function Table({ children, className = '' }: TableProps) {
  return (
    <div className={`overflow-x-auto rounded-lg border border-gray-200 ${className}`}>
      <table className="min-w-full divide-y divide-gray-200">
        {children}
      </table>
    </div>
  );
}

export function TableHeader({ children, className = '' }: TableProps) {
  return (
    <thead className={`bg-gray-50 ${className}`}>
      {children}
    </thead>
  );
}

export function TableBody({ children, className = '' }: TableProps) {
  return (
    <tbody className={`bg-white divide-y divide-gray-200 ${className}`}>
      {children}
    </tbody>
  );
}

interface TableRowProps {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function TableRow({ children, className = '', onClick }: TableRowProps) {
  return (
    <tr className={`hover:bg-gray-50 ${onClick ? 'cursor-pointer' : ''} ${className}`} onClick={onClick}>
      {children}
    </tr>
  );
}

interface TableHeadProps {
  children: ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
}

export function TableHead({ children, className = '', align = 'left' }: TableHeadProps) {
  const alignClass = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  return (
    <th className={`px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${alignClass[align]} ${className}`}>
      {children}
    </th>
  );
}

interface TableCellProps {
  children: ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
  colSpan?: number;
  onClick?: (e: MouseEvent) => void;
}

export function TableCell({ children, className = '', align = 'left', colSpan, onClick }: TableCellProps) {
  const alignClass = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  return (
    <td colSpan={colSpan} onClick={onClick} className={`px-6 py-4 whitespace-nowrap text-sm text-gray-900 ${alignClass[align]} ${className}`}>
      {children}
    </td>
  );
}
