# VendorTrak

Track recurring vendor maintenance: routines generate visits, visits collect
reports and recommendations, recommendations get reviewed and closed out —
with per-role task lists and deadlines along the way.

Runs on **Node.js + PostgreSQL**; report files are stored on local disk and a
daily in-process job keeps visits and deadlines current. Self-hostable on any
machine that has Node 20+ and a PostgreSQL server.

## Quick start

```bash
npm install
npm run db:migrate     # creates the database and applies migrations/
npm run dev            # http://localhost:8788
```

By default it connects to `postgres://postgres:postgres@localhost:5432/vendortrak`;
set `DATABASE_URL` to override (plus `PORT` and `FILES_DIR` if needed — see
`src/env.ts`).

## Deploying to a server

Requirements: Node.js 20+, a PostgreSQL database, and a persistent directory
for uploaded report files (`FILES_DIR`) — back up both. Run
`npm ci && npm run db:migrate && npm run start` under a process manager that
keeps it running (the daily visit-generation job runs in-process at 06:00
UTC). No outbound network access, email, or other services are needed; user
accounts are created in the app (first visit sets up the admin).

Behind a TLS-terminating reverse proxy, set **`TRUST_PROXY=1`** and make sure
the proxy sends `X-Forwarded-Proto` (and `X-Forwarded-Host` if it rewrites
the host): the app uses them for secure session cookies and its CSRF origin
check. Without that variable, forwarded headers are ignored — correct when
the app is exposed directly.

The first visit walks you through creating the admin account. Admins then add
users, vendors and routines; the daily job (or the "Generate Visits Now" button
in Settings) creates the visits.

## The workflow

```
scheduled → date_confirmed → report_uploaded → recommendations_created → in_review → completed
```

Four roles: **admin**, **vendor coordinator** (confirms dates, uploads
reports), **maintenance engineer** (raises recommendations, closes visits),
**technical engineer** (reviews recommendations). Deadlines are configurable
in Settings; every change to core data lands in the admin Audit Log.

## Development

```bash
npm run typecheck      # tsc --noEmit
npm run dev            # auto-restarts on source changes
```

Stack: [Hono](https://hono.dev) with server-rendered JSX on
[@hono/node-server](https://github.com/honojs/node-server), PostgreSQL via
node-postgres, a single hand-written stylesheet, and ~120 lines of client JS
(the app works with JavaScript disabled). See `REBUILD_NOTES.md` for the full
architecture and the history of this rebuild, and `CLAUDE.md` for a code tour.
