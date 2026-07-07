# Rebuild Notes — `fable-rebuild` branch

A ground-up rebuild of the Vendor Maintenance Tracker. **Every user-facing
feature is preserved**; the architecture, UX plumbing, and a number of latent
bugs are not. The default branch is untouched.

## TL;DR

| | Before | After |
|---|---|---|
| Architecture | Every page a `'use client'` monolith fetching from the browser | Server Components fetch as the user; all mutations are Server Actions |
| Biggest file | `visits/[id]/page.tsx` — 2,011 lines | 456 lines (decomposed into a server page + 6 focused islands) |
| Runtime deps | 9 (incl. Recharts, unused `uuid`) | 7 (Recharts → ~150 lines of dependency-free SVG/HTML charts) |
| Auth | Client-side `AuthContext` with fallback profiles, 5 s timeouts, cookie-presence-only middleware | Verified session in middleware; one per-request `getAuth()` on the server |
| Mutation feedback | `alert()` / `prompt()` / `confirm()` + 1–2 s `setTimeout` modal closes | Toasts, proper modals, native-`<dialog>` focus trap & Esc |
| Filters | Local component state (the dashboard's `?status=completed` link silently did nothing) | URL search params — linkable, reload-safe, and the dashboard links now work |

Total source is roughly the same size (9,339 → 8,855 lines) but now includes
capabilities the old app lacked (toast system, confirm dialogs, empty states,
CSV library, shared workflow engine) while deleting all duplicated fetch/
loading/permission plumbing.

## How to run

Unchanged:

```bash
npm install
cp .env.example .env.local   # fill in Supabase URL, anon key, service-role key
npm run dev
```

**Migration step (one-time, before deploying this branch):** run
`supabase/migrations/015_add_visit_completed_at.sql` in the Supabase SQL
Editor. It adds `maintenance_visits.completed_at` (backfilled from
`updated_at` for already-completed visits). It is additive and does not break
the old app. Migrations 001–014 are untouched.

Verification done here: `npm run build` (type-check + lint) is green, and the
production server was booted and smoke-tested (login page renders, root
redirects). It was **not** exercised against a live Supabase project — no
credentials exist on this machine — so give the workflow a manual pass after
deploying to a preview environment.

## Architecture: what changed and why

1. **React Server Components + Server Actions** (the defining swap).
   Before: every page was a client component that mounted, showed a spinner,
   ran 2–8 Supabase queries from the browser, and hand-managed
   `loading`/`error`/`success` state; mutations wrote to the DB from the
   browser and re-fetched everything. After: pages are `async` server
   components that fetch as the logged-in user (RLS still applies), and every
   mutation is a server action in `src/lib/actions/` that re-checks
   permissions, mutates, and returns `{ ok, message | error }` for the client
   to toast. Justification: deletes an entire class of client plumbing
   (AuthContext, per-page fetch functions, spinner state), gives loading
   skeletons and error boundaries for free (`loading.tsx`/`error.tsx`), and
   moves permission checks somewhere they can't be bypassed by the UI.
   The stack itself (Next 15 + Supabase + Tailwind) was kept — it fits.

2. **`AuthContext` deleted.** Its jobs are now: session verification in
   `src/middleware.ts` (the repo already contained the correct
   `updateSession` middleware — *unused*; the live one only checked that a
   cookie existed), a request-cached `getAuth()` in `src/lib/auth.ts`, and
   impersonation as an httpOnly cookie set by admin-checked server actions.
   The fallback-profile-from-metadata behaviour is preserved for resilience.

3. **Recharts → `src/components/charts/`** (~150 lines total, no deps).
   Three charts: a crosshair-tooltip SVG line chart, a single-hue bar list
   (replacing the pie — same data, easier to read and compare), and grouped
   horizontal bars with direct value labels. Colors are a CVD-validated
   palette; each multi-series chart has a "view data as table" fallback.
   Justification: Recharts was the largest dependency in the app and was used
   on one page.

4. **`/api/users` route → server actions** (`src/lib/actions/users.ts`).
   Same service-role behaviour (auto-confirmed email, profile insert), no
   hand-rolled fetch/JSON layer. The two cron routes remain (Vercel cron needs
   URLs) but now share one `authorizeCron()` helper and the same
   `generateVisits()` engine the Settings button uses.

5. **One source of truth for labels/colors/dates** (`src/lib/labels.ts`).
   Before, each page had its own `getStatusVariant`, `formatTaskType`, and
   `status.replace('_',' ')` variants — with drift (the dashboard was missing
   the `close_visit` label; some pages only replaced the first underscore).

6. **Shared CSV machinery** (`src/lib/csv.ts` + `BulkImportButton`). The three
   bulk imports (routines, users, vendors) had three hand-rolled parsers —
   the routines one broke on quoted commas. All three now use one quote-aware
   parser, and row resolution happens server-side in one action call instead
   of N sequential API calls from the browser.

## Behavioural diffs (all intentional)

Fixes to things that were broken:

- **Visits page now honours `?status=` links** (the dashboard's "Completed
  This Month" card previously linked to a filter that was ignored). Task and
  recommendation stat cards deep-link the same way.
- **"Completed This Month" counts real completions** via the new
  `completed_at` column instead of `updated_at` (which recounted a visit on
  any later edit).
- **Overdue is date-based everywhere** (strictly past due date), matching the
  daily expiry cron. Before, the UI used time-of-day comparisons, so a task
  due later today already showed "Overdue" while the cron disagreed.
- **Deleting a visit now removes its report rows and storage files** (they
  were orphaned before) and its delete errors are checked.
- **Deleting the last report rolls status back only from `report_uploaded`**
  (guarded with a status check instead of client-side count arithmetic).
- **Editing a routine no longer drops a deactivated assignee** from the
  dropdown (which silently forced a reassignment on save).

Deliberate workflow improvements (each also noted in-app where relevant):

- **Reassigning a visit's team moves open tasks** to the new assignees
  (previously tasks stayed pointed at people no longer on the visit).
- **Confirming a visit date completes the matching `confirm_visit_date`
  task** (previously it lingered as pending forever).
- **Creating recommendations completes an open `create_recommendations`
  task**, and a `no_action` review decision now also triggers the
  close-visit reminder (previously only complete/cancel from one specific
  page did).
- **Closing a visit stamps `completed_at`; reopening clears it.**
- **The technical review from the Recommendations page uses the same
  structured decision flow as the visit page.** The old page had a separate
  legacy form that set a recommendation to `approved` with no
  `review_decision`, bypassing the SAP-details requirement.
- **Action visibility now matches actual permissions.** Complete/cancel
  buttons on recommendations used to render for every viewer and fail at the
  database for most of them; they now appear only for the assigned
  maintenance engineer or an admin (matching RLS).
- **"No Report Available" only appears when there are no reports** (it used
  to be offered alongside existing uploads, letting both states coexist).

Removed (redundant or worse):

- The header's **decorative search box** (it had no handler).
- The **"Eye" view button on routines**, which opened the same fully-editable
  modal as Edit — misleading for read-only roles.
- The **dead `handleUpdateStatus`** on the visits page and the unused `uuid`
  dependency.
- The dual mobile-card/desktop-table markup on the visit detail page — tables
  scroll horizontally in a container instead (half the markup, same
  information).

## Data-model diff

One additive migration, `015_add_visit_completed_at.sql`:

- `maintenance_visits.completed_at TIMESTAMPTZ` — set on close, cleared on
  reopen, backfilled from `updated_at`, indexed. Used by the dashboard stat
  and available to analytics.

Everything else (tables, enums, RLS policies, audit triggers, storage
policies) is unchanged. TypeScript types gained the reschedule fields that
migration 003 added but the old types never declared.

## UX wins — before / after

- **Feedback:** browser `alert()`/`prompt()`/`confirm()` and modals that
  closed on a 1–2 second timer → success/error toasts on every action,
  modals that close immediately on success, and proper confirm dialogs with
  the consequences spelled out. Date entry via `prompt()` on the visits list
  is now a date-picker modal.
- **Loading/empty states:** a lone spinner (or silent zeros when data failed
  to load) → route-level skeletons, an error boundary with retry, and every
  empty list explaining what will appear there, with a call-to-action where
  the viewer can create the thing.
- **Navigation & filters:** filters live in the URL, dashboard stat cards
  deep-link to pre-filtered views, the visits list gained search, and the
  maintenance-reports list kept its sortable headers (now linkable too).
- **Accessibility & keyboard:** modals are native `<dialog>` (focus trap,
  Esc, backdrop click), icon buttons have labels/titles, notifications and
  toasts announce politely, calendar days have descriptive labels, and the
  calendar legend now covers all seven statuses (it showed 4 of 7 before).
- **Perceived speed:** first render arrives with data already in the HTML
  instead of a client spinner cascade, and the analytics page no longer ships
  a charting library to the browser.

## Complexity deleted

- `AuthContext.tsx` (223 lines of fallback profiles, timeouts, and
  console-log debugging) plus the `ClientLayout`/`DashboardLayout`/`Header`/
  `Sidebar` stack → one server layout + one `AppShell` client component.
- ~12 per-page hand-rolled fetch/refetch functions and ~40 `useState` flags
  for loading/error/success/modal bookkeeping.
- Three CSV parsers → one; three bulk-import modals → one shared component.
- Two divergent status-label/color maps per concept → `labels.ts`.
- 2,011-line page → 8 files, none over 460 lines.
- Dependencies: −2 runtime (recharts, uuid), −1 dev (@types/uuid).

## Commit guide

The branch is ordered bottom-up for review: foundation (middleware, auth,
workflow, labels) → server actions → UI kit & charts → app shell → pages
(dashboard/tasks → visits → the rest) → cron/API consolidation → docs. Each
commit is a coherent reviewable unit; the final tree is the build-verified
state.
