import { requireAuth } from '@/lib/auth';
import { getDeadlines } from '@/lib/config';
import type { DeadlineKey } from '@/lib/config';
import PageHeader from '@/components/ui/PageHeader';
import Alert from '@/components/ui/Alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import SettingsForm from './SettingsForm';
import GenerateVisitsButton from './GenerateVisitsButton';

export default async function SettingsPage() {
  const { supabase, realProfile } = await requireAuth();
  // Settings access follows the REAL profile — impersonation never grants or
  // hides system configuration.
  const isAdmin = realProfile.role === 'admin';

  const deadlines = await getDeadlines(supabase);
  const initial = Object.fromEntries(
    Object.entries(deadlines).map(([key, value]) => [key, String(value)]),
  ) as Record<DeadlineKey, string>;

  const steps = [
    { title: 'Visit Scheduled', text: 'Visits are created automatically from active routines, up to each routine’s call horizon.' },
    { title: 'Date Confirmation', text: `The vendor coordinator confirms the visit date. A confirmation task is due ${deadlines.visit_confirmation_days} days before the visit.` },
    { title: 'Report Upload', text: `After the visit, the coordinator uploads the maintenance report within ${deadlines.report_upload_weeks} week(s).` },
    { title: 'Recommendations', text: `The maintenance engineer records recommendations within ${deadlines.recommendations_review_days} days.` },
    { title: 'Technical Review', text: `Where required, the technical engineer reviews each recommendation within ${deadlines.technical_review_days} days.` },
    { title: 'Completion', text: 'Once every recommendation is completed or cancelled, the visit is closed.' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Workflow deadlines and system operations" />

      {!isAdmin && (
        <Alert variant="info">Settings are read-only. Contact an administrator to change them.</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workflow Deadlines</CardTitle>
        </CardHeader>
        <CardContent>
          <SettingsForm initial={initial} disabled={!isAdmin} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workflow Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {steps.map((step, index) => (
              <li key={step.title} className="flex gap-3">
                <span
                  className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white ${
                    index === steps.length - 1 ? 'bg-green-500' : 'bg-blue-500'
                  }`}
                >
                  {index + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-gray-900">{step.title}</p>
                  <p className="text-sm text-gray-500">{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Visit Generation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-gray-600">
              Visit generation runs automatically every day at 06:00 UTC. Run it manually after creating or editing
              routines to see their visits immediately.
            </p>
            <GenerateVisitsButton />
            <p className="text-xs text-gray-400">
              Automation: the Vercel cron calls <code>POST /api/visits/generate</code>; external schedulers can use a{' '}
              <code>CRON_SECRET</code> bearer token.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
