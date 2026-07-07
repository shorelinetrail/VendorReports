'use client';

import { useState } from 'react';
import { Archive, ArchiveRestore, Calendar, Pencil, Plus } from 'lucide-react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import BulkImportButton from '@/components/ui/BulkImportButton';
import { Card, CardContent } from '@/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useAction } from '@/lib/use-action';
import { importRoutines, toggleRoutineActive, type RoutineInput } from '@/lib/actions/routines';
import { formatDate } from '@/lib/labels';
import RoutineForm, { EMPTY_ROUTINE, type UserSelectOption, type VendorOption } from './RoutineForm';

export interface RoutineRow extends RoutineInput {
  id: string;
  vendorName: string;
  nextDue: string; // yyyy-MM-dd
  nextDueOverdue: boolean;
}

interface RoutinesViewProps {
  routines: RoutineRow[];
  vendors: VendorOption[];
  users: UserSelectOption[];
  canManage: boolean;
  templateRows: (string | number)[][];
}

export default function RoutinesView({ routines, vendors, users, canManage, templateRows }: RoutinesViewProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RoutineRow | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<RoutineRow | null>(null);
  const { pending, run } = useAction();

  function openForm(routine: RoutineRow | null) {
    setEditing(routine);
    setFormOpen(true);
  }

  return (
    <div className="space-y-6">
      {canManage && (
        <div className="flex flex-wrap justify-end gap-2">
          <BulkImportButton
            entityLabel="maintenance plans"
            title="Bulk Upload Maintenance Plans"
            templateFilename="maintenance-plans-template.csv"
            templateRows={templateRows}
            requiredHeaders={[
              'plan_number',
              'description',
              'vendor_name',
              'interval_months',
              'start_date',
              'vendor_coordinator_email',
              'maintenance_engineer_email',
              'technical_engineer_email',
            ]}
            columnsHelp={[
              { name: 'plan_number', description: 'Unique plan identifier (required)' },
              { name: 'description', description: 'What the plan covers (required)' },
              { name: 'vendor_name', description: 'Must match an existing vendor name (required)' },
              { name: 'interval_months', description: 'Months between visits (default 12)' },
              { name: 'start_date', description: 'First visit date, YYYY-MM-DD (required)' },
              { name: 'call_horizon_months', description: 'Months ahead to create visits (default 1)' },
              { name: 'vendor_coordinator_email', description: 'Email of an existing user (required)' },
              { name: 'maintenance_engineer_email', description: 'Email of an existing user (required)' },
              { name: 'technical_engineer_email', description: 'Email of an existing user (required)' },
              { name: 'is_active', description: 'true/false (default true)' },
              { name: 'requires_technical_review', description: 'true/false (default true)' },
            ]}
            importAction={importRoutines}
          />
          <Button onClick={() => openForm(null)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Routine
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {routines.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title="No maintenance routines"
              description="Routines define recurring maintenance plans. Visits are generated from them automatically."
            >
              {canManage && (
                <Button onClick={() => openForm(null)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add your first routine
                </Button>
              )}
            </EmptyState>
          ) : (
            <Table className="border-0">
              <TableHeader>
                <TableRow>
                  <TableHead>Plan Number</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Interval</TableHead>
                  <TableHead>Next Due</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead align="right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {routines.map((routine) => (
                  <TableRow key={routine.id}>
                    <TableCell className="font-medium">{routine.plan_number}</TableCell>
                    <TableCell className="max-w-xs truncate">{routine.description}</TableCell>
                    <TableCell>{routine.vendorName}</TableCell>
                    <TableCell>{routine.interval_months} months</TableCell>
                    <TableCell className={routine.nextDueOverdue ? 'font-medium text-red-600' : ''}>
                      {formatDate(routine.nextDue)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={routine.is_active ? 'success' : 'cancelled'}>
                        {routine.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell align="right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Edit routine"
                            aria-label={`Edit ${routine.plan_number}`}
                            onClick={() => openForm(routine)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {routine.is_active ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Archive (deactivate)"
                              aria-label={`Archive ${routine.plan_number}`}
                              onClick={() => setArchiveTarget(routine)}
                            >
                              <Archive className="h-4 w-4 text-red-500" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Reactivate"
                              aria-label={`Reactivate ${routine.plan_number}`}
                              disabled={pending}
                              onClick={() => run(() => toggleRoutineActive(routine.id, true))}
                            >
                              <ArchiveRestore className="h-4 w-4 text-green-500" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {formOpen && (
        <RoutineForm
          key={editing?.id ?? 'new'}
          open={formOpen}
          onClose={() => setFormOpen(false)}
          editingId={editing?.id ?? null}
          initial={
            editing
              ? {
                  plan_number: editing.plan_number,
                  description: editing.description,
                  vendor_id: editing.vendor_id,
                  interval_months: editing.interval_months,
                  start_date: editing.start_date,
                  call_horizon_months: editing.call_horizon_months,
                  vendor_coordinator_id: editing.vendor_coordinator_id,
                  maintenance_engineer_id: editing.maintenance_engineer_id,
                  technical_engineer_id: editing.technical_engineer_id,
                  is_active: editing.is_active,
                  requires_technical_review: editing.requires_technical_review ?? true,
                }
              : EMPTY_ROUTINE
          }
          vendors={vendors}
          users={users}
        />
      )}

      <ConfirmDialog
        open={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        title="Archive Routine"
        message={
          <>
            Archive <strong>{archiveTarget?.plan_number}</strong>? It will be marked inactive and no new visits will
            be generated for it. Existing visits, tasks, and recommendations are kept, and you can reactivate it
            later.
          </>
        }
        confirmLabel="Archive Routine"
        variant="danger"
        pending={pending}
        onConfirm={() => {
          if (!archiveTarget) return;
          run(() => toggleRoutineActive(archiveTarget.id, false), { onSuccess: () => setArchiveTarget(null) });
        }}
      />
    </div>
  );
}
