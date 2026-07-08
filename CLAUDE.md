# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

VendorTrak: a vendor maintenance tracker on **Node.js** (Hono +
server-rendered JSX via tsx), **PostgreSQL**, report files on **local disk**,
one daily in-process job. It was rebuilt from a Next.js/Supabase app onto
Cloudflare Workers in 2026-07, then ported off Workers to Node + PostgreSQL
(2026-07-08) — `REBUILD_NOTES.md` records the history; work happens on the
`fable-version` branch (never touch the old default branch).

## Commands

```bash
npm run dev            # node --watch + tsx at http://localhost:8788 (restarts on TS/JSX changes)
npm run start          # same server without the watcher
npm run typecheck      # tsc --noEmit - the fastest full check
npm run db:migrate     # create the database if needed + apply migrations/ (tracked in schema_migrations)
```

End-to-end suite: `tests/e2e/run.sh` (bash) - 119 curl+psql checks covering
every workflow transition, permission denial and invariant. It needs a
throwaway instance (empty `vendortrak_test` DB + server on :8790 with
`FILES_DIR=data/test-reports`); the run.sh header has the exact commands.
Run it after any workflow/permission change; add a check with every fix.

Config via env vars, all defaulted for local dev (`src/env.ts`):
`DATABASE_URL` (postgres://postgres:postgres@localhost:5432/vendortrak),
`PORT` (8788), `FILES_DIR` (data/reports), `TRUST_PROXY` (unset; set to 1
only behind a TLS-terminating reverse proxy - `publicOrigin()` in auth.ts
then honors X-Forwarded-Proto/-Host for secure cookies + CSRF).

## Local dev environment (state you inherit)

- PostgreSQL 17 runs as the Windows service `postgresql-x64-17`; superuser
  `postgres`/`postgres` on localhost:5432. `psql` is at
  `C:\Program Files\PostgreSQL\17\bin\psql.exe` (not on PATH).
- The user usually has `npm run dev` running on port 8788; TS/JSX changes
  restart the server automatically, CSS/JS in `public/` need a hard refresh
  in their browser.
- Local DB test accounts (local dev database only):
  `admin@example.com`/`admin-pass-123` (admin), and `cora@` (coordinator),
  `max@` (maintenance engineer), `tia@` (technical engineer) all
  `@example.com`/`password123`. The user also creates their own data — treat
  existing visits/vendors as theirs; clean up any test entities you create
  (visits can be deleted by admin; there is no user delete, only deactivate).
- Verify with curl + cookie jars: POST form-encoded bodies to endpoints and
  grep the returned HTML. All HTML renders as ONE line — use `grep -o | wc -l`
  for counting, never `grep -c`. When extracting uuids after a prefix, strip
  the prefix with sed; `grep -oE '[0-9a-f-]{36}'` on a hex-ish prefix like
  "replace-report-" matches a shifted window. In Git Bash, curl `-F file=@...`
  needs a Windows-style path (`cygpath -m`), not /c/... .
- Ad-hoc SQL: `psql -U postgres -h localhost -d vendortrak -t -A -c "..."`
  with `PGPASSWORD=postgres` (safe while the dev server runs). Uploaded
  report files live under `data/reports/<visit_id>/` (gitignored).

## Architecture

- `src/server.ts` — Node entry point: pg Pool + disk bucket wired into Hono's
  env, static files from `public/`, and the daily job (generateVisits +
  expireTasks + sweepCloseTasks) run at startup and then once per UTC day.
- `src/index.tsx` — the Hono app: mounts routes; everything after
  `requireAuth` needs a session; `/account/password`, impersonation endpoints.
- `src/db.ts` — the `Db` class wraps a pg Pool and rewrites D1/SQLite-style
  `?`/`?N` placeholders to `$n` (string literals skipped), so queries keep the
  old style. **Always mutate through `insertRow`/`updateRow`/`deleteRow`**:
  they maintain `updated_at` and write the append-only `audit_log` (actor =
  the REAL user). Raw `run()` only for reads and non-audited tables.
  int8/numeric results are parsed to JS numbers.
- `src/storage.ts` — `Bucket`: report files on disk with the R2-shaped
  put/get/delete API the routes already used.
- `src/env.ts` — DATABASE_URL / PORT / FILES_DIR with local-dev defaults.
- `src/auth.ts` — PBKDF2 + DB-backed session cookies (WebCrypto, native in
  Node), `requireAuth`, `requireRole` (checks the REAL user; 'admin' in the
  list also accepts any user with the `is_admin` flag), CSRF origin check,
  `flash()`/`takeFlash()`.
- `src/types.ts` — hand-maintained interfaces + `isAdmin()` (role==='admin'
  OR is_admin flag) — the ONLY way to check admin powers.
- `src/workflow.ts` — the domain core: `generateVisits`, `expireTasks`,
  `sweepCloseTasks` (self-heals missing close tasks), task helpers
  (`createTask`, `createTaskOnce`, `completeOpenTasks`, `cancelOpenTasks`),
  `maybeCreateCloseTask`, `getConfig`/`setConfigValue`, and **`visitPerms()`**
  — the single source of truth for per-visit authorization. UI shows/hides on
  it; every POST re-checks it.
- `src/ui.tsx` — `page()` renders the shell (role-filtered nav, notification
  bell, impersonation bar, change-password modal, flash toast); primitives
  (`Card`, `Modal` incl. `autoOpen`, `Badge`, `Field`, `ActionButton`,
  `IconAction`, `IconModalBtn`, inline SVG `Icon` set). Row actions are
  icon-only with `title`/`aria-label` tooltips.
- `src/routes/` — one file per area. `visits.tsx` is the heart (~1400 lines):
  list + ad-hoc creation + the detail page + every transition endpoint.
- `public/app.css` (hand-written, no framework) and `public/app.js`
  (~120 lines progressive enhancement: dialogs incl. `data-open-on-load`
  auto-open prompts that strip their `prompt-*` query param on dismiss,
  `data-confirm`, `data-autosubmit`, `data-show-when` conditional fields,
  row-click nav via `tr[data-href]`/`tr[data-row-modal]`, click-to-expand
  `.desc-clip`). Everything works without JS.
- `scripts/migrate.ts` — creates the database if missing, applies pending
  `migrations/*.sql` in order, each in a transaction, recorded in
  `schema_migrations`.

## The workflow (learned through user iteration - preserve these rules)

Status machine: scheduled → date_confirmed → report_uploaded →
recommendations_created → in_review → completed; cancelled from any open
state; reschedule resets to scheduled.

- **Task chain**: every stage seeds the next task (confirm → upload_report due
  confirmed+`report_upload_weeks`; report/no-report → create_recommendations
  due +`recommendations_review_days`; send-for-review → technical_review;
  ready-to-close → close_visit). Deadlines come from `system_config`. EVERY
  new visit (generated, manual, ad-hoc) seeds a confirm task - due dates
  inside the confirmation window clamp to today rather than skipping the task.
- **Early reports are allowed but honest**: a report (or no-report) arriving
  while the visit is still `scheduled` advances it to `report_uploaded`,
  cancels the stale confirm task and seeds the recs check - and the stepper
  shows "Date Confirmed (skipped)" (dashed dot) since `confirmed_date` stays
  null. Deleting the last report rewinds to `date_confirmed` or `scheduled`
  depending on whether the date was ever confirmed. no-report is only valid
  pre-report (`scheduled`/`date_confirmed`, no existing reason).
- **Reschedule cancels ALL open tasks** (incl. review/respond/close from
  deeper stages) and clears `end_date`, then reseeds the confirm task. In-review
  recommendations stay reviewable from the visit page.
- **Team reassign moves open tasks EXCEPT respond tasks**
  (review_recommendations) - those follow the recommendation's
  `action_assigned_to_id`, which reassignment does not change.
- **Visits** are routine-generated OR **ad-hoc** (`routine_id` NULL; vendor,
  description, `requires_technical_review` and a required notification number
  live on the visit; anyone can create one). Every visit query app-wide uses
  `LEFT JOIN routines` + `COALESCE(r.vendor_id, v.vendor_id)` and labels
  ad-hoc rows `COALESCE(r.plan_number, 'Ad-hoc ' || v.notification_number,
  'Ad-hoc')`. In `loadVisit`, plan/vendor/review facts are normalised into
  `bundle.meta` — never touch `routine` directly on the detail page.
- Visits can span days (`end_date`, display via `fmtRange`, calendar chips on
  every day of the span).
- **Recommendations check**: every new report seeds a create_recommendations
  task; while one is open the visit is NOT closeable (`pendingRecsCheck` in
  visitPerms, enforced server-side). The ME either adds a recommendation or
  confirms "no further recommendations" WITH a required reason (stored as a
  visit comment), which flows into the auto-opening close prompt.
- **Closing** requires: post-report stage + every recommendation resolved
  (zero recommendations qualifies) + no open recs check. Closing sweeps
  leftover open tasks. The green ready-to-close banner + close_visit task +
  `?prompt-close=1` modal all key off `canClose`.
- **The task list has NO start/complete shortcuts** (user explicitly removed
  them - completing a task there bypassed the workflow). Tasks complete only
  via their real action; rows offer open-visit + reassign (admin or the
  visit's coordinator).
- Recommendation rules: complete/cancel = visit ME or admin; edit = ME/TE/
  admin until resolved; review = TE/admin; a review that assigns an action
  requires the assignee's response before completion; `request_sap` requires
  SAP details before completion; reopen (recs and visits) is team-scoped and
  audit-derived in the activity log.
- Reports: coordinator/admin can upload at ANY time except on cancelled
  visits; the upload modal offers additional-vs-replacement (old file kept,
  badged Replaced); post-stage uploads trigger the `?prompt-recs=1` dialog.
- Impersonation is view-as: authorize actions as the effective user, audit as
  `realUser`; `requireRole`/settings check the real user.

## Conventions

- Effective vs real user: `c.get('user')` acts, `c.get('realUser')` audits
  and gates non-spoofable authority.
- Dates `'YYYY-MM-DD'` strings, timestamps ISO-8601 UTC, booleans 0/1 —
  columns are TEXT/INTEGER on purpose (semantics carried over from SQLite;
  string comparison IS date comparison). Helpers in `src/dates.ts`.
- SQL keeps `?` placeholders (`src/db.ts` rewrites them). Postgres dialect
  notes: use ILIKE for case-insensitive search; email uniqueness is a
  `lower(email)` unique index (lookups use `lower(email) = lower(?)`);
  duplicate-key errors are matched case-insensitively on 'unique'.
- Schema changes: new numbered file in `migrations/` + update `src/types.ts`.
  The current schema is one consolidated file (0001) — the SQLite-era 0001–0009
  are in git history.
- Action endpoints: parse form → `withVisit(check, action)` (loads bundle,
  perms-checks, flashes, redirects to the referer or an action-supplied
  `{message, redirect}`) → mutate via audited helpers.
- No em dashes in UI text (user preference) - use plain hyphens. Empty cell
  placeholder is '-'.
- Commit style: logical chunks, imperative subject, body explains the why.
  Verify every change end-to-end with curl before committing. Ask before
  pushing unless the user has already told you to push.
