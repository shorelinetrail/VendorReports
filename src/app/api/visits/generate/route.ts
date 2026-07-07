import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron';
import { createAdminClient } from '@/lib/supabase/admin';
import { generateVisits } from '@/lib/workflow';

// Generates maintenance visits from active routines. Runs daily via the
// Vercel cron (vercel.json); admins can also trigger it from Settings.

export async function POST(request: NextRequest) {
  const auth = await authorizeCron(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const result = await generateVisits(createAdminClient());
    return NextResponse.json({
      message: `Generated ${result.created} visits`,
      created: result.created,
      visits: result.visits,
      skipped: result.skipped,
    });
  } catch (error) {
    console.error('Error generating visits:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate visits' },
      { status: 500 },
    );
  }
}

// GET kept for easy manual triggering with the same auth checks.
export async function GET(request: NextRequest) {
  return POST(request);
}
