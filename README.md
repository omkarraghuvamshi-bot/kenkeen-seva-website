# KenKeen Seva (OPC) Private Limited — official website

Static front end (`public/`) + Node.js backend (`server/server.js`) + SQLite database.

## Run locally
```bash
npm install
export ADMIN_EMAIL="you@yourcompany.com"
export ADMIN_PASSWORD="a-long-password-min-10-chars"
npm start            # http://localhost:3000
```
The database (`data/kenkeen.db`) and uploaded photos (`data/uploads/`) are created automatically.

## Accounts
- There are **no built-in or demo accounts**. The administrator is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` on start-up
  (re-start with a new password to change it).
- Customers create their own accounts from the **Login** button. Passwords are stored as bcrypt hashes.
- Admin signs in from the same Login button → opens the Admin panel (hide / reply to / delete reviews, manage gallery photos for every site).

## What the backend provides
| Endpoint | Purpose |
|---|---|
| `POST /api/auth/signup`, `/login`, `/logout`, `GET /api/auth/me` | customer + admin sessions (httpOnly cookie) |
| `GET /api/reviews?site=main\|travel\|courier\|food` | public reviews, average, gallery |
| `POST /api/reviews`, `DELETE /api/reviews/:id` | signed-in customer writes / deletes own review |
| `/api/admin/*` | admin-only moderation and gallery |

Security included: bcrypt, signed httpOnly session cookie, rate limiting, Helmet headers, CSRF header check, input validation, image type/size checks.

## Deploying (important)
SQLite is a file, so the host needs a **persistent disk**. Vercel (where the old demo was hosted) does not keep files between requests,
so use Render, Railway, Fly.io or a VPS, and set these environment variables:

`NODE_ENV=production`, `JWT_SECRET` (long random string), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `DATA_DIR` (path on the persistent disk).

Serve it over HTTPS. Back up the `DATA_DIR` folder regularly.

## Site structure (same as your original bundle)
```
public/index.html                   main page (KenKeen Seva (OPC) Private Limited)
public/travel-adventure/index.html  Travel & Adventure   (data-site="travel")
public/courier/index.html           Courier              (data-site="courier")
public/food-delivery/index.html     Food delivery        (data-site="food")
public/kk-core.js                   shared: login, reviews, admin panel, travel place photos
public/assets/                      logo, hero background, photos
```
Every page loads `kk-core.js`, so one login works across the whole site, and each division has its own reviews.
Travel place pages (`#/place/...`) also get the "Stay & trip photos" carousel, which the admin fills in.

## Not part of the backend yet
The division pages are self-contained apps. Their own features (courier orders, food cart/orders/profile, travel wishlist) still
save in the visitor's browser, and the food page's payment is a simulation. These need their own database tables and a payment
gateway before they can be used for real business.
The old `index1.html` backup files from your bundle were left out.
