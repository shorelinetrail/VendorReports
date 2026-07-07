'use client';

import { useState } from 'react';
import { Pencil, Plus, UserCheck, Users as UsersIcon, UserX } from 'lucide-react';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import BulkImportButton from '@/components/ui/BulkImportButton';
import { Card, CardContent } from '@/components/ui/Card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table';
import { useAction } from '@/lib/use-action';
import { createUser, importUsers, toggleUserActive, updateUser } from '@/lib/actions/users';
import { formatDate, ROLE_LABELS, type BadgeVariant } from '@/lib/labels';
import type { User, UserRole } from '@/types/database';

const ROLE_VARIANTS: Record<UserRole, BadgeVariant> = {
  admin: 'error',
  vendor_coordinator: 'info',
  maintenance_engineer: 'success',
  technical_engineer: 'warning',
};

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as UserRole[]).map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

interface UsersViewProps {
  users: User[];
  isAdmin: boolean;
  selfId: string;
}

export default function UsersView({ users, isAdmin, selfId }: UsersViewProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState({ email: '', full_name: '', role: 'vendor_coordinator' as UserRole, password: '' });
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);
  const { pending, run } = useAction();

  function openForm(user: User | null) {
    setEditing(user);
    setForm({
      email: user?.email ?? '',
      full_name: user?.full_name ?? '',
      role: user?.role ?? 'vendor_coordinator',
      password: '',
    });
    setFormOpen(true);
  }

  return (
    <div className="space-y-6">
      {isAdmin && (
        <div className="flex flex-wrap justify-end gap-2">
          <BulkImportButton
            entityLabel="users"
            title="Bulk Upload Users"
            templateFilename="users_template.csv"
            templateRows={[
              ['full_name', 'email', 'role', 'password'],
              ['John Doe', 'john@example.com', 'vendor_coordinator', 'password123'],
              ['Jane Smith', 'jane@example.com', 'maintenance_engineer', 'password456'],
            ]}
            requiredHeaders={['full_name', 'email', 'role', 'password']}
            columnsHelp={[
              { name: 'full_name', description: 'Display name (required)' },
              { name: 'email', description: 'Sign-in email, must be unique (required)' },
              { name: 'role', description: 'admin, vendor_coordinator, maintenance_engineer, or technical_engineer' },
              { name: 'password', description: 'At least 6 characters (required)' },
            ]}
            importAction={importUsers}
          />
          <Button onClick={() => openForm(null)}>
            <Plus className="mr-2 h-4 w-4" />
            Add User
          </Button>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {users.length === 0 ? (
            <EmptyState icon={UsersIcon} title="No users found" />
          ) : (
            <Table className="border-0">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  {isAdmin && <TableHead align="right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.full_name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant={ROLE_VARIANTS[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={user.is_active !== false ? 'success' : 'cancelled'}>
                        {user.is_active !== false ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(user.created_at)}</TableCell>
                    {isAdmin && (
                      <TableCell align="right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Edit user"
                            aria-label={`Edit ${user.full_name}`}
                            onClick={() => openForm(user)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {user.id !== selfId &&
                            (user.is_active !== false ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Deactivate"
                                aria-label={`Deactivate ${user.full_name}`}
                                onClick={() => setDeactivateTarget(user)}
                              >
                                <UserX className="h-4 w-4 text-red-500" />
                              </Button>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                title="Reactivate"
                                aria-label={`Reactivate ${user.full_name}`}
                                disabled={pending}
                                onClick={() => run(() => toggleUserActive(user.id, true))}
                              >
                                <UserCheck className="h-4 w-4 text-green-500" />
                              </Button>
                            ))}
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

      <Modal open={formOpen} onClose={() => setFormOpen(false)} title={editing ? 'Edit User' : 'Add User'}>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const action = editing
              ? () => updateUser(editing.id, { full_name: form.full_name, role: form.role })
              : () => createUser(form);
            run(action, { onSuccess: () => setFormOpen(false) });
          }}
        >
          <Input
            label="Full Name"
            name="full_name"
            required
            value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            placeholder="John Doe"
          />
          <Input
            label="Email"
            name="email"
            type="email"
            required
            disabled={!!editing}
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            placeholder="john@example.com"
            helperText={editing ? 'Email cannot be changed' : undefined}
          />
          {!editing && (
            <Input
              label="Password"
              name="password"
              type="password"
              required
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="At least 6 characters"
            />
          )}
          <Select
            label="Role"
            name="role"
            required
            value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
            options={ROLE_OPTIONS}
          />
          <div className="flex flex-col-reverse justify-end gap-2 border-t pt-4 sm:flex-row sm:gap-3">
            <Button type="button" variant="secondary" onClick={() => setFormOpen(false)} className="w-full sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" loading={pending} className="w-full sm:w-auto">
              {editing ? 'Update User' : 'Create User'}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        title="Deactivate User"
        message={
          <>
            Deactivate <strong>{deactivateTarget?.full_name}</strong>? They will no longer appear in assignment
            lists. Their history is preserved and they can be reactivated later.
          </>
        }
        confirmLabel="Deactivate"
        variant="danger"
        pending={pending}
        onConfirm={() => {
          if (!deactivateTarget) return;
          run(() => toggleUserActive(deactivateTarget.id, false), { onSuccess: () => setDeactivateTarget(null) });
        }}
      />
    </div>
  );
}
