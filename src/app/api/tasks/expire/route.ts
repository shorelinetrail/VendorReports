import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Marks pending/in-progress tasks whose due date has passed as 'overdue'.
// Runs daily via the Vercel cron in vercel.json and can be triggered manually
// by an admin. Mirrors the auth approach of /api/visits/generate.

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    const isVercelCron = request.headers.get('x-vercel-cron') === '1';
    const isCronJob = isVercelCron || (cronSecret && authHeader === `Bearer ${cronSecret}`);

    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // If not a cron job, require an authenticated admin.
    if (!isCronJob) {
      const token = authHeader?.replace('Bearer ', '');
      if (!token) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (authError || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const { data: profile } = await supabaseAdmin
        .from('users')
        .select('role')
        .eq('id', user.id)
        .single();

      if (profile?.role !== 'admin') {
        return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
      }
    }

    const today = new Date().toISOString().split('T')[0];

    const { data, error } = await supabaseAdmin
      .from('tasks')
      .update({ status: 'overdue' })
      .lt('due_date', today)
      .in('status', ['pending', 'in_progress'])
      .select('id');

    if (error) {
      throw new Error(`Failed to mark overdue tasks: ${error.message}`);
    }

    const count = data?.length || 0;
    return NextResponse.json({ message: `Marked ${count} task(s) overdue`, updated: count });
  } catch (error) {
    console.error('Error expiring tasks:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to expire tasks' },
      { status: 500 }
    );
  }
}

// Allow GET for easy manual triggering (with the same auth checks).
export async function GET(request: NextRequest) {
  return POST(request);
}
