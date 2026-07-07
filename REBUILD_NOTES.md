# VendorTrak Rebuild Notes (`fable-version` branch)

A ground-up rebuild of the vendor maintenance tracker. **Every workflow the old
app supported still works**; the implementation underneath is completely
different, per the added requirement that the app **run fully locally on SQLite
and deploy to Cloudflare**.

| | Before | After |
|---|---|---|
| Framework | Next.js 15 (client-heavy React) on Vercel | Hono + server-rendered JSX on Cloudflare Workers |
| Database | Supabase Postgres (15 migrations, RLS) | Cloudflare D1 — real SQLite, local file in dev (1 migration) |
| Auth | Supabase Auth + client AuthContext | Session cookies + PBKDF2 (WebCrypto), first-run setup screen |
| File storage | Supabase Storage | Cloudflare R2 (emulated on disk locally) |
| Cron | 2 Vercel crons + secret-protected API routes | 1 Cloudflare cron trigger calling the workflow module directly |
| Authorization | Postgres RLS + scattered UI checks | One `visitPerms()` module, enforced on every POST |
| Audit trail | Postgres triggers | Data layer writes `audit_log` on every mutation + new admin viewer |
| Code | ~9,900 lines, 19 npm packages | ~4,400 lines, 4 npm packages (`hono`, + wrangler/typescript/types as dev) |
| Client JS | React runtime + Recharts (~300 KB+) | ~80 lines of progressive enhancement; works with JS disabled |

## How to run

```bash
npm install
npm run db:migrate     # applies migrations/ to a local SQLite file (.wrangler/state)
npm run dev            # http://localhost:8787 — D1 + R2 + cron all emulated locally
```

First visit redirects to **/setup** to create the admin account — no seeded or
hardcoded credentials exist anywhere. After that, admins create users from the
Users page (self-signup stays disabled, as in the old app).

**Deploy to Cloudflare:**

```bash
wrangler d1 create vendortrak          # paste the returned id into wrangler.jsonc
wrangler r2 bucket create vendortrak-reports
npm run db:migrate:remote
npm run deploy
```

The daily cron (visit generation + task expiry, 06:00 UTC) is declared in
`wrangler.jsonc` and needs no secrets — there is no `CRON_SECRET` anymore
because the scheduled handler runs inside the Worker rather than as a public
HTTP endpoint. Both jobs can also be run on demand from Settings.

## Architecture

```
src/
  index.tsx        entry: route mounting, impersonation, scheduled() cron handler
  types.ts         domain types + label maps
  db.ts            D1 helpers; insert/update/delete auto-write audit_log + updated_at
  auth.ts          PBKDF2 hashing, DB sessions, impersonation, CSRF, flash messages
  workflow.ts      visit generation, task expiry, task helpers, config, visitPerms()
  dates.ts, csv.ts ~100 lines replacing date-fns and ad-hoc CSV code
  ui.tsx           page shell (sidebar/topbar/notifications) + shared components
  routes/          one file per area: auth, dashboard, visits, tasks, routines,
                   recommendations, reports (+analytics), admin (users/vendors/settings/audit)
public/            app.css (hand-written, no framework), app.js (progressive enhancement)
migrations/        0001_init.sql — the whole schema
```

Pages are plain HTML rendered on the server; every action is an HTML form
POSTing to a permission-checked endpoint that redirects back with a flash
toast. `public/app.js` only adds niceties (dialogs, confirms, auto-submit
filters); nothing breaks without it.

## Data model changes

Same entities and relationships; SQLite conventions (TEXT uuids/dates,
INTEGER booleans). Differences:

- **Renamed** `maintenance_routines` → `routines`, `maintenance_visits` → `visits`.
- **users** now carries `password_hash` (Supabase Auth is gone); new `sessions` table.
- **visits** gained `completed_at` (fixes the dashboard "Completed This Month",
  which was hardcoded to 0 in the old app) and `UNIQUE(routine_id,
  scheduled_date)` so the generator can never double-create.
- **visit_reports** stores `file_key` (R2 object key), `file_size`,
  `content_type`; the legacy `report_file_path` columns (already dropped in old
  migration 013) stay gone.
- **system_config** is keyed by `config_key` directly (no surrogate id);
  validation (whole number 1–365) enforced in `setConfigValue`, mirroring the
  old DB trigger.
- **audit_log** is written by the data layer (actor = the real signed-in user,
  even while impersonating; `null` = cron) instead of Postgres triggers.
- RLS policies have no SQLite equivalent; enforcement moved into route
  handlers via `visitPerms()` / `requireRole()`. This is **stricter** than the
  old coarse RLS (which let any maintenance engineer edit any recommendation).

**Data migration from the old system** is not automated (Postgres → SQLite,
and auth passwords cannot be exported from Supabase). If existing production
data must move: export the old tables to CSV, use the built-in CSV imports for
users/vendors/routines, and re-generate visits; users get fresh passwords via
the admin Reset Password action.

## Behaviour preserved

- The full visit lifecycle and status machine, including reschedule (resets to
  `scheduled`, cancels + recreates the confirm task), "no report available",
  multi-report uploads (10 MB, pdf/doc/docx/xls/xlsx), and admin reopen.
- Recommendation flow: auto-send for technical review when the routine
  requires it, the three review decisions (`no_action` → completed,
  `request_sap` → SAP details required before completion, `other_action` →
  description + assignee), cancel with reason, and close-visit gating on all
  recommendations being resolved.
- Visit generation semantics (project from `start_date` at `interval_months`
  out to `call_horizon_months`; seed confirm task only if its due date is in
  the future) and daily task expiry to `overdue`.
- Role model, role-filtered navigation, admin-only user management (no
  self-signup), soft-delete (`is_active`) for users/vendors/routines,
  admin impersonation (view-as, with real-user auditing), notifications
  dropdown (my open tasks + reviews awaiting), CSV bulk import for routines /
  users / vendors with per-row validation and downloadable templates,
  analytics with 3/6/12-month ranges + CSV export, report browser with
  search/filter/sort.

## Behaviour changed or removed (and why)

- **Tasks default filter** is now "All open" (pending + in progress + overdue)
  instead of "pending" — with the expiry cron flipping tasks to `overdue`, the
  old default would hide exactly the tasks that most need attention.
- **Recommendations default filter** is "All active" (open + in review +
  approved) instead of "open", for the same reason.
- **Reassigning a visit team now moves open tasks** to the new assignees
  (old app left tasks pointing at the removed people — documented gap #9).
- **Confirming a date / uploading a report now completes the matching open
  task** automatically; completing/cancelling the last recommendation seeds
  the close-visit task from the visit page too (previously only from the
  recommendations page).
- **URL change:** analytics moved from `/reports` to `/analytics`; the report
  file browser is `/reports` (was `/reports/maintenance`).
- **New: Audit Log page** (admin) — the append-only trail existed in the DB
  but had no UI.
- **Removed: dead header search box** (rendered an input with no handler).
- **Removed: Recharts, date-fns, uuid, all Supabase SDKs** — charts are
  server-rendered SVG/CSS, date math is ~40 lines, ids come from
  `crypto.randomUUID()`.
- **Removed: `CRON_SECRET` and the cron HTTP endpoints** — the scheduled
  handler is not publicly reachable, so there is nothing to protect.
- Browser `prompt()`/`alert()` flows (cancel reason, some confirms in the old
  list pages) became proper modal forms with validation.

## UX: biggest before/after wins

1. **Zero-config first run.** Before: create a Supabase project, run 15
   migrations by hand in the dashboard SQL editor, set 4 env vars, then create
   users via service-role API. After: `npm run db:migrate && npm run dev`,
   create the admin on a setup screen.
2. **Every page answers "what do I do next".** The visit page shows only the
   actions the current user can take right now, a progress stepper, and a
   "Waiting for <person> to <action>" banner; dashboards/tasks default to what
   needs attention (overdue surfaced, not hidden).
3. **Immediate, consistent feedback.** Every action ends in a success/error
   toast; buttons disable and show progress on submit; destructive actions
   confirm; errors from the server land next to what you did instead of a raw
   `alert()`.
4. **Fast and resilient.** Server-rendered HTML with ~80 lines of JS instead
   of a client React app that fetched 4+ queries per page after hydration; the
   whole app works with JavaScript disabled.
5. **List pages are shareable.** Filters, calendar month, selected day, and
   sort live in the URL.

## Verification performed

- `tsc --noEmit` clean; app boots under `wrangler dev`.
- Scripted end-to-end pass: setup → login → create 3 users (each role) →
  vendor → routine → generate visits → confirm date → upload + download a
  report through R2 → recommendation auto-sent to review → review (`no_action`)
  → close visit → all pages render 200 → analytics/CSV exports work.
- Security checks: non-admin gets 403 on admin pages/actions and no admin nav;
  cross-origin POST rejected (CSRF); impersonation start/stop with banner, and
  role checks that must not be spoofed use the real user.

## Known limitations

- No email/notification delivery (same as the old app — the in-app
  notifications dropdown is the only channel). The old docs flagged this
  (gap #5); it needs an email provider decision, so it was left out of scope.
- No automated Postgres → SQLite data migration (see above).
- Sessions last 30 days; deactivating a user blocks them at the next request
  (sessions are checked against `is_active` on every request).
