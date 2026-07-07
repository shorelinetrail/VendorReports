import type { SupabaseClient } from '@supabase/supabase-js';

// Deadline settings stored in system_config. Values are day/week offsets used
// when creating workflow tasks.
export const DEADLINE_DEFAULTS = {
  visit_confirmation_days: 14,
  report_upload_weeks: 2,
  recommendations_review_days: 7,
  technical_review_days: 7,
} as const;

export type DeadlineKey = keyof typeof DEADLINE_DEFAULTS;
export type Deadlines = Record<DeadlineKey, number>;

export const DEADLINE_META: Record<DeadlineKey, { label: string; description: string }> = {
  visit_confirmation_days: {
    label: 'Visit Confirmation Days',
    description: 'Days before visit due date for vendor coordinator to confirm the visit',
  },
  report_upload_weeks: {
    label: 'Report Upload Weeks',
    description: 'Weeks after visit date for report upload deadline',
  },
  recommendations_review_days: {
    label: 'Recommendations Review Days',
    description: 'Days for maintenance engineer to create recommendations after report upload',
  },
  technical_review_days: {
    label: 'Technical Review Days',
    description: 'Days for technical engineer to complete review after being assigned',
  },
};

export async function getDeadlines(supabase: SupabaseClient): Promise<Deadlines> {
  const { data } = await supabase.from('system_config').select('config_key, config_value');
  const result: Deadlines = { ...DEADLINE_DEFAULTS };
  for (const row of data ?? []) {
    const key = row.config_key as DeadlineKey;
    if (key in DEADLINE_DEFAULTS) {
      const parsed = parseInt(row.config_value, 10);
      if (Number.isFinite(parsed)) result[key] = parsed;
    }
  }
  return result;
}
