# Restoring the Unified Accounts Platform

This guide explains how to bring the app back if one of the services it runs on fails.
Keep it with your backup files.

## Where everything lives

| Part | Where | Backed up by |
|---|---|---|
| Records (businesses, entries, users, audit trail) | Neon database | Nightly Oracle backup, and the owner's "Download complete backup" .zip |
| Invoice photos and PDFs | Oracle Object Storage (budgetpower-erp-backups, folder `unified-accounts-platform/invoices/`) | The owner's "Download complete backup" .zip |
| App code | GitHub (ranamuhammadikram-afk/unified-accounts-platform) | GitHub itself; download a copy of the repository now and then |
| Server | Render (service "ikramco") | Nothing to back up; it is rebuilt from GitHub |
| Website | Cloudflare Pages (ikramco.pages.dev) | Nothing to back up; it is rebuilt from GitHub |
| Server settings (database address, secrets, Oracle links) | Render, Environment page | Not in any backup. Keep a private copy in a password manager |

Download a complete backup from the owner overview page regularly, for example every week and at
each month-end close, and keep the .zip somewhere other than this computer (USB drive or another
cloud account). Each .zip is a snapshot of the day it was downloaded.

## The restore tool

`backend/scripts/restore-backup.js` loads a backup into a new, empty database. It reads either the
complete backup .zip or a nightly Oracle backup .json.

- It refuses to run on a database that already has data, so it cannot overwrite live records.
- It loads everything in one step: either the whole backup goes in, or nothing does.
- Record numbers (ids) stay the same, and new entries continue after the highest restored number.
- Passwords keep working. Two-factor sign-in is switched off for every user after a restore; each
  user sets up Google Authenticator again on the Security page.

It runs on any computer with Node.js 22 and a copy of the code from GitHub:

```bash
cd backend
npm install
# 1. Look inside the backup (changes nothing):
node scripts/restore-backup.js --file=unified-accounts-complete-backup-2026-11-08.zip --check
```

## If Render stops working

No records are lost: they are in the Neon database.

1. Create a new Web Service on Render (or another host) from the GitHub repository, root folder
   `backend`, using its Dockerfile.
2. Enter the same environment settings as before (from your private copy): `DATABASE_URL`,
   `JWT_SECRET`, `MFA_ENCRYPTION_KEY` (if set), `CORS_ORIGIN`, `OCI_BACKUP_PAR_URL`,
   `OCI_INVOICE_PAR_URL`, `BACKUP_CRON_SECRET` and the mail settings.
3. If the server address changed, update `VITE_API_URL` in Cloudflare Pages and redeploy the website.
   Also update the address in the GitHub nightly-backup workflow.

With the same `JWT_SECRET` / `MFA_ENCRYPTION_KEY`, two-factor sign-in keeps working.

## If the database is lost or damaged

1. Create a new, empty database (for example a new Neon project) and copy its connection string.
2. Load the latest backup into it:

   ```bash
   DATABASE_URL="postgres://...new database..." node scripts/restore-backup.js --file=<latest backup .zip or .json>
   ```

   Use the newest file you have: compare the date of your last downloaded .zip with the newest
   nightly .json in Oracle (`unified-accounts-platform/<year>/`).
3. In Render, set `DATABASE_URL` to the new database and deploy.
4. Sign in as the owner, set up two-factor sign-in again, and check the latest entries and reports.

## If Oracle storage is lost

The database is not affected, but the nightly backups and invoice files stored there are.

1. Create a new bucket and two pre-authenticated requests: one with "Permit object writes" for
   the nightly backups, and one for the prefix `unified-accounts-platform/invoices/` with
   "Permit object reads and writes" for invoices.
2. In Render, update `OCI_BACKUP_PAR_URL` and `OCI_INVOICE_PAR_URL` and deploy.
3. Put the invoice files back from your latest complete backup .zip:

   ```bash
   OCI_INVOICE_PAR_URL="https://objectstorage...new link..." node scripts/restore-backup.js --file=<backup .zip> --invoices-only
   ```

   Invoices uploaded after that .zip was downloaded cannot be recovered.

## If everything is lost

Do the database steps first (with `--invoices` added, after creating new Oracle storage, to load
the records and the invoice files together), then set up the server as in "If Render stops
working", pointing it at the new database and the new Oracle links.
