'use strict';
/* KenKeen Seva — Express + Neon PostgreSQL + Cloudinary */
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const cloudinary = require('cloudinary').v2;

const PROD = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
const SECRET = process.env.JWT_SECRET;
if (!SECRET || SECRET.length < 32) {
  console.error('JWT_SECRET must be set to a random string of at least 32 characters.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL must be set to your Neon PostgreSQL connection string.');
  process.exit(1);
}
if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) {
  console.error('Cloudinary credentials are required for persistent image uploads.');
  process.exit(1);
}
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000
});

async function initDb() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')),
      created_at BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id BIGSERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
      text TEXT NOT NULL,
      image TEXT,
      reply TEXT,
      hidden BOOLEAN NOT NULL DEFAULT FALSE,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_site ON reviews(site, hidden, created_at);
    CREATE TABLE IF NOT EXISTS place_photos (
      id BIGSERIAL PRIMARY KEY,
      place TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'Stay',
      caption TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pp_place ON place_photos(place);
    CREATE TABLE IF NOT EXISTS gallery (
      id BIGSERIAL PRIMARY KEY,
      site TEXT NOT NULL,
      image TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      created_at BIGINT NOT NULL
    );
  `);
}
const SITES = ['main', 'travel', 'courier', 'food'];
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const fail = (res, code, msg) => res.status(code).json({ error: msg });
const pubUser = u => u && ({ id: u.id, name: u.name, email: u.email, role: u.role });
const pubReview = (r, me) => ({
  id: r.id, site: r.site, name: r.name, rating: r.rating, text: r.text, image: r.image,
  reply: r.reply, date: Number(r.created_at), hidden: !!r.hidden,
  mine: !!me && (String(me.id) === String(r.user_id) || me.role === 'admin')
});
const REVIEW_SQL = 'SELECT r.*, u.name FROM reviews r JOIN users u ON u.id=r.user_id';

async function saveImage(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 100 || buf.length > 1.5 * 1024 * 1024) return null;
  const sig = { jpeg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47] }[m[1]];
  if (sig && !sig.every((b, i) => buf[i] === b)) return null;
  if (m[1] === 'webp' && buf.slice(8, 12).toString() !== 'WEBP') return null;
  try {
    const result = await cloudinary.uploader.upload(dataUrl, {
      folder: 'kenkeen-seva',
      resource_type: 'image',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp']
    });
    return result.secure_url;
  } catch (err) {
    console.error('Cloudinary upload failed:', err.message);
    return null;
  }
}
async function removeImage(url) {
  if (!url || !url.includes('res.cloudinary.com/')) return;
  try {
    const m = url.match(/\/upload\/(?:v\d+\/)?(.+)\.(?:jpg|jpeg|png|webp)$/i);
    if (m) await cloudinary.uploader.destroy(m[1], { resource_type: 'image' });
  } catch (err) { console.error('Cloudinary delete failed:', err.message); }
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", "'unsafe-inline'"],
      'script-src-attr': ["'unsafe-inline'"],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'blob:', 'https:'],
      'media-src': ["'self'", 'data:', 'blob:', 'https:'],
      'connect-src': ["'self'", 'https:'],
      'frame-src': ["'self'", 'https:'],
      'form-action': ["'self'", 'https:', 'mailto:', 'tel:'],
      'upgrade-insecure-requests': PROD ? [] : null
    }
  }
}));
app.use(compression());
app.use(express.json({ limit: '3mb' }));
app.use(cookieParser());
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'kenkeen') return fail(res, 403, 'Blocked request.');
  next();
});
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use(async (req, res, next) => {
  req.user = null;
  const token = req.cookies.kk_session;
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET);
      const result = await db.query('SELECT * FROM users WHERE id=$1', [payload.id]);
      req.user = result.rows[0] || null;
    } catch (e) { /* invalid token or temporary DB error */ }
  }
  next();
});
const needUser = (req, res, next) => req.user ? next() : fail(res, 401, 'Please sign in.');
const needAdmin = (req, res, next) => req.user && req.user.role === 'admin' ? next() : fail(res, 403, 'Admin access only.');
function startSession(res, u) {
  const token = jwt.sign({ id: u.id }, SECRET, { expiresIn: '7d' });
  res.cookie('kk_session', token, { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 7 * 864e5, path: '/' });
}
const authLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Please try again later.' } });
const postLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many submissions. Please try again later.' } });

app.post('/api/auth/signup', authLimit, async (req, res, next) => {
  try {
    const name = clean(req.body.name, 60), email = clean(req.body.email, 120).toLowerCase(), pw = String(req.body.password || '');
    if (name.length < 2) return fail(res, 400, 'Please enter your name.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(res, 400, 'Please enter a valid email address.');
    if (pw.length < 8 || pw.length > 128) return fail(res, 400, 'Password must be 8 to 128 characters.');
    const exists = await db.query('SELECT 1 FROM users WHERE email=$1', [email]);
    if (exists.rowCount) return fail(res, 409, 'That email is already registered.');
    const hash = await bcrypt.hash(pw, 12);
    const inserted = await db.query("INSERT INTO users(name,email,password_hash,role,created_at) VALUES($1,$2,$3,'customer',$4) RETURNING *", [name, email, hash, Date.now()]);
    const u = inserted.rows[0]; startSession(res, u);
    res.status(201).json({ user: pubUser(u) });
  } catch (e) { next(e); }
});
app.post('/api/auth/login', authLimit, async (req, res, next) => {
  try {
    const email = clean(req.body.email, 120).toLowerCase(), pw = String(req.body.password || '');
    const result = await db.query('SELECT * FROM users WHERE email=$1', [email]);
    const u = result.rows[0];
    const ok = await bcrypt.compare(pw, u ? u.password_hash : DUMMY_HASH);
    if (!u || !ok) return fail(res, 401, 'Wrong email or password.');
    startSession(res, u); res.json({ user: pubUser(u) });
  } catch (e) { next(e); }
});
app.post('/api/auth/logout', (req, res) => { res.clearCookie('kk_session', { path: '/' }); res.json({ ok: true }); });
app.get('/api/auth/me', (req, res) => res.json({ user: pubUser(req.user) }));

app.get('/api/reviews', async (req, res, next) => {
  try {
    const site = clean(req.query.site, 20);
    if (!SITES.includes(site)) return fail(res, 400, 'Unknown site.');
    const result = await db.query(REVIEW_SQL + ' WHERE r.site=$1 AND r.hidden=FALSE ORDER BY r.created_at DESC LIMIT 200', [site]);
    const rows = result.rows;
    const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.rating, 0) / rows.length * 10) / 10 : null;
    const gallery = await db.query('SELECT id, image, caption FROM gallery WHERE site=$1 ORDER BY created_at DESC', [site]);
    res.json({ reviews: rows.map(r => pubReview(r, req.user)), average: avg, count: rows.length, gallery: gallery.rows });
  } catch (e) { next(e); }
});
app.post('/api/reviews', needUser, postLimit, async (req, res, next) => {
  try {
    const site = clean(req.body.site, 20), text = clean(req.body.text, 1000), rating = Number(req.body.rating);
    if (!SITES.includes(site)) return fail(res, 400, 'Unknown site.');
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail(res, 400, 'Choose a rating from 1 to 5.');
    if (text.length < 5) return fail(res, 400, 'Please write a few words.');
    let image = null;
    if (req.body.image) { image = await saveImage(req.body.image); if (!image) return fail(res, 400, 'Image upload failed. Use a JPEG, PNG or WebP under 1.5 MB.'); }
    const inserted = await db.query('INSERT INTO reviews(site,user_id,rating,text,image,created_at) VALUES($1,$2,$3,$4,$5,$6) RETURNING id', [site, req.user.id, rating, text, image, Date.now()]);
    const row = await db.query(REVIEW_SQL + ' WHERE r.id=$1', [inserted.rows[0].id]);
    res.status(201).json({ review: pubReview(row.rows[0], req.user) });
  } catch (e) { next(e); }
});
app.delete('/api/reviews/:id', needUser, async (req, res, next) => {
  try {
    const result = await db.query('SELECT * FROM reviews WHERE id=$1', [req.params.id]);
    const r = result.rows[0];
    if (!r) return fail(res, 404, 'Review not found.');
    if (String(r.user_id) !== String(req.user.id) && req.user.role !== 'admin') return fail(res, 403, 'Not allowed.');
    await db.query('DELETE FROM reviews WHERE id=$1', [r.id]); await removeImage(r.image);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get('/api/admin/reviews', needAdmin, async (req, res, next) => {
  try {
    const site = clean(req.query.site, 20);
    if (!SITES.includes(site)) return fail(res, 400, 'Unknown site.');
    const rows = await db.query(REVIEW_SQL + ' WHERE r.site=$1 ORDER BY r.created_at DESC', [site]);
    const gallery = await db.query('SELECT id, image, caption FROM gallery WHERE site=$1 ORDER BY created_at DESC', [site]);
    res.json({ reviews: rows.rows.map(r => pubReview(r, req.user)), gallery: gallery.rows });
  } catch (e) { next(e); }
});
app.patch('/api/admin/reviews/:id', needAdmin, async (req, res, next) => {
  try {
    const found = await db.query('SELECT * FROM reviews WHERE id=$1', [req.params.id]);
    const r = found.rows[0]; if (!r) return fail(res, 404, 'Review not found.');
    if ('hidden' in req.body) await db.query('UPDATE reviews SET hidden=$1 WHERE id=$2', [!!req.body.hidden, r.id]);
    if ('reply' in req.body) await db.query('UPDATE reviews SET reply=$1 WHERE id=$2', [clean(req.body.reply, 600) || null, r.id]);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
app.post('/api/admin/gallery', needAdmin, async (req, res, next) => {
  try {
    const site = clean(req.body.site, 20);
    if (!SITES.includes(site)) return fail(res, 400, 'Unknown site.');
    const image = await saveImage(req.body.image);
    if (!image) return fail(res, 400, 'Image upload failed. Use a JPEG, PNG or WebP under 1.5 MB.');
    await db.query('INSERT INTO gallery(site,image,caption,created_at) VALUES($1,$2,$3,$4)', [site, image, clean(req.body.caption, 140), Date.now()]);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});
app.delete('/api/admin/gallery/:id', needAdmin, async (req, res, next) => {
  try {
    const found = await db.query('SELECT * FROM gallery WHERE id=$1', [req.params.id]);
    const g = found.rows[0]; if (!g) return fail(res, 404, 'Photo not found.');
    await db.query('DELETE FROM gallery WHERE id=$1', [g.id]); await removeImage(g.image);
    res.json({ ok: true });
  } catch (e) { next(e); }
});
const PLACE_RE = /^(place|temple|trip|adventure)\/[A-Za-z0-9_.~%-]{1,120}$/;
const PP_KINDS = ['Stay', 'Group photo', 'Previous trip'];
app.get('/api/place-photos', async (req, res, next) => {
  try {
    const place = clean(req.query.place, 140);
    if (!PLACE_RE.test(place)) return fail(res, 400, 'Unknown place.');
    const photos = await db.query('SELECT id, kind, caption, image FROM place_photos WHERE place=$1 ORDER BY created_at', [place]);
    res.json({ photos: photos.rows });
  } catch (e) { next(e); }
});
app.post('/api/admin/place-photos', needAdmin, async (req, res, next) => {
  try {
    const place = clean(req.body.place, 140), kind = PP_KINDS.includes(req.body.kind) ? req.body.kind : 'Stay';
    if (!PLACE_RE.test(place)) return fail(res, 400, 'Unknown place.');
    const image = await saveImage(req.body.image);
    if (!image) return fail(res, 400, 'Image upload failed. Use a JPEG, PNG or WebP under 1.5 MB.');
    await db.query('INSERT INTO place_photos(place,kind,caption,image,created_at) VALUES($1,$2,$3,$4,$5)', [place, kind, clean(req.body.caption, 140), image, Date.now()]);
    res.status(201).json({ ok: true });
  } catch (e) { next(e); }
});
app.delete('/api/admin/place-photos/:id', needAdmin, async (req, res, next) => {
  try {
    const found = await db.query('SELECT * FROM place_photos WHERE id=$1', [req.params.id]);
    const g = found.rows[0]; if (!g) return fail(res, 404, 'Photo not found.');
    await db.query('DELETE FROM place_photos WHERE id=$1', [g.id]); await removeImage(g.image);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get('/api/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ ok: true, database: 'connected' }); }
  catch (e) { res.status(503).json({ ok: false, database: 'unavailable' }); }
});
app.use('/api', (req, res) => fail(res, 404, 'Not found.'));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return fail(res, 413, 'That upload is too large.');
  if (err instanceof SyntaxError) return fail(res, 400, 'Invalid request.');
  console.error(err);
  fail(res, 500, 'Something went wrong. Please try again.');
});

(async () => {
  try {
    await initDb();
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const pw = process.env.ADMIN_PASSWORD || '';
    if (email && pw) {
      if (pw.length < 10) throw new Error('ADMIN_PASSWORD must be at least 10 characters.');
      const hash = await bcrypt.hash(pw, 12);
      const existing = await db.query('SELECT id FROM users WHERE email=$1', [email]);
      if (existing.rowCount) await db.query("UPDATE users SET password_hash=$1, role='admin' WHERE id=$2", [hash, existing.rows[0].id]);
      else await db.query("INSERT INTO users(name,email,password_hash,role,created_at) VALUES('Administrator',$1,$2,'admin',$3)", [email, hash, Date.now()]);
      console.log('Admin account ready:', email);
    } else console.warn('No ADMIN_EMAIL / ADMIN_PASSWORD set: no admin account will be created.');
    app.listen(PORT, () => console.log('KenKeen website listening on port ' + PORT));
  } catch (err) {
    console.error('Startup failed:', err);
    process.exit(1);
  }
})();
