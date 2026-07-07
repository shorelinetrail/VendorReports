import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/Card';

export type StatColor = 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'teal' | 'orange' | 'gray';

const COLORS: Record<StatColor, string> = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  yellow: 'bg-yellow-500',
  red: 'bg-red-500',
  purple: 'bg-purple-500',
  teal: 'bg-teal-500',
  orange: 'bg-orange-500',
  gray: 'bg-gray-500',
};

interface StatCardProps {
  title: string;
  value: number | string;
  icon: LucideIcon;
  color: StatColor;
  href?: string;
}

export default function StatCard({ title, value, icon: Icon, color, href }: StatCardProps) {
  const body = (
    <Card className={`flex items-center gap-4 p-4 ${href ? 'transition-shadow hover:shadow-md' : ''}`}>
      <div className={`rounded-lg p-2.5 ${COLORS[color]}`}>
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-gray-500">{title}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
      {href && <ChevronRight className="h-5 w-5 flex-shrink-0 text-gray-300" />}
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}
