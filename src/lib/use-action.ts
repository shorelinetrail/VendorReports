'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toaster';
import type { ActionResult } from '@/lib/action-result';

/**
 * Standard way to invoke a server action from a client island:
 * toasts the outcome, refreshes server data on success, tracks pending state.
 */
export function useAction() {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  async function run(
    action: () => Promise<ActionResult>,
    opts?: { onSuccess?: () => void },
  ): Promise<ActionResult> {
    setPending(true);
    try {
      const result = await action();
      if (result.ok) {
        if (result.message) toast(result.message, 'success');
        opts?.onSuccess?.();
        router.refresh();
      } else {
        toast(result.error, 'error');
      }
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong';
      toast(message, 'error');
      return { ok: false, error: message };
    } finally {
      setPending(false);
    }
  }

  return { pending, run };
}
