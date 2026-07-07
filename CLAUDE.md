# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commands

```bash
npm run dev                # wrangler dev at http://localhost:8787 (D1/R2/cron emulated locally)
npm run typecheck          # tsc --noEmit — the fastest full check; there is no test suite
npm run db:migrate         # apply migrations/ to the local SQLite db (.wrangler/state)
npm run db:migrate:remote  # apply to the real D1 database
npm run deploy             # wrangler deploy
```

To verify changes: `npm run typecheck`, then boot `npm run dev` and exercise
the flow with a browser or curl (cookie-based auth; POST endpoints accept
form-encoded bodies and redirect with a flash cookie).

## Architecture

Hono app on Cloudflare Workers, server-rendered JSX (`hono/jsx`, configured in
tsconfig), D1 (SQLite) via the `DB` binding, R2 via `REPORTS`. No client
framework: pages are HTML forms; `public/app.js` is optional enhancement only.

- `src/index.tsx` — mounts routes; everything after `requireAuth` needs a
  session. Also the `scheduled()` cron handler (visit generation + task expiry).
- `src/db.ts` — **always mutate through `insertRow`/`updateRow`/`deleteRow`**:
  they maintain `updated_at` and write the append-only `audit_log` (pass the
  *real* user as actor). Raw `run()` is for reads/joins and non-audited tables.
- `src/auth.ts` — sessions (PBKDF2 + DB-backed cookies), `requireAuth`,
  `requireRole` (checks the **real** user so impersonation can't escalate),
  CSRF origin check, `flash()`/`takeFlash()` for post-redirect toasts.
- `src/workflow.ts` — the domain core: `generateVisits`, `expireTasks`, task
  helpers, `getConfig`/`setConfigValue`, and `visitPerms()` — the single
  source of truth for who may do what on a visit. UI shows/hides based on it;
  every POST endpoint re-checks it.
- `src/ui.tsx` — `page()` renders the shell (nav is role-filtered there);
  shared primitives (`Card`, `Modal`, `Badge`, `Field`, `ActionButton`, icons).
  Reuse these rather than hand-rolling markup.
- `src/routes/` — one file per area. `visits.tsx` is the heart: the lifecycle
  detail page and every status transition as a POST endpoint.

### Conventions

- Effective vs real user: `c.get('user')` is who the UI acts as (may be an
  impersonated user); `c.get('realUser')` is the signed-in account — use it
  for `actor` in mutations and for authorization that must not be spoofed.
- Dates are `'YYYY-MM-DD'` strings, timestamps ISO-8601 UTC strings, booleans
  0/1 integers. Date math lives in `src/dates.ts` (string in, string out).
- Schema changes: add a new numbered file in `migrations/` **and** update the
  interfaces in `src/types.ts` (hand-maintained).
- Action endpoints follow one shape: parse form → check perms → mutate via the
  audited helpers → `flash()` → redirect back (see `withVisit` in
  `routes/visits.tsx`).
- Modals are `<dialog>` elements opened by `data-modal="<id>"` buttons;
  conditional form sections use `data-show-when="field:value1|value2"`.

The visit status machine and the domain rules are documented in
`REBUILD_NOTES.md`.
