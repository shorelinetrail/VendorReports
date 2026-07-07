# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Start dev server at http://localhost:3000
npm run build    # Production build (also the fastest full type-check)
npm run lint     # ESLint (eslint-config-next)
npm start        # Serve a production build
```

There is no test framework configured. To verify changes, rely on `npm run build` for type-checking and manual testing against a Supabase project.

### Environment

Copy `.env.example` to `.env.local`. The app needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to run, plus `SUPABASE_SERVICE_ROLE_KEY` for admin operations (user creation, visit generation) and an optional `CRON_SECRET` to protect the cron endpoints. The browser client (`src/lib/supabase/client.ts`) falls back to placeholder values so the build succeeds without env vars present.

### Database

Schema lives in `supabase/migrations/` as numbered SQL files (001–015). There is no local Supabase CLI workflow wired up — migrations are applied by pasting them into the Supabase dashboard SQL Editor, in order. When changing the schema, add a new numbered migration **and** update the TypeScript types in `src/types/database.ts` to match (the `Database` interface there is hand-maintained, not generated).

## Architecture

Next.js 15 App Router + Supabase (Postgres, Auth, Storage), deployed on Vercel. TypeScript throughout, Tailwind CSS, `date-fns` for date math. **Server Components + Server Actions** — pages fetch on the server as the logged-in user (RLS applies), and every mutation is a server action. There is no client-side data fetching except the login form and file downloads.

### Where things live

- `src/app/(dashboard)/*/page.tsx` — async Server Components: fetch data, compute permissions, render. Interactive parts (modals, forms, buttons) are small colocated `'use client'` islands that call server actions.
- `src/lib/actions/*.ts` — all mutations. Every action re-checks permissions server-side and returns an `ActionResult` (`{ ok, message | error }`) that the client toasts via `src/lib/use-action.ts`. Never mutate from a client component directly.
- `src/lib/workflow.ts` — shared domain logic: task creation/completion helpers, the close-visit reminder rule, and the visit-generation engine (used by both the cron route and the Settings trigger).
- `src/lib/labels.ts` — the single source of truth for status labels, badge variants, date formatting, and the date-based `isOverdue` rule. Never hand-roll a status string or `replace('_', ' ')`.
- `src/lib/config.ts` — the four `system_config` deadline settings with defaults.
- `src/components/ui/` — primitives (Button, Modal, Toaster, ConfirmDialog, EmptyState, FilterSelect, SearchInput, BulkImportButton, Table, …). `FilterSelect`/`SearchInput`/`SortHeader` bind to URL search params, so filters are shareable and survive reload.
- `src/components/charts/` — dependency-free SVG/HTML charts used by the Analytics page.

### Three Supabase clients — pick the right one

- `src/lib/supabase/server.ts` — cookie-bound server client. Used by all pages and actions via `getAuth()`/`requireAuth()` in `src/lib/auth.ts`; subject to RLS as the requesting user.
- `src/lib/supabase/admin.ts` — service-role client, bypasses RLS. Only used inside server code after an explicit authorization check (admin session or cron secret): user creation, visit generation.
- `src/lib/supabase/client.ts` — browser client. Only used by the login form (`signInWithPassword`) — the cookies it sets are what the server client reads.

### Auth, roles, impersonation

- `src/middleware.ts` verifies the session with `supabase.auth.getUser()` on every request (and refreshes tokens), redirecting unauthenticated users to `/login`. Real authorization is Postgres RLS plus explicit checks in server actions.
- `src/lib/auth.ts#getAuth()` resolves the request's `profile` (the acting user), `realProfile` (the genuine session user), and `isImpersonating`, cached per request. Admin **impersonation** is an httpOnly cookie (`vr-impersonate`) set by server actions in `src/lib/actions/session.ts`; it changes `profile` (and therefore nav/UI gating) but queries still run under the real session's RLS. Anything that must not be spoofable (Settings, impersonation itself) checks `realProfile`.
- The four roles are `admin`, `vendor_coordinator`, `maintenance_engineer`, `technical_engineer` (`UserRole` in `src/types/database.ts`). The role-to-page map is the `NAVIGATION` array in `src/components/layout/AppShell.tsx`.
- Public self-signup is disabled; admins create accounts via the Users page (`src/lib/actions/users.ts`, service role). `users`, `vendors`, and `maintenance_routines` are soft-deleted via `is_active`.
- Every write to core tables lands in the append-only `audit_log` via DB triggers (migration 008).

### The domain workflow (the core of this app)

The central state machine is the **visit lifecycle**, driven by `VisitStatus`:

```
scheduled → date_confirmed → report_uploaded → recommendations_created → in_review → completed
                                                                                     (or cancelled)
```

Routines define recurring maintenance plans (interval + start date + a "call horizon" of months ahead). `generateVisits()` in `src/lib/workflow.ts` projects scheduled dates per active routine, creates missing `maintenance_visits`, and seeds the first `confirm_visit_date` task. It runs daily via the Vercel cron (`vercel.json`, 06:00 UTC → `/api/visits/generate`) and manually from Settings. A second cron (07:00 UTC → `/api/tasks/expire`) flips past-due tasks to `overdue` — `isOverdue()` in labels.ts deliberately matches its date-based semantics.

`tasks` are per-step to-dos with deadlines from `system_config`. `recommendations` are action items from a visit's report, optionally routed through technical review (`requires_technical_review` on the routine; `review_decision` on the recommendation: `no_action` completes it, `request_sap` requires SAP details before completion, `other_action` records an assigned action). When every recommendation on a visit is resolved, a `close_visit` task reminds the maintenance engineer.

`src/app/(dashboard)/visits/[id]/` is the most important UI — a server page plus client islands (`WorkflowActions`, `RecommendationsSection`, `ReportsList`, …) driving all status transitions.

### Reports / file storage

Reports live in the private `reports` storage bucket, keyed `<visit_id>/<timestamp>.<ext>` so the storage RLS policy (migration 014) can scope uploads to the visit's assigned coordinator. Uploads go through the `uploadReport` server action (FormData; 10 MB / document MIME checks mirror the bucket limits). Downloads use short-lived signed URLs from `getReportDownloadUrl`. Metadata is in `visit_reports`.

## Conventions

- Path alias `@/*` maps to `src/*`.
- Reuse `src/components/ui/` primitives rather than hand-rolling styled elements; use `EmptyState` for empty lists and `useAction()` + toasts for mutation feedback.
- The Tailwind `primary` color scale is the brand color used throughout.
- List-page filters belong in URL search params (via `FilterSelect`/`SearchInput`), not local state.
