# Continuity Layer — Total Independence Deployment

This folder frees the app from ALL platform dependence: the backend becomes a
standalone Cloudflare Worker (free forever: 100k requests/day) with its own
SQLite database (D1, free 5GB). Costs after migration: 0 naira (Brevo email is
already free 300/day; hosting is free; only the domain is paid, ~5k naira/yr).

## What lives where after migration
- Frontend: GitHub Pages (this repo) — already 100% owned by you.
- Backend: Cloudflare Worker (worker.js in this folder).
- Database: Cloudflare D1 (schema.sql).
- Email: Brevo (existing account/key).
- Domain: capsule.yourdomain.com -> GitHub Pages; api.yourdomain.com -> Worker.

## One-time human step (~2 minutes, skylar only)
1. Go to dash.cloudflare.com/sign-up — email + password, no card needed.
2. Verify the email. Done. Hand the agent the account (or run steps below yourself).

## Everything else is automated by the agent
1. wrangler.toml created (D1 binding "DB", secrets BREVO_KEY + ADMIN_TK set).
2. `wrangler d1 execute` runs schema.sql; `wrangler deploy` publishes worker.js.
3. Data migration: agent exports every Base44 row (users + settings chunks) and
   POSTs them once to the Worker's token-gated `migrate` act. Every capsule,
   receipt, chunk and version moves over byte-perfect.
4. Flip line 259 of app.html:
   const API = 'https://api.yourdomain.com';  (or the workers.dev URL)
   Push. The Service Worker cache version is bumped so all phones refresh.
5. E2E test: signup OTP, save/load chunked capsule, sync, version history.
6. Base44 function stays untouched as a cold backup for 30 days, then retired.

## Agent back-office after migration (no Base44 needed)
Token-gated acts keep the Concierge engine working over plain HTTPS:
- claims: receipts for verification (forwarded to owner WhatsApp)
- activate: tier activation after payment verification
- syncpull: agent reads pending sync archives for AI merging
