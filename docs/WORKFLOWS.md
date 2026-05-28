# System & Workflow Documentation

This document describes how the Vendor Maintenance Tracker actually behaves today —
the entities, the role model, each workflow step, and where the logic lives — followed
by a **Gaps & Recommendations** section to support review and improvement.

It reflects the code as implemented (not the idealized README). Where behavior is
subtle or surprising, the source file and function are cited.

---

## 1. Roles & Access Model

Four roles (`src/types/database.ts` → `UserRole`):

| Role | Primary responsibilities |
|------|--------------------------|
| `admin` | Full access: users, vendors, routines, system config, manual visit generation, impersonation, reopen/delete |
| `vendor_coordinator` | Confirm visit dates, upload reports, reschedule visits, manage routines |
| `maintenance_engineer` | Create recommendations from reports, send for review, complete/close visits |
| `technical_engineer` | Review recommendations and record a decision |

Access is enforced at **three layers**, and it's important to understand they are
not equivalent:

1. **Navigation** (`src/components/layout/Sidebar.tsx`) — hides menu items by role. Cosmetic only.
2. **Page/UI guards** — buttons and actions are gated by `hasRole()` and by comparing
   `userProfile.id` against the visit's assigned user IDs (see the `useMemo` permission
   block in `src/app/(dashboard)/visits/[id]/page.tsx:849`).
3. **Postgres Row Level Security** (`supabase/migrations/001_initial_schema.sql:148+`) —
   the real enforcement. Note the RLS policies are **coarse**: any authenticated user can
   *read* every table, and write access is granted by role for the whole table (e.g. any
   `maintenance_engineer` can edit *any* recommendation, not just ones on their visits).

`middleware.ts` only checks for the *presence* of an auth cookie; it performs no role or
session validation.

---

## 2. Core Entities

```
vendors ─┐
         ├─< maintenance_routines ─< maintenance_visits ─┬─< tasks
users ───┘   (recurring plan)        (one occurrence)    ├─< recommendations
                                                          └─< visit_reports
system_config  (global deadline settings, admin-editable)
```

- **maintenance_routines** — a recurring plan: `plan_number`, `vendor_id`, `interval_months`,
  `start_date`, `call_horizon_months`, the three assigned user IDs, `is_active`, and
  `requires_technical_review` (added in migration 002).
- **maintenance_visits** — one occurrence of a routine, carrying its own status, the
  confirmed date, report pointers, reschedule history (migration 003), `no_report_reason`
  (004), and `confirmed_at` (007).
- **tasks** — per-step to-dos with `task_type`, `assigned_to_id`, `due_date`, `status`.
- **recommendations** — action items raised from a report, with the technical-review
  decision fields (migration 006: `review_decision`, `review_action_description`,
  `action_assigned_to_id`).
- **visit_reports** — multiple report files per visit (migration 005). The legacy
  `report_file_path`/`report_uploaded_at` columns on `maintenance_visits` are kept in
  sync only for the **first** report, for backward compatibility.

---

## 3. The Visit Lifecycle (central workflow)

`VisitStatus` state machine:

```
scheduled → date_confirmed → report_uploaded → recommendations_created → in_review → completed
    │                                                                                    ▲
    └──────────────────────────── (reschedule resets to scheduled) ─────────────────────┘
                                              cancelled  ── terminal
```

All transitions are driven from `src/app/(dashboard)/visits/[id]/page.tsx`.

### Step 0 — Visit generation (automated)
`src/app/api/visits/generate/route.ts`, scheduled daily at 06:00 UTC via `vercel.json`.

- Walks every **active** routine, projects scheduled dates from `start_date` at
  `interval_months` spacing, out to `today + call_horizon_months`.
- Inserts any missing visit (deduped on `routine_id` + `scheduled_date`), copying the
  routine's three assigned users onto the visit.
- Seeds the first `confirm_visit_date` task for the vendor coordinator, due
  `visit_confirmation_days` before the visit — **only if that due date is still in the future**.
- Auth: allowed for Vercel cron (`x-vercel-cron` header), a `CRON_SECRET` bearer token,
  or an authenticated admin. Uses the **service-role** client and bypasses RLS.
- Can also be triggered manually by an admin from the Settings page.

> Creating or editing a routine does **not** create visits immediately — generation only
> happens on the cron run or a manual trigger.

### Step 1 → 2 — Confirm date
Vendor coordinator (or admin) clicks *Confirm Visit Date*. Sets `confirmed_date`,
`confirmed_at`, status → `date_confirmed`. **The date is captured via a browser
`prompt()`** (`handleConfirmDate`, line 178) — no validation or date picker.

### Step 2 → 3 — Upload report (or mark none)
`handleUploadReport` (line 200): uploads the file to the private `reports` storage bucket,
inserts a `visit_reports` row, and — for the first report only — updates the legacy visit
columns and sets status → `report_uploaded`.
Alternatively *No Report Available* (`handleNoReportAvailable`, line 714) records a reason
and advances status to `report_uploaded` with no file.

### Step 3 → 4/5 — Create recommendations
`handleCreateRecommendation` (line 324). Behavior **branches on the routine's
`requires_technical_review` flag**:
- If review required: recommendation starts `in_review` with `sent_for_review = true`,
  visit → `in_review`, and a `technical_review` task is created for the technical engineer,
  due `technical_review_days` out.
- If not required: recommendation starts `open`, visit → `recommendations_created`.

### Step 5 — Technical review
`handleSubmitReview` (line 442). The technical engineer records a structured
`review_decision`:
- `no_action` → recommendation marked `completed` immediately.
- `request_sap` → `approved`; a SAP notification number + due date must later be filled in
  (`handleSaveSapDetails`) before it can be completed.
- `other_action` → `approved` with an action description and an `action_assigned_to_id`.

Submitting a review also completes the matching pending `technical_review` task.

### Step 6 — Close visit
*Close Visit* (`handleCloseVisit`, line 587) is enabled for the maintenance engineer/admin
**only when every recommendation is `completed` or `cancelled`** (`allRecsDone`, line 870).
Sets visit → `completed` and closes any open `close_visit` task. Admins can *Reopen*
a completed visit (`handleReopenVisit`), which recomputes status back to `in_review` or
`recommendations_created`.

### Side transitions
- **Reschedule** (`handleRescheduleVisit`, line 645): sets a new `scheduled_date`, clears
  `confirmed_date`, resets status → `scheduled`, records `rescheduled_from`/`reason`,
  cancels the old confirm task and creates a fresh one.
- **Reassign team** (admin only, `handleReassignTeam`): swaps the three assigned users on
  the visit. Does **not** reassign existing open tasks to the new people.

An **activity log** is reconstructed on the client (`activities` memo, line 885) by
stitching together timestamps across the visit, reports, recommendations, and completed
tasks. It is *derived*, not a stored audit trail.

---

## 4. Tasks Workflow

- `task_type` ∈ `confirm_visit_date`, `upload_report`, `create_recommendations`,
  `review_recommendations`, `technical_review`, `close_visit`. (Note: `close_visit` exists
  in the TypeScript `TaskType` but **not** in the SQL `task_type` enum in migration 001 —
  see gaps.)
- In practice only `confirm_visit_date` (by the generator/reschedule) and `technical_review`
  (on send-for-review) are auto-created. The others are largely unused.
- The Tasks page lists tasks by due date and lets users mark them in-progress/complete.
- **"Overdue" is computed client-side** (`isBefore(due_date, today)`); no stored `overdue`
  status and nothing transitions tasks automatically when a deadline passes.

---

## 5. Supporting Workflows

- **Routines** (`routines/page.tsx`) — admins & vendor coordinators create/edit; CSV bulk
  upload validates that referenced vendors and engineer emails exist. Deleting a routine
  cascades to its visits/tasks/recommendations.
- **Recommendations** (`recommendations/page.tsx`) — cross-visit aggregate view with status
  filtering; review/complete/cancel actions are available here as well as on the visit page.
- **Dashboard** (`dashboard/page.tsx`) — stat cards, a 3-month interactive calendar of
  visits colored by status, upcoming visits (next 30 days), and the user's pending tasks.
- **Analytics** (`reports/page.tsx`) — monthly trend, status distribution, vendor
  performance charts; CSV export of summary + vendor breakdown; 3/6/12-month range.
- **Maintenance Reports** (`reports/maintenance/page.tsx`) — filterable list of visits that
  have reports, with per-file download.
- **Users** (`users/page.tsx` + `api/users`) — admin-only. Creation goes through a
  service-role API route so the admin's own session isn't disturbed; auto-confirms email.
  Hard delete only (blocked by FK if the user is referenced).
- **Vendors** (`vendors/page.tsx`) — admin-only CRUD; delete blocked if referenced by a routine.
- **Settings** (`settings/page.tsx`) — admin-only editing of the four `system_config`
  deadline values, plus the manual visit-generation trigger.

### Auth / onboarding
- **Self-signup is open to anyone** (`signup/page.tsx`) and the user **picks their own role**
  from coordinator / maintenance engineer / technical engineer (admin is not offered).
  Account creation depends on the Supabase email-confirmation setting.

---

## 6. Gaps & Recommendations

Ordered roughly by impact. Items are marked **[verified in code]** where confirmed, or
**[review]** where they depend on Supabase project configuration not visible in the repo.

> **Status update.** Migrations 008–013 and the accompanying UI changes resolved most of
> these: self-signup disabled & admin-only user creation (#1), RLS scoped to assigned IDs
> (#2), append-only `audit_log` (#3), daily task auto-expiry via `/api/tasks/expire` (#4),
> `close_visit` added to the enum (#6), "Completed This Month" now computed (#7), visit-date
> entry moved to a modal (#8), legacy report columns dropped / multi-report fully on
> `visit_reports` (#10), soft-delete for routines/users/vendors (#11), role-filtered
> assignment dropdowns (#12), config min/max validation in the form + a DB trigger (#13),
> and scoped report-storage uploads with bucket file-type/size limits (#15, migration 014).
> Still open: **#5 (notifications/email)**, **#9 (reassign does not move open tasks)**, and
> the configuration item #14 (email-confirmation policy).

### Security / integrity

1. **Self-assigned roles at signup [verified].** Anyone can register and choose
   `maintenance_engineer`/`technical_engineer`/`vendor_coordinator`. Combined with the
   coarse RLS below, a self-registered user gains write access to all routines/visits or
   all recommendations. *Recommendation:* default new signups to a low/no-privilege role
   and have an admin elevate, or disable open signup and create users via the admin API only.

2. **Coarse RLS — no row-level ownership [verified].** Read access is granted to every
   authenticated user on every table, and write access is per-role for the entire table
   (`migrations/001` policies). A maintenance engineer can edit recommendations on visits
   they're not assigned to. *Recommendation:* scope write policies to the assigned
   `*_id` columns, mirroring the UI's per-visit checks.

3. **No audit trail [verified].** No record of who created/edited/deleted routines, visits,
   recommendations, users, or changed config. The visit "activity log" is reconstructed
   client-side from timestamps and is incomplete (e.g. cancellations of the visit itself,
   reassignments, and config changes aren't captured). *Recommendation:* add an
   append-only audit/event table written via DB triggers or a shared server helper.

### Workflow correctness

4. **Tasks never auto-expire [verified].** "Overdue" is only a client-side computation;
   nothing flips task status or notifies anyone when a due date passes. The `overdue`
   enum value effectively goes unused. *Recommendation:* a scheduled job (alongside the
   existing cron) to mark overdue tasks and/or send reminders.

5. **No notifications of any kind [verified].** No email/in-app alerts for new assignments,
   upcoming visits, review requests, or overdue items — every deadline is silent. This is
   the single biggest functional gap for a deadline-driven system. *Recommendation:*
   email on task creation + a daily overdue digest.

6. **`close_visit` task type mismatch [verified].** Present in TS `TaskType` and referenced
   by `handleCloseVisit`/the activity log, but **absent from the SQL `task_type` enum**
   (migration 001). Any attempt to *insert* a `close_visit` task would fail at the DB.
   The code only ever *updates* such tasks, so it hasn't surfaced — but it's latent.
   *Recommendation:* add `close_visit` (and reconcile `review_recommendations`, also unused)
   to the enum, or remove the dead path.

7. **"Completed This Month" is hardcoded to 0 [verified].** `dashboard/page.tsx` never
   computes this stat (set to `0` at lines 73 and 116). The card always reads 0.
   *Recommendation:* count visits with status `completed` whose `updated_at` falls in the
   current month (or add a dedicated `completed_at` to visits).

8. **Visit-date entry via `prompt()` [verified].** `handleConfirmDate` collects the
   confirmed date with a raw browser prompt and no validation. *Recommendation:* use the
   existing modal + date `Input` pattern used elsewhere on the page.

9. **Reassigning a team doesn't move open tasks [verified].** `handleReassignTeam` updates
   the visit's assigned users but leaves existing pending tasks pointed at the previous
   assignees. *Recommendation:* reassign (or recreate) open tasks when the team changes.

10. **Legacy dual-write on reports [verified].** Report status/path is mirrored onto
    `maintenance_visits` for the *first* report only (migration 005 kept the old columns).
    Deleting down to zero reports resets status to `date_confirmed`, but the legacy fields
    and `visit_reports` can drift for multi-report visits. *Recommendation:* finish the
    migration — drop the legacy columns and read solely from `visit_reports`.

### Data model / lifecycle

11. **Hard deletes everywhere, with cascade [verified].** Deleting a routine cascades to all
    its visits/tasks/recommendations; users/vendors are blocked by FK but have no
    deactivate path. *Recommendation:* prefer soft-delete/`is_active` and archiving over
    destructive deletes for entities with history.

12. **No validation that assigned users hold the matching role [verified].** Routine and
    reassignment forms let any user be slotted into any of the three engineer slots; task
    types aren't checked against the assignee's role either. *Recommendation:* validate
    role per slot at write time.

13. **`system_config` values are unvalidated [verified].** Admins can set negative or absurd
    deadline values; they're parsed with `parseInt` and a fallback default. *Recommendation:*
    enforce sane min/max in the Settings form and/or a DB check constraint.

### Configuration to confirm (not visible in repo)

14. **Email confirmation policy [review].** Signup assumes Supabase email confirmation is
    enabled; verify the project setting matches the intended onboarding.

15. **Storage upload policy is permissive [verified].** The `reports` bucket INSERT policy
    allows *any* authenticated user to upload to any path under it (migration 001:208).
    *Recommendation:* scope by path/visit, and consider validating file type/size
    (server actions currently allow up to 10 MB per `next.config.ts`).

---

*Generated for review on 2026-05-28. File references point to the state of the repo at the
time of writing; line numbers in `visits/[id]/page.tsx` may shift as that file changes.*
