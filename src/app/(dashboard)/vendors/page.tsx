'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Upload, Download } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Vendor } from '@/types/database';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Textarea from '@/components/ui/Textarea';
import Alert from '@/components/ui/Alert';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';

interface VendorFormData {
  name: string;
  contact_email: string;
  contact_phone: string;
  address: string;
}

const initialFormData: VendorFormData = {
  name: '',
  contact_email: '',
  contact_phone: '',
  address: '',
};

export default function VendorsPage() {
  const { hasRole } = useAuth();
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<VendorFormData>(initialFormData);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const supabase = createClient();

  const isAdmin = hasRole('admin');

  useEffect(() => {
    fetchVendors();
  }, []);

  const fetchVendors = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('vendors')
        .select('*')
        .order('name');

      if (error) throw error;
      setVendors(data || []);
    } catch (err) {
      console.error('Error fetching vendors:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (vendor?: Vendor) => {
    if (vendor) {
      setEditingId(vendor.id);
      setFormData({
        name: vendor.name,
        contact_email: vendor.contact_email || '',
        contact_phone: vendor.contact_phone || '',
        address: vendor.address || '',
      });
    } else {
      setEditingId(null);
      setFormData(initialFormData);
    }
    setError(null);
    setSuccess(null);
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSubmitting(true);

    try {
      const data = {
        name: formData.name,
        contact_email: formData.contact_email || null,
        contact_phone: formData.contact_phone || null,
        address: formData.address || null,
      };

      if (editingId) {
        const { error } = await supabase
          .from('vendors')
          .update(data)
          .eq('id', editingId);

        if (error) throw error;
        setSuccess('Vendor updated successfully');
      } else {
        const { error } = await supabase
          .from('vendors')
          .insert(data);

        if (error) throw error;
        setSuccess('Vendor created successfully');
      }

      await fetchVendors();
      setTimeout(() => {
        setModalOpen(false);
      }, 1000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this vendor?')) return;

    try {
      const { error } = await supabase
        .from('vendors')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await fetchVendors();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Cannot delete vendor - it may be associated with maintenance routines';
      alert(message);
    }
  };

  const handleDownloadTemplate = () => {
    const csvContent = `name,contact_email,contact_phone,address
"Example Vendor","vendor@example.com","+1 555-1234","123 Main St, City, Country"`;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'vendors_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBulkUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bulkFile) return;

    setBulkError(null);
    setBulkSuccess(null);
    setBulkSubmitting(true);

    try {
      const text = await bulkFile.text();
      const lines = text.split('\n').filter(line => line.trim());

      if (lines.length < 2) {
        throw new Error('CSV file must have a header row and at least one data row');
      }

      // Parse header
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
      const requiredHeaders = ['name'];
      const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
      if (missingHeaders.length > 0) {
        throw new Error(`Missing required headers: ${missingHeaders.join(', ')}`);
      }

      // Parse CSV helper function
      const parseCSVLine = (line: string): string[] => {
        const values: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());
        return values;
      };

      // Parse data rows
      const vendorsToInsert: { name: string; contact_email?: string | null; contact_phone?: string | null; address?: string | null }[] = [];
      const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const row: Record<string, string> = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx] || '';
        });

        if (!row.name) {
          errors.push(`Row ${i + 1}: Missing vendor name`);
          continue;
        }

        vendorsToInsert.push({
          name: row.name,
          contact_email: row.contact_email || null,
          contact_phone: row.contact_phone || null,
          address: row.address || null,
        });
      }

      if (errors.length > 0 && vendorsToInsert.length === 0) {
        throw new Error(`All rows have errors:\n${errors.join('\n')}`);
      }

      // Insert vendors
      const { error: insertError } = await supabase
        .from('vendors')
        .insert(vendorsToInsert);

      if (insertError) throw insertError;

      const successMessage = errors.length > 0
        ? `Created ${vendorsToInsert.length} vendors. ${errors.length} rows had errors.`
        : `Successfully created ${vendorsToInsert.length} vendors`;

      setBulkSuccess(successMessage);
      await fetchVendors();
      setTimeout(() => {
        setBulkModalOpen(false);
        setBulkFile(null);
      }, 2000);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setBulkError(message);
    } finally {
      setBulkSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Vendors</h1>
          <p className="text-gray-600">Manage maintenance vendors</p>
        </div>
        {isAdmin && (
          <div className="flex items-center space-x-2">
            <Button variant="secondary" onClick={() => setBulkModalOpen(true)}>
              <Upload className="w-4 h-4 mr-2" />
              Bulk Upload
            </Button>
            <Button onClick={() => handleOpenModal()}>
              <Plus className="w-4 h-4 mr-2" />
              Add Vendor
            </Button>
          </div>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Contact Email</TableHead>
            <TableHead>Contact Phone</TableHead>
            <TableHead>Address</TableHead>
            {isAdmin && <TableHead align="right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {vendors.length === 0 ? (
            <TableRow>
              <TableCell colSpan={isAdmin ? 5 : 4} className="text-center text-gray-500">
                No vendors found.
              </TableCell>
            </TableRow>
          ) : (
            vendors.map((vendor) => (
              <TableRow key={vendor.id}>
                <TableCell className="font-medium">{vendor.name}</TableCell>
                <TableCell>{vendor.contact_email || '-'}</TableCell>
                <TableCell>{vendor.contact_phone || '-'}</TableCell>
                <TableCell className="max-w-xs truncate">{vendor.address || '-'}</TableCell>
                {isAdmin && (
                  <TableCell align="right">
                    <div className="flex items-center justify-end space-x-2">
                      <Button variant="ghost" size="sm" onClick={() => handleOpenModal(vendor)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDelete(vendor.id)}>
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Edit Vendor' : 'Add Vendor'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <Input
            label="Vendor Name"
            name="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
            placeholder="Enter vendor name"
          />

          <Input
            label="Contact Email"
            name="contact_email"
            type="email"
            value={formData.contact_email}
            onChange={(e) => setFormData({ ...formData, contact_email: e.target.value })}
            placeholder="vendor@example.com"
          />

          <Input
            label="Contact Phone"
            name="contact_phone"
            type="tel"
            value={formData.contact_phone}
            onChange={(e) => setFormData({ ...formData, contact_phone: e.target.value })}
            placeholder="+1 (555) 000-0000"
          />

          <Textarea
            label="Address"
            name="address"
            value={formData.address}
            onChange={(e) => setFormData({ ...formData, address: e.target.value })}
            placeholder="Enter vendor address"
            rows={3}
          />

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {editingId ? 'Update' : 'Create'} Vendor
            </Button>
          </div>
        </form>
      </Modal>

      {/* Bulk Upload Modal */}
      <Modal
        isOpen={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        title="Bulk Upload Vendors"
      >
        <form onSubmit={handleBulkUpload} className="space-y-4">
          {bulkError && <Alert variant="error">{bulkError}</Alert>}
          {bulkSuccess && <Alert variant="success">{bulkSuccess}</Alert>}

          <div className="bg-gray-50 p-4 rounded-lg">
            <h4 className="font-medium text-gray-900 mb-2">CSV Format</h4>
            <p className="text-sm text-gray-600 mb-2">
              Upload a CSV file with the following columns:
            </p>
            <ul className="text-sm text-gray-600 list-disc list-inside space-y-1">
              <li><strong>name</strong> (required) - Vendor name</li>
              <li><strong>contact_email</strong> - Contact email address</li>
              <li><strong>contact_phone</strong> - Contact phone number</li>
              <li><strong>address</strong> - Vendor address</li>
            </ul>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleDownloadTemplate}
              className="mt-3"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Template
            </Button>
          </div>

          <Input
            label="CSV File"
            name="csv_file"
            type="file"
            accept=".csv"
            onChange={(e) => setBulkFile(e.target.files?.[0] || null)}
            required
          />

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setBulkModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={bulkSubmitting} disabled={!bulkFile}>
              Upload Vendors
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
