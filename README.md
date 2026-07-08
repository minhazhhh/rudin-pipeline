# Rudin Pipeline

A database-backed rebuild of the NYC Conversion Pipeline dashboard. The public
site (`/`) looks and behaves exactly like the original static HTML, but its
data now lives in a real database instead of being hand-edited and
re-exported. Data can be edited two ways:

1. **Admin panel** (`/admin`) — spreadsheet-style editable tables, password protected.
2. **Google Sheets sync** — publish a sheet tab to the web as CSV, paste the
   URL into `/admin/sync`, click "Sync now". Syncing **fully replaces** that
   table's data with what's in the sheet.

## Architecture

- **Next.js 16** (App Router) + TypeScript.
- **Prisma 7** ORM. Local dev uses SQLite (`prisma/dev.db`); production should
  use Postgres (see below) — Prisma 7 requires a "driver adapter" rather than
  a bare connection string, see `app/lib/prisma.ts`.
- The public dashboard (`app/route.ts`) is **not** a React page — it reads
  `app/lib/dashboard-template.html` (the original static file with a few
  tokens like `__DATA_JSON__` swapped in for the hardcoded data), fills those
  tokens with live data queried from the database on every request
  (`app/lib/render-data.ts`), and returns it as raw HTML. This preserves the
  original file's exact map/chart/filter JavaScript untouched.
- `/admin/*` is a normal React app, protected by `proxy.ts` (Next's
  replacement for `middleware.ts` as of v16), which checks a signed session
  cookie set on login.

### Data model

Two datasets, six tables (`prisma/schema.prisma`):

- **Pipeline** — `Project`: the ~36 buildings shown on the map/list.
- **Comps / rent analytics** (the "Rent Comparables" tab) — `CompBuilding`,
  `CompBuildingStat` (per building × unit type), `OverallUnitStat` (market-wide
  by unit type), `TypeUnitStat` (by property type × unit type), `TrendPoint`
  (quarterly rent trend).

`Project.compBuildingName` cross-references a `CompBuilding.name` for the
handful of pipeline projects that also appear as rent comps (e.g. 355
Lexington Ave).

## Local development

```bash
npm install
npx prisma generate
npm run dev
```

Requires a `.env` with:

```
DATABASE_URL="file:./dev.db"
ADMIN_PASSWORD=some-password
SESSION_SECRET=<openssl rand -hex 32>
```

To (re)seed the database from the original static file's embedded data:

```bash
npx tsx scripts/extract-legacy-data.ts   # rudin_combined.html -> data/legacy-data.json
npx tsx prisma/seed.ts                   # legacy-data.json -> database
```

(This is a one-time bootstrap script — you won't need it again once the
database is your source of truth.)

## Editing data

### Admin panel

Go to `/admin`, log in with `ADMIN_PASSWORD`. Each table (Projects, Comp
Buildings, Comp Building Stats, Overall Unit Stats, Type × Unit Stats, Rent
Trend) is an editable grid — edit a cell, click **Save** on that row. **+ Add
row** appends a blank row; save it to create it. **Delete** removes a row
immediately (with a confirm prompt).

### Google Sheets sync

For each of the 6 tables:

1. Click **Download current data as CSV** on `/admin/sync` to get a starter
   file with the right columns.
2. Import it into a Google Sheet (one tab per table works well).
3. **File → Share → Publish to web**, select that specific tab, format
   **CSV**, and copy the published URL.
4. Paste it into the matching field on `/admin/sync`, click **Save all URLs**,
   then **Sync now**.

Notes:

- Sync only reads the sheet — it never writes back to it.
- Syncing a table **deletes and replaces all rows** in that table. Any
  admin-panel edits made since the last sync will be lost if they're not also
  reflected in the sheet.
- `comp-building-stats` rows reference buildings **by name** (`buildingName`
  column) — sync the Comp Buildings sheet first, or the stats sync will
  reject unknown names.
- `Project.affBandsJson` is a JSON array in a single cell, only needed for
  projects with an affordability breakdown (rare — leave blank otherwise).

## Deploying (free tier)

This was built locally against SQLite so it could be tested without you first
setting up cloud accounts. Before deploying, switch to Postgres — SQLite's
on-disk file won't survive/scale on serverless hosts like Vercel.

1. **Get a free Postgres database.** Either works and plugs into Vercel the
   same way:
   - [Neon](https://neon.tech) (also what Vercel's own "Storage → Postgres"
     tab provisions)
   - [Supabase](https://supabase.com)

   Copy the connection string it gives you.

2. **Switch Prisma to Postgres:**

   ```bash
   npm install @prisma/adapter-pg pg
   npm uninstall @prisma/adapter-better-sqlite3 better-sqlite3
   ```

   In `prisma/schema.prisma`, change:

   ```prisma
   datasource db {
     provider = "postgresql"
   }
   ```

   In `app/lib/prisma.ts`, swap the adapter:

   ```ts
   import { PrismaPg } from "@prisma/adapter-pg";
   // ...
   const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
   ```

   Then run against your new Postgres URL:

   ```bash
   npx prisma generate
   npx prisma migrate dev --name init
   npx tsx prisma/seed.ts   # optional, if starting from the original data
   ```

3. **Push this project to a GitHub repo** (it's already a git repo locally —
   `git remote add origin <your-repo-url> && git push -u origin main`).

4. **Import the repo into [Vercel](https://vercel.com)** (free tier). Set
   these environment variables in the Vercel project settings:
   - `DATABASE_URL` — your Postgres connection string
   - `ADMIN_PASSWORD` — a real password
   - `SESSION_SECRET` — `openssl rand -hex 32`

5. Deploy. `/` is your live dashboard; `/admin` is the editor.

## Project layout

```
app/route.ts                   public dashboard (SSR into legacy template)
app/lib/dashboard-template.html  original HTML with data tokens swapped in
app/lib/render-data.ts         DB -> legacy JSON shape (DATA/AGG/BSTATS/...)
app/lib/prisma.ts              Prisma client (driver-adapter based, Prisma 7)
app/lib/auth.ts                signed-cookie session helpers
app/api/**                     CRUD + sync + auth routes
app/admin/**                   admin panel (React)
proxy.ts                       protects /admin/* (Next 16's middleware.ts)
prisma/schema.prisma           data model
prisma/seed.ts                 one-time seed from data/legacy-data.json
scripts/extract-legacy-data.ts one-time extraction from the original HTML
```
