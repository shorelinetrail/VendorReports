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

Copy `.env.example` to `.env.local`. The app needs `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to run, plus `SUPABASE_SERVICE_ROLE_KEY` for admin operations (user creation, visit generation) and an optional `CRON_SECRET` to protect the visit-generation endpoint. The browser client (`src/lib/supabase/client.ts`) falls back to placeholder values so the build succeeds without env vars present.

### Database

Schema lives in `supabase/migrations/` as numbered SQL files. There is no local Supabase CLI workflow wired up — migrations are applied by pasting them into the Supabase dashboard SQL Editor, in order. When changing the schema, add a new numbered migration **and** update the TypeScript types in `src/types/database.ts` to match (the `Database` interface there is hand-maintained, not generated).

## Architecture

Next.js 15 App Router + Supabase (Postgres, Auth, Storage), deployed on Vercel. TypeScript throughout, Tailwind CSS, Recharts for analytics, `date-fns` for date math.

### Three Supabase clients — pick the right one

- `src/lib/supabase/client.ts` — browser client, a singleton. Used in all `'use client'` components via `createClient()`. Subject to RLS as the logged-in user.
- `src/lib/supabase/server.ts` — server client backed by Next.js cookies. Used in Server Components and route handlers that should act as the requesting user (subject to RLS).
- `createClient` from `@supabase/supabase-js` with `SUPABASE_SERVICE_ROLE_KEY` — the **admin** client, constructed inline inside API routes (`src/app/api/**`). Bypasses RLS. Only use it after manually verifying the caller is an admin (see `src/app/api/users/route.ts`).

### Auth and roles

`src/contexts/AuthContext.tsx` is the single source of truth for the current user on the client. Key behaviors to be aware of:

- It loads a **fallback profile** synthesized from auth `user_metadata` immediately, then replaces it with the DB row in the background (with a 5s timeout). Code reading `userProfile` may briefly see the fallback, which defaults `role` to `vendor_coordinator`.
- It supports **admin impersonation**: `userProfile` returns the impersonated profile when active, while `realUserProfile` is always the logged-in user. Authorization decisions that must not be spoofed (e.g. who can impersonate) check `realUserProfile`.
- `hasRole(roles)` is the standard gate for conditional UI.

`src/middleware.ts` only checks for the *presence* of a Supabase auth cookie to redirect unauthenticated users to `/login`; it does not verify the session. Real authorization is enforced by Postgres RLS and by explicit role checks in API routes.

The four roles are `admin`, `vendor_coordinator`, `maintenance_engineer`, `technical_engineer` (see `UserRole` in `src/types/database.ts`). The role-to-page mapping lives in the `navigation` array in `src/components/layout/Sidebar.tsx`.

Public self-signup is **disabled** — `/signup` just redirects to `/login`. Accounts are created only by an admin through the Users page, which calls the service-role `src/app/api/users/route.ts`. RLS write policies are scoped to the assigned `*_id` columns on a visit (see migration 009), mirroring the per-visit checks the UI performs.

Entities with history are **soft-deleted**: `users`, `vendors`, and `maintenance_routines` carry `is_active`, and the UI deactivates/reactivates rather than hard-deleting. Inactive users/vendors are excluded from assignment dropdowns. Deactivation is **archive-only** — it does not revoke an active session or block login (auth/RLS still authorize by role). To revoke a person's access, delete their auth user in the Supabase dashboard.

Every write to the core tables is recorded in an append-only `audit_log` table via DB triggers (migration 008); it captures the actor (`auth.uid()`, null for cron/service-role), action, and before/after row JSON. Only admins can read it, and UPDATE/DELETE on it are blocked.

### Routing layout

- `src/app/(auth)/` — login/signup, public.
- `src/app/(dashboard)/` — the authenticated app. `ClientLayout.tsx` wraps everything in `AuthProvider` + `DashboardLayout`, so all dashboard pages are client components with auth context available.
- `src/app/api/` — route handlers for operations needing the service role (`users/`, `visits/generate/`).

### The domain workflow (the core of this app)

This is a maintenance-tracking system. The central state machine is the **visit lifecycle**, driven by `VisitStatus`:

```
scheduled → date_confirmed → report_uploaded → recommendations_created → in_review → completed
                                                                                     (or cancelled)
```

Routines define recurring maintenance plans (interval + start date + a "call horizon" of months ahead to create visits). `src/app/api/visits/generate/route.ts` is the engine: it walks each active routine, projects scheduled dates from `start_date` out to the horizon, creates any missing `maintenance_visits`, and seeds the first `confirm_visit_date` task. It runs daily via the Vercel cron in `vercel.json` (06:00 UTC) and can be triggered manually by an admin.

`tasks` are the per-step to-dos assigned to specific users with deadlines; deadline offsets are configurable per the `system_config` table (keys like `visit_confirmation_days`, `report_upload_days`, etc.). A second daily cron (`src/app/api/tasks/expire/route.ts`, 07:00 UTC) flips past-due `pending`/`in_progress` tasks to the `overdue` status. `recommendations` are action items raised from a visit's report and optionally routed through a technical-review sub-workflow (`requires_technical_review` on the routine, `review_decision` on the recommendation).

`src/app/(dashboard)/visits/[id]/page.tsx` is the largest and most important UI — it renders the full visit detail and drives most status transitions, report uploads, and recommendation management.

### Reports / file storage

Maintenance reports are stored in a private Supabase Storage bucket named `reports` (created in migration 001). Object keys are `<visit_id>/<timestamp>.<ext>`; the storage INSERT policy (migration 014) restricts uploads to the visit's assigned vendor coordinator or an admin, and the bucket enforces a 10 MB limit and a document-only MIME allow-list. View is open to authenticated users; delete is admin-only. File metadata is tracked in the `visit_reports` table.

## Conventions

- Path alias `@/*` maps to `src/*`.
- UI primitives live in `src/components/ui/` (Button, Card, Modal, Table, Badge, etc.) — reuse these rather than hand-rolling styled elements.
- The Tailwind `primary` color scale is the brand color used throughout.
