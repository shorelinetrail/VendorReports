'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import Button from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toaster';
import { getReportDownloadUrl } from '@/lib/actions/reports';

export default function DownloadReportButton({ reportId, fileName }: { reportId: string; fileName: string }) {
  const { toast } = useToast();
  const [pending, setPending] = useState(false);

  async function download() {
    setPending(true);
    try {
      const result = await getReportDownloadUrl(reportId);
      if (result.ok) {
        window.location.assign(result.url);
      } else {
        toast(result.error, 'error');
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      title="Download report"
      aria-label={`Download ${fileName}`}
      loading={pending}
      onClick={download}
    >
      {!pending && <Download className="h-4 w-4 text-blue-500" />}
    </Button>
  );
}
