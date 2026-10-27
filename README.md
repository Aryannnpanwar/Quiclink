# QuicLink

> Shorten. Scan. Share.

QuicLink is a standalone URL utility with three independent workflows:

1. **Shorten URL** — create a persistent short link backed by PostgreSQL.
2. **Generate QR** — encode any HTTP/HTTPS URL locally and download the QR code as a PNG.
3. **Shorten + QR** — create a real short link, then encode that short link in a QR code.

The original QuicLink visual direction is preserved: Manrope and DM Mono typography, navy/mint branding, responsive tool tabs, result cards, and a mobile navigation menu.

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

`PUBLIC_APP_URL` is used when the API returns a short URL. It is not hardcoded in the frontend or production server. For a deployed app, set it to the deployed HTTPS origin.

If PostgreSQL is not installed or the environment variables are missing, the server still serves the frontend, but `/api/health`, link creation, link listing, link updates, deletion, and redirects return an explicit HTTP 503 response explaining that PostgreSQL is not configured. No fake or in-memory links are created.

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
