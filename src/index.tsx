import { Hono } from 'hono';
import { requireAuth, requireRole, setImpersonation, flash, hashPassword, verifyPassword } from './auth';
import { first, updateRow } from './db';
import { generateVisits, expireTasks, sweepCloseTasks } from './workflow';
import type { App, Env, User } from './types';

import authRoutes from './routes/auth';
import dashboard from './routes/dashboard';
import visits from './routes/visits';
import tasks from './routes/tasks';
import routines from './routes/routines';
import recommendations from './routes/recommendations';
import reports from './routes/reports';
import admin from './routes/admin';

const app = new Hono<App>();

app.route('/', authRoutes);

// Everything below requires a signed-in session.
app.use('*', requireAuth);

// Users change their own password (the REAL account, never an impersonated one).
app.post('/account/password', async (c) => {
  const me = c.get('realUser');
  const form = await c.req.formData();
  const current = String(form.get('current_password') ?? '');
  const next = String(form.get('new_password') ?? '');
  const back = c.req.header('referer') ?? '/';
  if (!(await verifyPassword(current, me.password_hash))) {
    flash(c, 'Your current password is incorrect.', 'err');
  } else if (next.length < 8) {
    flash(c, 'New password needs at least 8 characters.', 'err');
  } else {
    await updateRow(c.env.DB, 'users', me.id, { password_hash: await hashPassword(next) }, me.id);
    flash(c, 'Password changed.');
  }
  const url = new URL(back, c.req.url);
  return c.redirect(url.origin === new URL(c.req.url).origin ? url.pathname + url.search : '/');
});

app.post('/impersonate', requireRole('admin'), async (c) => {
  const form = await c.req.formData();
  const targetId = String(form.get('user_id') ?? '');
  if (targetId) {
    const target = await first<User>(c.env.DB, 'SELECT * FROM users WHERE id = ?', targetId);
    if (target) {
      await setImpersonation(c.env.DB, c.get('sessionToken'), targetId);
      flash(c, `Now viewing as ${target.full_name}.`);
    }
  }
  return c.redirect('/');
});

app.post('/impersonate/stop', requireRole('admin'), async (c) => {
  await setImpersonation(c.env.DB, c.get('sessionToken'), null);
  flash(c, 'Stopped impersonating.');
  return c.redirect('/');
});

app.route('/', dashboard);
app.route('/visits', visits);
app.route('/tasks', tasks);
app.route('/routines', routines);
app.route('/recommendations', recommendations);
app.route('/', reports); // /reports (report browser) + /analytics
app.route('/', admin);   // /users /vendors /settings /audit + admin actions

app.onError((err, c) => {
  console.error(err);
  return c.text(err instanceof Error ? err.message : 'Something went wrong', 500);
});

export default {
  fetch: app.fetch,

  /** Daily cron (06:00 UTC): create upcoming visits, then flip past-due tasks to overdue. */
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      (async () => {
        const generated = await generateVisits(env.DB);
        const expired = await expireTasks(env.DB);
        await sweepCloseTasks(env.DB);
        console.log(`cron: created ${generated.created.length} visit(s), marked ${expired} task(s) overdue`,
          generated.errors.length ? { errors: generated.errors } : '');
      })()
    );
  },
};
