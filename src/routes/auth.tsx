/** Public routes: first-run setup, login, logout. */
import { Hono } from 'hono';
import {
  createSession, destroySession, findUserByEmail, flash, hashPassword,
  needsSetup, setSessionCookie, takeFlash, verifyPassword,
} from '../auth';
import { insertRow } from '../db';
import { authPage } from '../ui';
import type { App } from '../types';

const routes = new Hono<App>();

routes.get('/setup', async (c) => {
  if (!(await needsSetup(c.env.DB))) return c.redirect('/login');
  const err = takeFlash(c);
  return authPage(c, 'Welcome to VendorTrak', (
    <>
      <p class="muted" style="text-align:center; margin-bottom:1rem">
        No accounts exist yet. Create the administrator account to get started.
      </p>
      {err && <div class="error">{err.message}</div>}
      <form method="post" action="/setup">
        <label class="field">
          <span class="field__label">Full name</span>
          <input name="full_name" required autocomplete="name" placeholder="Jane Doe" />
        </label>
        <label class="field">
          <span class="field__label">Email</span>
          <input name="email" type="email" required autocomplete="email" placeholder="you@example.com" />
        </label>
        <label class="field">
          <span class="field__label">Password</span>
          <input name="password" type="password" required minlength={8} autocomplete="new-password" placeholder="At least 8 characters" />
        </label>
        <button type="submit" class="btn btn--primary" data-busy="Creating account…">Create admin account</button>
      </form>
    </>
  ));
});

routes.post('/setup', async (c) => {
  if (!(await needsSetup(c.env.DB))) return c.redirect('/login');
  const form = await c.req.formData();
  const fullName = String(form.get('full_name') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  if (!fullName || !email.includes('@') || password.length < 8) {
    flash(c, 'Please provide a name, a valid email and a password of at least 8 characters.', 'err');
    return c.redirect('/setup');
  }
  const user = await insertRow<{ id: string }>(c.env.DB, 'users', {
    email, full_name: fullName, role: 'admin', password_hash: await hashPassword(password), is_active: 1,
  }, null);
  setSessionCookie(c, await createSession(c.env.DB, user.id));
  flash(c, `Welcome, ${fullName}! Your admin account is ready.`);
  return c.redirect('/');
});

routes.get('/login', async (c) => {
  if (await needsSetup(c.env.DB)) return c.redirect('/setup');
  const err = takeFlash(c);
  const next = c.req.query('next') ?? '';
  return authPage(c, 'Sign in to VendorTrak', (
    <>
      {err && <div class="error">{err.message}</div>}
      <form method="post" action="/login">
        {next && <input type="hidden" name="next" value={next} />}
        <label class="field">
          <span class="field__label">Email</span>
          <input name="email" type="email" required autofocus autocomplete="email" placeholder="you@example.com" />
        </label>
        <label class="field">
          <span class="field__label">Password</span>
          <input name="password" type="password" required autocomplete="current-password" placeholder="Your password" />
        </label>
        <button type="submit" class="btn btn--primary" data-busy="Signing in…">Sign in</button>
      </form>
      <footer>Need an account? Contact your administrator.</footer>
    </>
  ));
});

routes.post('/login', async (c) => {
  const form = await c.req.formData();
  const email = String(form.get('email') ?? '');
  const password = String(form.get('password') ?? '');
  const next = String(form.get('next') ?? '');
  const user = await findUserByEmail(c.env.DB, email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    flash(c, 'Invalid email or password.', 'err');
    return c.redirect('/login');
  }
  if (!user.is_active) {
    flash(c, 'This account has been deactivated. Contact your administrator.', 'err');
    return c.redirect('/login');
  }
  setSessionCookie(c, await createSession(c.env.DB, user.id));
  return c.redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/');
});

routes.post('/logout', async (c) => {
  await destroySession(c, c.env.DB);
  return c.redirect('/login');
});

export default routes;
