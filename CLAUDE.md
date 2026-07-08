# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

VendorTrak: a vendor maintenance tracker on **Cloudflare Workers** (Hono +
server-rendered JSX), **D1/SQLite**, **R2** for report files, one daily cron.
Runs fully locally via wrangler (D1 = a real SQLite file, R2 emulated). It was
rebuilt from a Next.js/Supabase app in 2026-07 and then heavily iterated with
the user — `REBUILD_NOTES.md` records the history; work happens on the
`fable-version` branch (never touch the old default branch).

## Commands

```bash
npm run dev                # wrangler dev at http://localhost:8787 (user runs it on --port 8788)
npm run typecheck          # tsc --noEmit - the fastest full check; there is no test suite
npm run db:migrate         # apply migrations/ to the local SQLite db (.wrangler/state)
npm run db:migrate:remote  # apply to the real D1 database (not yet created - wrangler.jsonc has a placeholder id)
npm run deploy             # wrangler deploy
```

Run wrangler/tsc from the repo root (`C:\Claude\VendorTrak\VendorTrak`) — the
shell often resets cwd to the parent folder, where `npx tsc` resolves to a
bogus npm package.

## Local dev environment (state you inherit)

- The user usually has `npx wrangler dev --port 8788` running; TS/JSX changes
  hot-reload, CSS/JS in `public/` need a hard refresh in their browser.
- Local DB test accounts (local dev database only, seeded during testing):
  `admin@example.com`/`admin-pass-123` (admin), and `cora@` (coordinator),
  `max@` (maintenance engineer), `tia@` (technical engineer) all
  `@example.com`/`password123`. The user also creates their own data — treat
  existing visits/vendors as theirs; clean up any test entities you create
  (visits can be deleted by admin; there is no user delete, only deactivate).
- Verify with curl + cookie jars: POST form-encoded bodies to endpoints and
  grep the returned HTML. All HTML renders as ONE line — use `grep -o | wc -l`
  for counting, never `grep -c`. When extracting uuids after a prefix, strip
  the prefix with sed; `grep -oE '[0-9a-f-]{36}'` on a hex-ish prefix like
  "replace-report-" matches a shifted window.
- Ad-hoc SQL: `npx wrangler d1 execute vendortrak --local --command "..."`
  (safe while dev server runs). Complex LIKE patterns through PowerShell can
  fail - prefer `--file`.

## Architecture

- `src/index.tsx` — mounts routes; everything after `requireAuth` needs a
  session; `/account/password`, impersonation endpoints; `scheduled()` cron
  (generateVisits + expireTasks + sweepCloseTasks daily 06:00 UTC).
- `src/db.ts` — **always mutate through `insertRow`/`updateRow`/`deleteRow`**:
  they maintain `updated_at` and write the append-only `audit_log` (actor =
  the REAL user). Raw `run()` only for reads and non-audited tables.
- `src/auth.ts` — PBKDF2 + DB-backed session cookies, `requireAuth`,
  `requireRole` (checks the REAL user; 'admin' in the list also accepts any
  user with the `is_admin` flag), CSRF origin check, `flash()`/`takeFlash()`.
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

## The workflow (learned through user iteration - preserve these rules)

Status machine: scheduled → date_confirmed → report_uploaded →
recommendations_created → in_review → completed; cancelled from any open
state; reschedule resets to scheduled.

- **Task chain**: every stage seeds the next task (confirm → upload_report due
  confirmed+`report_upload_weeks`; report/no-report → create_recommendations
  due +`recommendations_review_days`; send-for-review → technical_review;
  ready-to-close → close_visit). Deadlines come from `system_config`.
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
- Dates `'YYYY-MM-DD'` strings, timestamps ISO-8601 UTC, booleans 0/1.
  String comparison IS date comparison. Helpers in `src/dates.ts`.
- Schema changes: new numbered file in `migrations/` + update `src/types.ts`.
  Currently 0001–0009; 0002+ have never been applied remotely.
- Action endpoints: parse form → `withVisit(check, action)` (loads bundle,
  perms-checks, flashes, redirects to the referer or an action-supplied
  `{message, redirect}`) → mutate via audited helpers.
- No em dashes in UI text (user preference) - use plain hyphens. Empty cell
  placeholder is '-'.
- Commit style: logical chunks, imperative subject, body explains the why;
  the user pushes (`git push` hangs for Claude - ask the user to run it via
  `!`). Verify every change end-to-end with curl before committing.
