'use client';

import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
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
        // Create new user via auth and then add to users table
        if (!formData.password || formData.password.length < 6) {
          throw new Error('Password must be at least 6 characters');
        }

        const { data: authData, error: authError } = await supabase.auth.admin.createUser({
          email: formData.email,
          password: formData.password,
          email_confirm: true,
        });

        if (authError) {
          // Try regular signup if admin endpoint fails
          const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            email: formData.email,
            password: formData.password,
          });

          if (signUpError) throw signUpError;

          if (signUpData.user) {
            const { error: profileError } = await supabase
              .from('users')
              .insert({
                id: signUpData.user.id,
                email: formData.email,
                full_name: formData.full_name,
                role: formData.role,
              });

            if (profileError) throw profileError;
          }
        } else if (authData.user) {
          const { error: profileError } = await supabase
            .from('users')
            .insert({
              id: authData.user.id,
              email: formData.email,
              full_name: formData.full_name,
              role: formData.role,
            });

          if (profileError) throw profileError;
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
          <Button onClick={() => handleOpenModal()}>
            <Plus className="w-4 h-4 mr-2" />
            Add User
          </Button>
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
    </div>
  );
}
