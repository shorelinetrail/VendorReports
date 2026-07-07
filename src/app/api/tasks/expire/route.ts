import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron';
import { createAdminClient } from '@/lib/supabase/admin';

// Marks pending/in-progress tasks whose due date has passed as 'overdue'.
// Runs daily via the Vercel cron (vercel.json).

export async function POST(request: NextRequest) {
  const auth = await authorizeCron(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await createAdminClient()
      .from('tasks')
      .update({ status: 'overdue' })
      .lt('due_date', today)
      .in('status', ['pending', 'in_progress'])
      .select('id');
    if (error) throw new Error(error.message);

    const count = data?.length ?? 0;
    return NextResponse.json({ message: `Marked ${count} task(s) overdue`, updated: count });
  } catch (error) {
    console.error('Error expiring tasks:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to expire tasks' },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
