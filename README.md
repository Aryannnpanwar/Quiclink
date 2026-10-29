# QuicLink

> **Shorten. Scan. Share.**

QuicLink is a URL utility for creating shareable short links and QR codes from one simple interface. It combines a responsive, dark-themed experience with a PostgreSQL-backed API for persistent links.

## Features

- **Shorten URLs** — create persistent short links backed by PostgreSQL.
- **Generate QR codes** — encode any HTTP or HTTPS URL in the browser and download the QR code as a PNG.
- **Shorten + QR** — create a short link and generate a QR code that points to it.
- **Manage links** — list, edit, and delete saved server-side links.
- **Responsive interface** — tool tabs, result cards, mobile navigation, and a near-black, silver, and crimson visual identity.
- **Local QR history** — QR-only results are kept in this browser; they are separate from persistent server-side links.

## Table of contents

- [Requirements](#required-software)
- [Install](#install)
- [PostgreSQL setup](#postgresql-setup)
- [Environment configuration](#environment-configuration)
- [Run the application](#run-the-application)
- [API endpoints](#api-endpoints)
- [Browser history vs. server persistence](#browser-history-versus-server-persistence)
- [Tests and checks](#tests-and-checks)
- [Current scope](#phase-1-scope)

## Required software

- Node.js 18.18 or newer (Node 20+ recommended)
- npm
- PostgreSQL 14 or newer

The API does not fall back to an in-memory store. PostgreSQL must be configured for persistent short links and redirects.

## Install

From this directory:

```bash
npm install
```

This installs Express, PostgreSQL support, dotenv, the local `qrcode` library, and esbuild. The browser bundle is checked into `vendor/qrcode-browser.js`, so QR generation does not depend on an unverified CDN URL.

To rebuild that local browser bundle after changing the QR dependency:

```bash
npm run build:qr
```

## PostgreSQL setup

Create a database and an application user. The exact commands depend on your operating system; this is a typical local PostgreSQL setup:

```bash
psql -U postgres
```

Then run:

```sql
CREATE USER quiclink WITH PASSWORD 'replace-this-password';
CREATE DATABASE quiclink OWNER quiclink;
\q
```

Initialize the schema:

```bash
psql "postgresql://quiclink:replace-this-password@localhost:5432/quiclink" -f db/schema.sql
```

The schema creates the `links` table with a unique constraint on `short_code`, so duplicate codes cannot overwrite existing records.

The schema is safe to initialize on Neon. It uses `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` only; it does not drop, truncate, or overwrite existing data.

## Environment configuration

Create a private `.env` file from the template:

```bash
cp .env.example .env
```

Update the database password and public URL. `.env` is intentionally not included in the repository.

```dotenv
PORT=3000
PUBLIC_APP_URL=http://localhost:3000
DATABASE_URL=postgresql://quiclink:replace-this-password@localhost:5432/quiclink
DATABASE_SSL=false
```

`PUBLIC_APP_URL` is the configurable public origin used in the `shortUrl` returned by `POST /api/links` and `GET /api/links`. It is validated as an HTTP or HTTPS URL, trimmed of trailing slashes, and is not hardcoded in the frontend. Combined short-link + QR results encode this returned URL, so the QR code uses the same public base. QR-only results intentionally encode the URL entered by the user and remain local to the browser.

For local development, leave `PUBLIC_APP_URL=http://localhost:3000`. After deployment, set it to the app's public HTTPS origin, for example `PUBLIC_APP_URL=https://links.example.com`, then restart the server. Do not use a placeholder domain: the value must resolve to this QuicLink server for generated short links and combined QR codes to be publicly shareable.

If PostgreSQL is not installed or the environment variables are missing, the server still serves the frontend, but `/api/health`, link creation, link listing, link updates, deletion, and redirects return an explicit HTTP 503 response explaining that PostgreSQL is not configured. No fake or in-memory links are created.

### Neon production configuration

Do not put the Neon connection string in the repository or overwrite the local `.env`. In the production host's secure environment-variable settings, set `DATABASE_URL` to the connection string copied from Neon. Prefer Neon’s pooled connection string for a pooled application process and keep its `sslmode=require` query parameter intact. The server honors that SSL setting automatically. `PGPOOL_MAX` can optionally cap the per-process pool; a modest value such as `5` is a reasonable starting point for Neon.

Initialize the existing schema against Neon using the secure environment variable, or paste `db/schema.sql` into Neon’s SQL Editor:

```bash
psql "$DATABASE_URL" -f db/schema.sql
```

The production host must also set `PUBLIC_APP_URL` to the deployed HTTPS origin. After setting `DATABASE_URL`, `PUBLIC_APP_URL`, and any optional pool/SSL settings, restart the application and verify `GET /api/health` before creating links.

## Run the application

Start the API and the frontend from this directory:

```bash
npm start
```

Open <http://localhost:3000>.

For development with Node's watch mode:

```bash
npm run dev
```

The Express server serves `index.html`, `styles.css`, `app.js`, and `quiclink-logo.svg` from the same origin as the API. This is important because generated short links must resolve through the same configured application URL.

## API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/links` | Create a link. Body: `{ "destinationUrl": "https://example.com", "shortCode": "optional-alias" }` |
| `GET` | `/api/links` | List stored links, newest first |
| `PATCH` | `/api/links/:id` | Update the destination and/or custom short code |
| `DELETE` | `/api/links/:id` | Delete a stored link |
| `GET` | `/api/health` | Check PostgreSQL connectivity |
| `GET` | `/:shortCode` | Redirect to the stored destination with HTTP 302 |

The server accepts only `http://` and `https://` destination URLs and rejects invalid aliases. Random short codes use URL-safe characters and retry on PostgreSQL uniqueness collisions. Custom aliases return HTTP 409 when already taken.

## Browser history versus server persistence

- Shortened links and combined links are stored in PostgreSQL and remain available after the server restarts.
- QR-only results are generated locally and saved only in this browser's local history.
- The UI labels these as separate **Server / Persistent links** and **This device / Local QR** lists. Local history is not a synchronized account dashboard.
- Clearing local history does not delete server-side links. Server-side links can be edited or deleted individually from the server list.

## Tests and checks

Run syntax checks:

```bash
npm run check
```

Run the unit tests:

```bash
npm test
```

For a configured PostgreSQL instance, verify the service and the core API flow:

```bash
curl -i http://localhost:3000/api/health
curl -i -X POST http://localhost:3000/api/links \
  -H 'Content-Type: application/json' \
  -d '{"destinationUrl":"https://example.com/docs","shortCode":"docs-demo"}'
curl -i http://localhost:3000/docs-demo
```

The redirect command returns HTTP 302 and a `Location: https://example.com/docs` header. An unknown code returns HTTP 404. Do not use a production password in shell history or committed files.

## Phase 1 scope

Authentication, password-protected links, expiring links, UTM tooling, smart redirects, and analytics are intentionally not included yet. The API and database provide the foundation for those later features without pretending they already work.
