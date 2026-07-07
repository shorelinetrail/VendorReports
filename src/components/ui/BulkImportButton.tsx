'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Upload } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Alert from '@/components/ui/Alert';
import { useToast } from '@/components/ui/Toaster';
import { downloadTextFile, parseCsv, toCsv } from '@/lib/csv';
import type { ImportResult } from '@/lib/action-result';

interface BulkImportButtonProps {
  entityLabel: string; // e.g. "users"
  title: string; // modal title
  templateFilename: string;
  templateRows: (string | number)[][];
  requiredHeaders: string[];
  columnsHelp: { name: string; description: string }[];
  importAction: (rows: Record<string, string>[]) => Promise<ImportResult>;
}

/** Shared CSV bulk-import flow: template download, quote-aware parsing, server import, per-row errors. */
export default function BulkImportButton({
  entityLabel,
  title,
  templateFilename,
  templateRows,
  requiredHeaders,
  columnsHelp,
  importAction,
}: BulkImportButtonProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setFile(null);
    setResult(null);
    setParseError(null);
  }

  async function handleImport() {
    if (!file) return;
    setPending(true);
    setResult(null);
    setParseError(null);
    try {
      const text = await file.text();
      const { headers, rows } = parseCsv(text);
      const missing = requiredHeaders.filter((h) => !headers.includes(h));
      if (missing.length > 0) {
        setParseError(`Missing required column(s): ${missing.join(', ')}`);
        return;
      }
      const outcome = await importAction(rows);
      setResult(outcome);
      if (outcome.success > 0) {
        toast(`Imported ${outcome.success} ${entityLabel}`, 'success');
        router.refresh();
      }
      if (outcome.failed === 0) close();
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Could not read the CSV file');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Upload className="mr-2 h-4 w-4" />
        Bulk Upload
      </Button>
      <Modal open={open} onClose={close} title={title} size="lg">
        <div className="space-y-4">
          {parseError && <Alert variant="error">{parseError}</Alert>}
          {result && result.failed > 0 && (
            <Alert variant={result.success > 0 ? 'warning' : 'error'}>
              Imported {result.success} row(s); {result.failed} failed.
            </Alert>
          )}

          <div className="rounded-lg bg-gray-50 p-4 text-sm">
            <div className="mb-2 flex items-center justify-between">
              <p className="font-medium text-gray-900">CSV format</p>
              <button
                type="button"
                onClick={() => downloadTextFile(templateFilename, toCsv(templateRows))}
                className="flex items-center gap-1 text-primary-600 hover:text-primary-700"
              >
                <Download className="h-4 w-4" />
                Download template
              </button>
            </div>
            <ul className="space-y-1 text-gray-600">
              {columnsHelp.map((col) => (
                <li key={col.name}>
                  <code className="rounded bg-gray-200 px-1 text-xs">{col.name}</code> — {col.description}
                </li>
              ))}
            </ul>
          </div>

          <Input
            label="CSV File"
            name="csv"
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />

          {result && result.errors.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-red-200 bg-red-50 p-3">
              <p className="mb-1 text-sm font-medium text-red-800">Import errors ({result.errors.length}):</p>
              <ul className="space-y-0.5 text-xs text-red-700">
                {result.errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row sm:gap-3">
            <Button type="button" variant="secondary" onClick={close} className="w-full sm:w-auto">
              Close
            </Button>
            <Button type="button" loading={pending} disabled={!file} onClick={handleImport} className="w-full sm:w-auto">
              Import
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
