# KenKeen Seva — Render + Neon + Cloudinary

The application serves the static website from `public/` and its Express API from `server/server.js`.

## Hosting architecture
- **Render Web Service (Free):** Express app and static frontend.
- **Neon:** PostgreSQL database for users, reviews, gallery and travel place photos.
- **Cloudinary:** Persistent storage for uploaded review/gallery/place photos.

The app no longer uses SQLite or local disk storage. Render's ephemeral filesystem is therefore not used for persistent application data.

## Required environment variables

Set these in Render → your service → Environment:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | Random secret, at least 32 characters |
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `ADMIN_EMAIL` | Admin login email |
| `ADMIN_PASSWORD` | Admin password, at least 10 characters |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary cloud name |
| `CLOUDINARY_API_KEY` | Cloudinary API key |
| `CLOUDINARY_API_SECRET` | Cloudinary API secret |

Render supplies `PORT` automatically. Do not set `DATA_DIR` or `DATABASE_PATH`.

## Local development
1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and fill in the required credentials.
4. Run `npm start`.

## Database
On startup, the server creates the required PostgreSQL tables and indexes in Neon if they do not already exist. Keep the Neon connection string private. Use Neon's pooled connection string if available.

## Images
Uploads are validated as JPEG, PNG or WebP and limited to 1.5 MB. They are uploaded to the `kenkeen-seva` folder in Cloudinary; the resulting secure URL is stored in Neon.

## Existing data
This deployment initializes a fresh Neon database. Existing SQLite users, reviews, gallery entries and local uploads are **not automatically migrated**. If the old SQLite database contains real data, export/import it separately before switching production traffic.

## Existing API
The existing routes and JSON response shapes are retained:
- `POST /api/auth/signup`, `/login`, `/logout`, `GET /api/auth/me`
- `GET /api/reviews?site=main|travel|courier|food`
- `POST /api/reviews`, `DELETE /api/reviews/:id`
- `/api/admin/*`
- `GET /api/place-photos`
- `GET /api/health`

The travel wishlist, courier orders, food cart/orders/profile and payment simulation remain browser-local as in the original site; they have not been converted into server-side business workflows.
