'use client';

import { Download } from 'lucide-react';
import Button from '@/components/ui/Button';
import { downloadTextFile, toCsv } from '@/lib/csv';

export default function ExportCsvButton({ filename, rows }: { filename: string; rows: (string | number)[][] }) {
  return (
    <Button variant="secondary" onClick={() => downloadTextFile(filename, toCsv(rows))}>
      <Download className="mr-2 h-4 w-4" />
      Export CSV
    </Button>
  );
}
