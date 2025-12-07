'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Upload, Download } from 'lucide-react';
import { format } from 'date-fns';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { User, UserRole } from '@/types/database';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Badge from '@/components/ui/Badge';
import Alert from '@/components/ui/Alert';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';

interface UserFormData {
  email: string;
  full_name: string;
  role: UserRole;
  password?: string;
}

const initialFormData: UserFormData = {
  email: '',
  full_name: '',
  role: 'vendor_coordinator',
  password: '',
};

const roleOptions = [
  { value: 'admin', label: 'Admin' },
  { value: 'vendor_coordinator', label: 'Vendor Coordinator' },
  { value: 'maintenance_engineer', label: 'Maintenance Engineer' },
  { value: 'technical_engineer', label: 'Technical Engineer' },
];

export default function UsersPage() {
  const { hasRole, userProfile } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<UserFormData>(initialFormData);
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
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('full_name');

      if (error) throw error;
      setUsers(data || []);
    } catch (err) {
      console.error('Error fetching users:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (user?: User) => {
    if (user) {
      setEditingId(user.id);
      setFormData({
        email: user.email,
        full_name: user.full_name,
        role: user.role,
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
      if (editingId) {
        // Update existing user
        const { error } = await supabase
          .from('users')
          .update({
            full_name: formData.full_name,
            role: formData.role,
          })
          .eq('id', editingId);

        if (error) throw error;
        setSuccess('User updated successfully');
      } else {
        // Create new user via server API (to avoid logging out the admin)
        if (!formData.password || formData.password.length < 6) {
          throw new Error('Password must be at least 6 characters');
        }

        const response = await fetch('/api/users', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: formData.email,
            password: formData.password,
            full_name: formData.full_name,
            role: formData.role,
          }),
        });

        const result = await response.json();

        if (!response.ok) {
          throw new Error(result.error || 'Failed to create user');
        }

        setSuccess('User created successfully');
      }

      await fetchUsers();
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
    if (id === userProfile?.id) {
      alert('You cannot delete your own account');
      return;
    }

    if (!confirm('Are you sure you want to delete this user?')) return;

    try {
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', id);

      if (error) throw error;
      await fetchUsers();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Cannot delete user - they may be assigned to routines or visits';
      alert(message);
    }
  };

  const getRoleVariant = (role: UserRole): 'info' | 'success' | 'warning' | 'error' => {
    const variants: Record<UserRole, 'info' | 'success' | 'warning' | 'error'> = {
      admin: 'error',
      vendor_coordinator: 'info',
      maintenance_engineer: 'success',
      technical_engineer: 'warning',
    };
    return variants[role];
  };

  const handleDownloadTemplate = () => {
    const csvContent = `full_name,email,role,password
"John Doe","john@example.com","vendor_coordinator","password123"
"Jane Smith","jane@example.com","maintenance_engineer","password456"`;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users_template.csv';
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
      const requiredHeaders = ['full_name', 'email', 'role', 'password'];
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

      const validRoles = ['admin', 'vendor_coordinator', 'maintenance_engineer', 'technical_engineer'];

      // Parse and create users
      const results: { success: number; failed: number; errors: string[] } = {
        success: 0,
        failed: 0,
        errors: [],
      };

      for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const row: Record<string, string> = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx] || '';
        });

        // Validate row
        if (!row.full_name || !row.email || !row.role || !row.password) {
          results.errors.push(`Row ${i + 1}: Missing required field(s)`);
          results.failed++;
          continue;
        }

        if (!validRoles.includes(row.role)) {
          results.errors.push(`Row ${i + 1}: Invalid role "${row.role}". Must be one of: ${validRoles.join(', ')}`);
          results.failed++;
          continue;
        }

        if (row.password.length < 6) {
          results.errors.push(`Row ${i + 1}: Password must be at least 6 characters`);
          results.failed++;
          continue;
        }

        // Create user via API
        try {
          const response = await fetch('/api/users', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              email: row.email,
              password: row.password,
              full_name: row.full_name,
              role: row.role,
            }),
          });

          const result = await response.json();

          if (!response.ok) {
            results.errors.push(`Row ${i + 1} (${row.email}): ${result.error || 'Failed to create user'}`);
            results.failed++;
          } else {
            results.success++;
          }
        } catch (err) {
          results.errors.push(`Row ${i + 1} (${row.email}): Network error`);
          results.failed++;
        }
      }

      if (results.success === 0 && results.failed > 0) {
        throw new Error(`All users failed to create:\n${results.errors.slice(0, 5).join('\n')}${results.errors.length > 5 ? `\n... and ${results.errors.length - 5} more errors` : ''}`);
      }

      const successMessage = results.failed > 0
        ? `Created ${results.success} users. ${results.failed} failed.`
        : `Successfully created ${results.success} users`;

      setBulkSuccess(successMessage);
      await fetchUsers();
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
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-gray-600">Manage system users and roles</p>
        </div>
        {isAdmin && (
          <div className="flex items-center space-x-2">
            <Button variant="secondary" onClick={() => setBulkModalOpen(true)}>
              <Upload className="w-4 h-4 mr-2" />
              Bulk Upload
            </Button>
            <Button onClick={() => handleOpenModal()}>
              <Plus className="w-4 h-4 mr-2" />
              Add User
            </Button>
          </div>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Email</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Created</TableHead>
            {isAdmin && <TableHead align="right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.length === 0 ? (
            <TableRow>
              <TableCell colSpan={isAdmin ? 5 : 4} className="text-center text-gray-500">
                No users found.
              </TableCell>
            </TableRow>
          ) : (
            users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.full_name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Badge variant={getRoleVariant(user.role)}>
                    {user.role.replace(/_/g, ' ')}
                  </Badge>
                </TableCell>
                <TableCell>{format(new Date(user.created_at), 'MMM d, yyyy')}</TableCell>
                {isAdmin && (
                  <TableCell align="right">
                    <div className="flex items-center justify-end space-x-2">
                      <Button variant="ghost" size="sm" onClick={() => handleOpenModal(user)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                      {user.id !== userProfile?.id && (
                        <Button variant="ghost" size="sm" onClick={() => handleDelete(user.id)}>
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      )}
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
        title={editingId ? 'Edit User' : 'Add User'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          <Input
            label="Full Name"
            name="full_name"
            value={formData.full_name}
            onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
            required
            placeholder="John Doe"
          />

          <Input
            label="Email"
            name="email"
            type="email"
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            required
            disabled={!!editingId}
            placeholder="john@example.com"
          />

          {!editingId && (
            <Input
              label="Password"
              name="password"
              type="password"
              value={formData.password || ''}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required
              placeholder="At least 6 characters"
            />
          )}

          <Select
            label="Role"
            name="role"
            value={formData.role}
            onChange={(e) => setFormData({ ...formData, role: e.target.value as UserRole })}
            required
            options={roleOptions}
          />

          <div className="flex justify-end space-x-3 pt-4 border-t">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              {editingId ? 'Update' : 'Create'} User
            </Button>
          </div>
        </form>
      </Modal>

      {/* Bulk Upload Modal */}
      <Modal
        isOpen={bulkModalOpen}
        onClose={() => setBulkModalOpen(false)}
        title="Bulk Upload Users"
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
              <li><strong>full_name</strong> (required) - User&apos;s full name</li>
              <li><strong>email</strong> (required) - Email address</li>
              <li><strong>role</strong> (required) - One of: admin, vendor_coordinator, maintenance_engineer, technical_engineer</li>
              <li><strong>password</strong> (required) - At least 6 characters</li>
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
              Upload Users
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
