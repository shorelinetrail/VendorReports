# VendorTrak

Track recurring vendor maintenance: routines generate visits, visits collect
reports and recommendations, recommendations get reviewed and closed out —
with per-role task lists and deadlines along the way.

Runs **fully locally** (D1 is a real SQLite file on disk, R2 and the cron are
emulated) and deploys unchanged to **Cloudflare Workers**.

## Quick start

```bash
npm install
npm run db:migrate     # create/upgrade the local SQLite database
npm run dev            # http://localhost:8787
```

The first visit walks you through creating the admin account. Admins then add
users, vendors and routines; the daily job (or the "Generate Visits Now" button
in Settings) creates the visits.

## Deploy to Cloudflare

```bash
wrangler d1 create vendortrak            # put the returned id in wrangler.jsonc
wrangler r2 bucket create vendortrak-reports
npm run db:migrate:remote
npm run deploy
```

The daily cron trigger (visit generation + overdue task flagging, 06:00 UTC)
is configured in `wrangler.jsonc` — no extra setup or secrets.

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
npm run dev            # wrangler dev (hot reload)
```

Stack: [Hono](https://hono.dev) with server-rendered JSX, Cloudflare D1
(SQLite), R2, a single hand-written stylesheet, and ~80 lines of client JS.
See `REBUILD_NOTES.md` for the full architecture and the history of this
rebuild, and `CLAUDE.md` for a code tour.
