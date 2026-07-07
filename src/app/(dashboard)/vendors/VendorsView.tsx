'use client';

import { useState } from 'react';
import { Archive, ArchiveRestore, Building2, Pencil, Plus } from 'lucide-react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import BulkImportButton from '@/components/ui/BulkImportButton';
import { Card, CardContent } from '@/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useAction } from '@/lib/use-action';
import { importVendors, saveVendor, toggleVendorActive, type VendorInput } from '@/lib/actions/vendors';
import type { Vendor } from '@/types/database';

const EMPTY_VENDOR: VendorInput = { name: '', contact_email: '', contact_phone: '', address: '' };

interface VendorsViewProps {
  vendors: Vendor[];
  isAdmin: boolean;
}

export default function VendorsView({ vendors, isAdmin }: VendorsViewProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [form, setForm] = useState<VendorInput>(EMPTY_VENDOR);
  const [deactivateTarget, setDeactivateTarget] = useState<Vendor | null>(null);
  const { pending, run } = useAction();

  function openForm(vendor: Vendor | null) {
    setEditing(vendor);
    setForm(
      vendor
        ? {
            name: vendor.name,
            contact_email: vendor.contact_email ?? '',
            contact_phone: vendor.contact_phone ?? '',
            address: vendor.address ?? '',
          }
        : EMPTY_VENDOR,
    );
    setFormOpen(true);
  }

  return (
    <div className="space-y-6">
      {isAdmin && (
        <div className="flex flex-wrap justify-end gap-2">
          <BulkImportButton
            entityLabel="vendors"
            title="Bulk Upload Vendors"
            templateFilename="vendors_template.csv"
            templateRows={[
              ['name', 'contact_email', 'contact_phone', 'address'],
              ['Example Vendor', 'vendor@example.com', '+1 555-1234', '123 Main St, City, Country'],
            ]}
            requiredHeaders={['name']}
            columnsHelp={[
              { name: 'name', description: 'Vendor name (required)' },
              { name: 'contact_email', description: 'Optional' },
              { name: 'contact_phone', description: 'Optional' },
              { name: 'address', description: 'Optional' },
            ]}
            importAction={importVendors}
          />
          <Button onClick={() => openForm(null)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Vendor
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {vendors.length === 0 ? (
            <EmptyState
              icon={Building2}
              title="No vendors yet"
              description="Vendors are the external companies that perform maintenance."
            >
              {isAdmin && (
                <Button onClick={() => openForm(null)}>
                  <Plus className="mr-2 h-4 w-4" />
                  Add your first vendor
                </Button>
              )}
            </EmptyState>
          ) : (
            <Table className="border-0">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact Email</TableHead>
                  <TableHead>Contact Phone</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin && <TableHead align="right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((vendor) => (
                  <TableRow key={vendor.id}>
                    <TableCell className="font-medium">{vendor.name}</TableCell>
                    <TableCell>{vendor.contact_email ?? '-'}</TableCell>
                    <TableCell>{vendor.contact_phone ?? '-'}</TableCell>
                    <TableCell className="max-w-xs truncate">{vendor.address ?? '-'}</TableCell>
                    <TableCell>
                      <Badge variant={vendor.is_active !== false ? 'success' : 'cancelled'}>
                        {vendor.is_active !== false ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    {isAdmin && (
                      <TableCell align="right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Edit vendor"
                            aria-label={`Edit ${vendor.name}`}
                            onClick={() => openForm(vendor)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {vendor.is_active !== false ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Deactivate"
                              aria-label={`Deactivate ${vendor.name}`}
                              onClick={() => setDeactivateTarget(vendor)}
                            >
                              <Archive className="h-4 w-4 text-red-500" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Reactivate"
                              aria-label={`Reactivate ${vendor.name}`}
                              disabled={pending}
                              onClick={() => run(() => toggleVendorActive(vendor.id, true))}
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

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit Vendor' : 'Add Vendor'}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveVendor(editing?.id ?? null, form), { onSuccess: () => setFormOpen(false) });
          }}
        >
          <Input
            label="Vendor Name"
            name="name"
            required
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Enter vendor name"
          />
          <Input
            label="Contact Email"
            name="contact_email"
            type="email"
            value={form.contact_email}
            onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
            placeholder="vendor@example.com"
          />
          <Input
            label="Contact Phone"
            name="contact_phone"
            type="tel"
            value={form.contact_phone}
            onChange={(e) => setForm({ ...form, contact_phone: e.target.value })}
            placeholder="+1 (555) 000-0000"
          />
          <Textarea
            label="Address"
            name="address"
            rows={3}
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Enter vendor address"
          />
          <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row sm:gap-3">
            <Button type="button" variant="secondary" onClick={() => setFormOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={pending} className="w-full sm:w-auto">
              {editing ? 'Update Vendor' : 'Create Vendor'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        title="Deactivate Vendor"
        message={
          <>
            Deactivate <strong>{deactivateTarget?.name}</strong>? It will be hidden from new routine selection.
            Existing routines are unaffected and it can be reactivated later.
          </>
        }
        confirmLabel="Deactivate"
        variant="danger"
        pending={pending}
        onConfirm={() => {
          if (!deactivateTarget) return;
          run(() => toggleVendorActive(deactivateTarget.id, false), { onSuccess: () => setDeactivateTarget(null) });
        }}
      />
    </div>
  );
}
