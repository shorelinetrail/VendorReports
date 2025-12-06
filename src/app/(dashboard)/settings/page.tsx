'use client';

import { useEffect, useState } from 'react';
import { Save, RefreshCw, Eye, UserCheck } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { SystemConfig, User } from '@/types/database';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Select from '@/components/ui/Select';
import Alert from '@/components/ui/Alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';

interface ConfigSettings {
  visit_confirmation_days: string;
  report_upload_weeks: string;
  recommendations_review_days: string;
  technical_review_days: string;
}

const configDescriptions: Record<string, string> = {
  visit_confirmation_days: 'Days before visit due date for vendor coordinator to confirm the visit',
  report_upload_weeks: 'Weeks after visit date for report upload deadline',
  recommendations_review_days: 'Days for maintenance engineer to create recommendations after report upload',
  technical_review_days: 'Days for technical engineer to complete review after being assigned',
};

const configLabels: Record<string, string> = {
  visit_confirmation_days: 'Visit Confirmation Days',
  report_upload_weeks: 'Report Upload Weeks',
  recommendations_review_days: 'Recommendations Review Days',
  technical_review_days: 'Technical Review Days',
};

export default function SettingsPage() {
  const { hasRole, realUserProfile, isImpersonating, startImpersonation, stopImpersonation } = useAuth();
  const [config, setConfig] = useState<ConfigSettings>({
    visit_confirmation_days: '14',
    report_upload_weeks: '2',
    recommendations_review_days: '7',
    technical_review_days: '7',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const supabase = createClient();

  // Check if the REAL user is admin (not impersonated role)
  const isAdmin = realUserProfile?.role === 'admin';

  useEffect(() => {
    fetchConfig();
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin]);

  const fetchUsers = async () => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .order('full_name');

      if (error) throw error;
      setUsers(data || []);
    } catch (err) {
      console.error('Error fetching users:', err);
    }
  };

  const handleImpersonate = () => {
    const user = users.find(u => u.id === selectedUserId);
    if (user) {
      startImpersonation(user);
    }
  };

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('system_config')
        .select('*');

      if (error) throw error;

      if (data) {
        const configMap: ConfigSettings = { ...config };
        data.forEach((item: SystemConfig) => {
          if (item.config_key in configMap) {
            configMap[item.config_key as keyof ConfigSettings] = item.config_value;
          }
        });
        setConfig(configMap);
      }
    } catch (err) {
      console.error('Error fetching config:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setSaving(true);

    try {
      // Update each config value
      for (const [key, value] of Object.entries(config)) {
        const { error } = await supabase
          .from('system_config')
          .update({ config_value: value })
          .eq('config_key', key);

        if (error) {
          // If update fails, try insert (upsert)
          const { error: insertError } = await supabase
            .from('system_config')
            .insert({
              config_key: key,
              config_value: value,
              description: configDescriptions[key],
            });

          if (insertError) throw insertError;
        }
      }

      setSuccess('Settings saved successfully');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setConfig({
      visit_confirmation_days: '14',
      report_upload_weeks: '2',
      recommendations_review_days: '7',
      technical_review_days: '7',
    });
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
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-gray-600">Configure system-wide settings and timelines</p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>Task Timeline Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-gray-500">
            Configure the timeline settings for maintenance workflow tasks. These values determine when tasks are created and their due dates.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {Object.entries(config).map(([key, value]) => (
              <div key={key}>
                <Input
                  label={configLabels[key]}
                  name={key}
                  type="number"
                  min={1}
                  value={value}
                  onChange={(e) => setConfig({ ...config, [key]: e.target.value })}
                  disabled={!isAdmin}
                  helperText={configDescriptions[key]}
                />
              </div>
            ))}
          </div>

          {isAdmin && (
            <div className="flex justify-end space-x-3 pt-4 border-t">
              <Button variant="secondary" onClick={handleReset}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Reset to Defaults
              </Button>
              <Button onClick={handleSave} loading={saving}>
                <Save className="w-4 h-4 mr-2" />
                Save Settings
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workflow Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-medium">
                1
              </div>
              <div className="ml-4">
                <p className="font-medium text-gray-900">Visit Scheduled</p>
                <p className="text-sm text-gray-500">
                  A maintenance visit is created based on the routine schedule, {config.visit_confirmation_days} days before the scheduled date.
                </p>
              </div>
            </div>

            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-medium">
                2
              </div>
              <div className="ml-4">
                <p className="font-medium text-gray-900">Date Confirmation</p>
                <p className="text-sm text-gray-500">
                  Vendor Coordinator confirms the visit date with the vendor.
                </p>
              </div>
            </div>

            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-medium">
                3
              </div>
              <div className="ml-4">
                <p className="font-medium text-gray-900">Report Upload</p>
                <p className="text-sm text-gray-500">
                  Vendor Coordinator uploads the maintenance report within {config.report_upload_weeks} weeks after the visit.
                </p>
              </div>
            </div>

            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-medium">
                4
              </div>
              <div className="ml-4">
                <p className="font-medium text-gray-900">Recommendations</p>
                <p className="text-sm text-gray-500">
                  Maintenance Engineer creates recommendations within {config.recommendations_review_days} days.
                </p>
              </div>
            </div>

            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-medium">
                5
              </div>
              <div className="ml-4">
                <p className="font-medium text-gray-900">Technical Review</p>
                <p className="text-sm text-gray-500">
                  Technical Engineer reviews recommendations within {config.technical_review_days} days (if requested).
                </p>
              </div>
            </div>

            <div className="flex items-start">
              <div className="flex-shrink-0 w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-green-600 font-medium">
                6
              </div>
              <div className="ml-4">
                <p className="font-medium text-gray-900">Completion</p>
                <p className="text-sm text-gray-500">
                  Recommendations are marked as complete or cancelled, and the visit is finalized.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Admin: View As User (Impersonation) */}
      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Eye className="w-5 h-5 mr-2" />
              View As User (Testing)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-500">
              Temporarily view the system as another user to test permissions and see what they can access.
              Your admin session is preserved - you can stop impersonation at any time.
            </p>

            {isImpersonating ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <UserCheck className="w-5 h-5 text-yellow-600 mr-2" />
                    <span className="text-yellow-800">
                      Currently viewing as another user
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={stopImpersonation}
                  >
                    Stop Viewing As
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-end space-x-4">
                <div className="flex-1">
                  <Select
                    label="Select User"
                    value={selectedUserId}
                    onChange={(e) => setSelectedUserId(e.target.value)}
                    options={[
                      { value: '', label: 'Select a user...' },
                      ...users
                        .filter(u => u.id !== realUserProfile?.id)
                        .map(u => ({
                          value: u.id,
                          label: `${u.full_name} (${u.role.replace(/_/g, ' ')})`,
                        })),
                    ]}
                  />
                </div>
                <Button
                  onClick={handleImpersonate}
                  disabled={!selectedUserId}
                >
                  <Eye className="w-4 h-4 mr-2" />
                  View As User
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
