'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlayCircle } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toaster';
import { triggerVisitGeneration } from '@/lib/actions/settings';
import type { GenerateResult } from '@/lib/workflow';

export default function GenerateVisitsButton() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<GenerateResult | null>(null);

  async function generate() {
    setPending(true);
    try {
      const outcome = await triggerVisitGeneration();
      if (outcome.ok) {
        setResult(outcome);
        toast(`Generated ${outcome.created} visit(s)`, 'success');
        router.refresh();
      } else {
        toast(outcome.error, 'error');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <Button onClick={generate} loading={pending}>
        <PlayCircle className="mr-2 h-4 w-4" />
        Generate Visits Now
      </Button>
      {result && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          <p className="font-medium">Generated {result.created} visit(s)</p>
          {result.visits.length > 0 && (
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {result.visits.map((visit) => (
                <li key={visit}>{visit}</li>
              ))}
            </ul>
          )}
          {result.skipped.length > 0 && (
            <p className="mt-1 text-xs text-green-700">Skipped: {result.skipped.join('; ')}</p>
          )}
        </div>
      )}
    </div>
  );
}
