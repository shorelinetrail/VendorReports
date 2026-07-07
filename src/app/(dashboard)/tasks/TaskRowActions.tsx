'use client';

import Link from 'next/link';
import { CheckCircle, Eye, Play } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useAction } from '@/lib/use-action';
import { completeTask, startTask } from '@/lib/actions/tasks';

interface TaskRowActionsProps {
  taskId: string;
  visitId: string;
  status: string;
}

export default function TaskRowActions({ taskId, visitId, status }: TaskRowActionsProps) {
  const { pending, run } = useAction();
  const canStart = status === 'pending' || status === 'overdue';
  const canComplete = status === 'pending' || status === 'in_progress' || status === 'overdue';

  return (
    <div className="flex items-center justify-end gap-1">
      <Link href={`/visits/${visitId}`}>
        <Button variant="ghost" size="sm" title="View visit" aria-label="View visit">
          <Eye className="h-4 w-4" />
        </Button>
      </Link>
      {canStart && (
        <Button
          variant="ghost"
          size="sm"
          title="Start task"
          aria-label="Start task"
          disabled={pending}
          onClick={() => run(() => startTask(taskId))}
        >
          <Play className="h-4 w-4 text-blue-500" />
        </Button>
      )}
      {canComplete && (
        <Button
          variant="ghost"
          size="sm"
          title="Mark complete"
          aria-label="Mark task complete"
          disabled={pending}
          onClick={() => run(() => completeTask(taskId))}
        >
          <CheckCircle className="h-4 w-4 text-green-500" />
        </Button>
      )}
    </div>
  );
}
