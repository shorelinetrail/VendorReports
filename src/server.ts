// Node entry point (was the Cloudflare Workers runtime): HTTP server, static
// files, environment wiring, and the daily background job.
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { Pool } from 'pg';
import app from './index';
import { Db } from './db';
import { Bucket } from './storage';
import { DATABASE_URL, FILES_DIR, PORT } from './env';
import { generateVisits, expireTasks, sweepCloseTasks } from './workflow';
import type { App, Env } from './types';

const env: Env = {
  DB: new Db(new Pool({ connectionString: DATABASE_URL, max: 10 })),
  REPORTS: new Bucket(FILES_DIR),
};

const root = new Hono<App>();
root.use('*', serveStatic({ root: './public' }));
root.route('/', app);

/**
 * Daily job (was the Workers cron trigger): create upcoming visits, flip
 * past-due tasks to overdue, self-heal missing close tasks. Runs on startup
 * (a local server is rarely awake at exactly 06:00 UTC) and then once per
 * UTC day, checked every minute. All three jobs are idempotent and can also
 * be triggered from Settings.
 */
let lastRunDay = '';
async function runDailyJobs() {
  lastRunDay = new Date().toISOString().slice(0, 10);
  try {
    const generated = await generateVisits(env.DB);
    const expired = await expireTasks(env.DB);
    await sweepCloseTasks(env.DB);
    console.log(`daily job: created ${generated.created.length} visit(s), marked ${expired} task(s) overdue`,
      generated.errors.length ? { errors: generated.errors } : '');
  } catch (err) {
    console.error('daily job failed:', err);
  }
}
setInterval(() => {
  if (new Date().toISOString().slice(0, 10) !== lastRunDay) void runDailyJobs();
}, 60_000);
void runDailyJobs();

serve({ fetch: (req) => root.fetch(req, env), port: PORT }, (info) => {
  console.log(`VendorTrak ready on http://localhost:${info.port}`);
});
