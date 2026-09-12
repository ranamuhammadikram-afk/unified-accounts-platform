# Unified Accounts Platform — Deployment Guide

This is the online, multi-user replacement for the two offline HTML apps
(Bofuyih Khurais Camp and Mattam Altayaba Hofuf). It's a complete full-stack
application:

- **PostgreSQL** — one shared database, businesses kept apart by a `business_id`
  on every record.
- **Node/Express backend API** — authentication, permissions, transactions,
  reports, user management, audit trail.
- **React frontend** — the app your team actually uses in a browser, on
  desktop or mobile, styled to match the offline apps you already know.

Built for exactly the setup you asked for: **you as Super Admin** (see both
businesses, manage everything), and **one Business Admin per business**
(Khurais Camp manager, Hofuf manager — each sees only their own business).

This whole thing was built and tested here, but it needs to run on
infrastructure of your own — this chat environment cannot stay online
permanently. The steps below get it running on a VPS (or Railway/Render) in
about 15–20 minutes.

## What's in this folder

```
unified-accounts-platform/
├── backend/            Node/Express API + database schema + seed & import scripts
├── frontend/            React app (source)
├── docker-compose.yml   Runs database + backend + frontend together
├── .env.example         Copy to .env and fill in real values
└── legacy-data/         Put your exported JSON backups here (create if missing)
```

## 1. Prerequisites

You need a Linux server (a $5–10/month VPS from any provider works fine —
DigitalOcean, Hetzner, Linode, a Vultr box, etc.) with:

- Docker Engine + the Docker Compose plugin installed. Most providers offer a
  "Docker" image when creating the server; otherwise follow
  [docs.docker.com/engine/install](https://docs.docker.com/engine/install/).
- A domain name pointed at the server (recommended, so you can use HTTPS), or
  just the server's IP address for a quick test.

If you'd rather not manage a server yourself, Railway or Render can run the
same three pieces (Postgres + backend + frontend) as managed services — see
section 8 below.

## 2. Get the code onto your server

Copy this whole folder to the server (e.g. `scp -r unified-accounts-platform your-server:~/`),
or push it to a private git repository and `git clone` it there.

## 3. Configure your environment

```bash
cd unified-accounts-platform
cp .env.example .env
nano .env      # or any editor
```

Fill in, at minimum:

- `POSTGRES_PASSWORD` — any strong password.
- `JWT_SECRET` — a long random string. Generate one with `openssl rand -base64 48`.
- `CORS_ORIGIN` — the exact URL your team will type into their browser to
  reach the app, e.g. `https://accounts.yourcompany.com` or `http://203.0.113.10:8080`.
- `VITE_API_URL` — the exact URL the browser will use to reach the backend
  API, e.g. `https://api.yourcompany.com` or `http://203.0.113.10:4000`.

`CORS_ORIGIN` and `VITE_API_URL` must be real, reachable URLs — the browser
enforces this, so a typo here is the most common first problem (see
Troubleshooting).

## 4. Start everything

```bash
docker compose up -d --build
```

First run downloads images and builds the two app containers — a couple of
minutes. Check everything came up:

```bash
docker compose ps
docker compose logs -f backend    # Ctrl+C to stop following
```

The database schema is created automatically the first time (via
`backend/schema.sql`, mounted into Postgres's init folder).

## 5. Create your three accounts

```bash
docker compose exec backend npm run seed
```

This prints (once) the username and temporary password for:

- **Super Admin** (`owner_admin`) — you.
- **Business Admin — Bofuyih Khurais Camp** (`khurais_manager`).
- **Business Admin — Mattam Altayaba Hofuf** (`hofuf_manager`).

It's safe to re-run this command later — it skips any account that already
exists rather than resetting it. Copy these credentials somewhere safe right
now; they are never shown again (the script also writes them to
`backend/CREDENTIALS_DO_NOT_COMMIT.txt` inside the container — read it, hand
out the passwords, then delete that file).

Open `http://VITE_API_URL-without-the-api-part` — i.e. the frontend URL you
set as `CORS_ORIGIN` — and log in as `owner_admin`. You'll be forced to set a
new password immediately, then land on the Super Admin dashboard. Do the same
for `khurais_manager` and `hofuf_manager` — each will land directly on their
own business's entry screen.

## 6. Import your existing offline data

Both offline apps have an **Export Backup (JSON)** button (Backup & Settings
tab). Export from each, then:

```bash
mkdir -p legacy-data
cp /path/to/bkc_backup.json legacy-data/
cp /path/to/mah_backup.json legacy-data/

docker compose exec backend node scripts/import-legacy.js \
  --business=khurais-camp --file=/app/legacy-data/bkc_backup.json

docker compose exec backend node scripts/import-legacy.js \
  --business=hofuf --file=/app/legacy-data/mah_backup.json
```

Notes:
- The Khurais Camp app used one shared login, so its imported entries are all
  attributed to the `khurais_manager` account by default. To attribute them
  to someone else instead, add `--defaultUser=<username>`.
- The Hofuf app tracked who entered each transaction. Any name that doesn't
  already have an account is created automatically as a new staff user — the
  command prints each new username and temporary password once at the end.
- Anything that can't be mapped automatically (a corrupted row, an unexpected
  value) is written to `backend/import-review.json` instead of being
  silently dropped, so you can check it by hand.

Run each file exactly once — running the same file twice will create
duplicate entries, since there's nothing in the old export that uniquely
identifies a transaction.

## 7. Day-to-day use

- **You (Super Admin)** log in and land on `/admin`: a dashboard listing both
  businesses, a combined date-range report across both, and a global audit
  trail. From there you can jump into either business's data-entry screens,
  manage its users, or view its own audit trail.
- **Each manager** logs in and lands directly on their business's entry
  screen. They can enter Sales (Cash/Card), Expenses, Fixed Costs
  (Rent/Maintenance/Utilities/Other), and Salaries; view/export Daily and
  Monthly PDF reports; edit or delete records (their own entries always, any
  entry if they're a Business Admin); and, as Business Admin, create staff or
  viewer accounts for their own business only, deactivate/reactivate them,
  reset passwords, and view that business's audit trail.
- Staff/viewer accounts a manager creates only ever see the one business they
  were created under.
- The app is touch-friendly and works on phones — managers can add it to
  their home screen from their phone's browser (Chrome: menu → "Add to Home
  screen"; Safari: Share → "Add to Home Screen") for an app-like icon.

## 8. Alternative: Railway or Render instead of a VPS

Both platforms can run this without you managing a server:

1. Create a **PostgreSQL** instance (managed by the platform). Take note of
   its connection string.
2. Deploy `backend/` as a web service, build command none (it's plain
   Node), start command `node src/index.js`, and set the environment
   variables from `.env.example` (`DATABASE_URL` from step 1,
   `JWT_SECRET`, `CORS_ORIGIN`).
3. Run the database schema once against that Postgres instance — either via
   the platform's console (`psql "$DATABASE_URL" -f backend/schema.sql`) or a
   one-off job, since these platforms don't run Postgres init scripts the way
   Docker does.
4. Deploy `frontend/` as a static site / web service, build command
   `npm run build`, output directory `dist`, and set `VITE_API_URL` to the
   backend service's public URL **before building** (Vite bakes it in at
   build time — changing it later requires a rebuild).
5. Run the seed script once, from your own machine, pointed at the deployed
   database: `DATABASE_URL=<the connection string> node backend/scripts/seed.js`
   (needs `npm install` in `backend/` locally first).

Either platform gives you HTTPS automatically, which a bare VPS does not (see
below).

## 9. Backups

Postgres data lives in the `db_data` Docker volume. To back it up:

```bash
docker compose exec db pg_dump -U uap uap > backup-$(date +%F).sql
```

Restore into a fresh instance with:

```bash
cat backup-2026-09-10.sql | docker compose exec -T db psql -U uap uap
```

Consider scheduling the `pg_dump` line via cron and copying the file
off-server (or to cloud storage) — a local-only backup doesn't protect you if
the server itself is lost.

## 10. Security checklist before handing out real credentials

- Change every seeded/temporary password on first login (the app forces
  this automatically) and never reuse the ones printed during setup.
- Use a real `JWT_SECRET` (not the example value) — anyone who has it can
  forge login sessions.
- Put the app behind HTTPS. A bare VPS serves plain HTTP by default; put a
  reverse proxy in front (Caddy is the easiest — it gets you free automatic
  HTTPS certificates with about 5 lines of config) or use Railway/Render,
  which handle this for you.
- Don't expose Postgres's port (5432) to the public internet unless you need
  to connect to it remotely — remove the `ports:` mapping under `db` in
  `docker-compose.yml` once you've done any initial setup that needed it, or
  restrict it with your server's firewall.
- Keep `.env` and `backend/CREDENTIALS_DO_NOT_COMMIT.txt` out of git (already
  covered by `.gitignore`) and off any file share people other than you can
  read.
- Every create/update/delete is recorded in the audit trail with who did it
  and when — check it periodically, especially for account and permission
  changes.

## 11. Updating the app later

```bash
git pull            # or re-copy updated files
docker compose up -d --build
```

Existing data in the `db_data` volume is untouched by rebuilds — only
`docker compose down -v` would delete it (the `-v` is what removes volumes;
plain `down` is safe).

## 12. Troubleshooting

**Frontend loads but login fails / "Failed to fetch"** — `VITE_API_URL`
doesn't match the backend's real public URL, or `CORS_ORIGIN` doesn't
exactly match the frontend's real public URL (protocol, domain, and port all
have to match exactly). Fix the `.env` value and re-run
`docker compose up -d --build` for the affected service.

**"password authentication failed" in backend logs** — `POSTGRES_PASSWORD`
in `.env` doesn't match what the database was actually created with. If you
changed it after the first `docker compose up`, either reset the password
inside Postgres to match, or wipe the volume with `docker compose down -v`
and start over (only do this if there's no real data in there yet).

**`docker compose exec backend npm run seed` says "relation does not
exist"** — the schema didn't get initialized, usually because the `db_data`
volume already existed from an earlier attempt (Postgres only runs init
scripts on a brand-new, empty volume). Run
`docker compose exec db psql -U uap -d uap -f /docker-entrypoint-initdb.d/01-schema.sql`
once to apply it manually, or `docker compose down -v` to start clean if
there's nothing to lose.

**Can't reach the app from outside the server at all** — check your
server's firewall/security group allows inbound traffic on the ports you
mapped (`FRONTEND_PORT`, `BACKEND_PORT` in `.env`, default 8080 and 4000).
