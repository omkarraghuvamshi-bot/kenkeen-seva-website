'use strict';
/* KenKeen Seva (OPC) Private Limited — website backend (Express + SQLite) */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Database = require('better-sqlite3');

const PROD = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Session secret: from env, otherwise generated once and kept in the data folder.
let SECRET = process.env.JWT_SECRET;
if (!SECRET) {
  if (PROD) { console.error('JWT_SECRET must be set in production.'); process.exit(1); }
  const f = path.join(DATA_DIR, '.dev-secret');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'));
  SECRET = fs.readFileSync(f, 'utf8');
}

/* ---------- Database ---------- */
const db = new Database(process.env.DATABASE_PATH || path.join(DATA_DIR, 'kenkeen.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK(role IN ('customer','admin')),
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
  text TEXT NOT NULL,
  image TEXT,
  reply TEXT,
  hidden INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reviews_site ON reviews(site, hidden, created_at);
CREATE TABLE IF NOT EXISTS place_photos(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  place TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'Stay',
  caption TEXT NOT NULL DEFAULT '',
  image TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pp_place ON place_photos(place);
CREATE TABLE IF NOT EXISTS gallery(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site TEXT NOT NULL,
  image TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);`);

const SITES = ['main', 'travel', 'courier', 'food'];
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);

// Admin account comes from environment variables only — there are no built-in logins.
(function seedAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const pw = process.env.ADMIN_PASSWORD || '';
  if (!email || !pw) { console.warn('No ADMIN_EMAIL / ADMIN_PASSWORD set: no admin account will be created.'); return; }
  if (pw.length < 10) { console.error('ADMIN_PASSWORD must be at least 10 characters.'); process.exit(1); }
  const hash = bcrypt.hashSync(pw, 12);
  const u = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (u) db.prepare("UPDATE users SET password_hash=?, role='admin' WHERE id=?").run(hash, u.id);
  else db.prepare("INSERT INTO users(name,email,password_hash,role,created_at) VALUES('Administrator',?,?,'admin',?)").run(email, hash, Date.now());
  console.log('Admin account ready:', email);
})();

/* ---------- Helpers ---------- */
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
const fail = (res, code, msg) => res.status(code).json({ error: msg });

function saveImage(dataUrl) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length < 100 || buf.length > 1.5 * 1024 * 1024) return null;
  const sig = { jpeg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47] }[m[1]];
  if (sig && !sig.every((b, i) => buf[i] === b)) return null;
  if (m[1] === 'webp' && buf.slice(8, 12).toString() !== 'WEBP') return null;
  const name = crypto.randomBytes(16).toString('hex') + '.' + (m[1] === 'jpeg' ? 'jpg' : m[1]);
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return '/uploads/' + name;
}
function removeImage(url) {
  if (url && url.startsWith('/uploads/')) fs.unlink(path.join(UPLOAD_DIR, path.basename(url)), () => {});
}
const pubUser = u => u && { id: u.id, name: u.name, email: u.email, role: u.role };
const pubReview = (r, me) => ({
  id: r.id, site: r.site, name: r.name, rating: r.rating, text: r.text, image: r.image,
  reply: r.reply, date: r.created_at, hidden: !!r.hidden,
  mine: !!me && (me.id === r.user_id || me.role === 'admin')
});
const REVIEW_SQL = 'SELECT r.*, u.name FROM reviews r JOIN users u ON u.id=r.user_id';

/* ---------- App ---------- */
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

// CSRF defence: state-changing API calls must carry a custom header (cross-site forms cannot set it).
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Requested-With') !== 'kenkeen') return fail(res, 403, 'Blocked request.');
  next();
});
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// Attach the signed-in user (re-read from DB each time so role changes/deletions apply immediately).
app.use((req, res, next) => {
  req.user = null;
  const t = req.cookies.kk_session;
  if (t) {
    try { req.user = db.prepare('SELECT * FROM users WHERE id=?').get(jwt.verify(t, SECRET).id) || null; } catch (e) { /* invalid token */ }
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

/* ---------- Auth ---------- */
app.post('/api/auth/signup', authLimit, async (req, res) => {
  const name = clean(req.body.name, 60), email = clean(req.body.email, 120).toLowerCase(), pw = String(req.body.password || '');
  if (name.length < 2) return fail(res, 400, 'Please enter your name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(res, 400, 'Please enter a valid email address.');
  if (pw.length < 8 || pw.length > 128) return fail(res, 400, 'Password must be 8 to 128 characters.');
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return fail(res, 409, 'That email is already registered.');
  const hash = await bcrypt.hash(pw, 12);
  const id = db.prepare("INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,'customer',?)").run(name, email, hash, Date.now()).lastInsertRowid;
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  startSession(res, u);
  res.status(201).json({ user: pubUser(u) });
});

app.post('/api/auth/login', authLimit, async (req, res) => {
  const email = clean(req.body.email, 120).toLowerCase(), pw = String(req.body.password || '');
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const ok = await bcrypt.compare(pw, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok) return fail(res, 401, 'Wrong email or password.');
  startSession(res, u);
  res.json({ user: pubUser(u) });
});

app.post('/api/auth/logout', (req, res) => { res.clearCookie('kk_session', { path: '/' }); res.json({ ok: true }); });
app.get('/api/auth/me', (req, res) => res.json({ user: pubUser(req.user) }));

/* ---------- Reviews & gallery (public read) ---------- */
app.get('/api/reviews', (req, res) => {
  const site = clean(req.query.site, 20);
  if (!SITES.includes(site)) return fail(res, 400, 'Unknown site.');
  const rows = db.prepare(REVIEW_SQL + ' WHERE r.site=? AND r.hidden=0 ORDER BY r.created_at DESC LIMIT 200').all(site);
  const avg = rows.length ? Math.round(rows.reduce((a, r) => a + r.rating, 0) / rows.length * 10) / 10 : null;
  const gallery = db.prepare('SELECT id, image, caption FROM gallery WHERE site=? ORDER BY created_at DESC').all(site);
  res.json({ reviews: rows.map(r => pubReview(r, req.user)), average: avg, count: rows.length, gallery });
});

app.post('/api/reviews', needUser, postLimit, (req, res) => {
  const site = clean(req.body.site, 20), text = clean(req.body.text, 1000), rating = Number(req.body.rating);
  if (!SITES.includes(site)) return fail(res, 400, 'Unknown site.');
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return fail(res, 400, 'Choose a rating from 1 to 5.');
  if (text.length < 5) return fail(res, 400, 'Please write a few words.');
  let image = null;
  if (req.body.image) { image = saveImage(req.body.image); if (!image) return fail(res, 400, 'Image must be a JPEG, PNG or WebP under 1.5 MB.'); }
  const id = db.prepare('INSERT INTO reviews(site,user_id,rating,text,image,created_at) VALUES(?,?,?,?,?,?)').run(site, req.user.id, rating, text, image, Date.now()).lastInsertRowid;
  res.status(201).json({ review: pubReview(db.prepare(REVIEW_SQL + ' WHERE r.id=?').get(id), req.user) });
});

app.delete('/api/reviews/:id', needUser, (req, res) => {
  const r = db.prepare('SELECT * FROM reviews WHERE id=?').get(req.params.id);
  if (!r) return fail(res, 404, 'Review not found.');
  if (r.user_id !== req.user.id && req.user.role !== 'admin') return fail(res, 403, 'Not allowed.');
  db.prepare('DELETE FROM reviews WHERE id=?').run(r.id);
  removeImage(r.image);
  res.json({ ok: true });
});

/* ---------- Admin ---------- */
app.get('/api/admin/reviews', needAdmin, (req, res) => {
  const site = clean(req.query.site, 20);
  if (!SITES.includes(site)) return fail(res, 400, 'Unknown site.');
  const rows = db.prepare(REVIEW_SQL + ' WHERE r.site=? ORDER BY r.created_at DESC').all(site);
  res.json({ reviews: rows.map(r => pubReview(r, req.user)), gallery: db.prepare('SELECT id, image, caption FROM gallery WHERE site=? ORDER BY created_at DESC').all(site) });
});

app.patch('/api/admin/reviews/:id', needAdmin, (req, res) => {
  const r = db.prepare('SELECT * FROM reviews WHERE id=?').get(req.params.id);
  if (!r) return fail(res, 404, 'Review not found.');
  if ('hidden' in req.body) db.prepare('UPDATE reviews SET hidden=? WHERE id=?').run(req.body.hidden ? 1 : 0, r.id);
  if ('reply' in req.body) db.prepare('UPDATE reviews SET reply=? WHERE id=?').run(clean(req.body.reply, 600) || null, r.id);
  res.json({ ok: true });
});

app.post('/api/admin/gallery', needAdmin, (req, res) => {
  const site = clean(req.body.site, 20);
  if (!SITES.includes(site)) return fail(res, 400, 'Unknown site.');
  const image = saveImage(req.body.image);
  if (!image) return fail(res, 400, 'Image must be a JPEG, PNG or WebP under 1.5 MB.');
  db.prepare('INSERT INTO gallery(site,image,caption,created_at) VALUES(?,?,?,?)').run(site, image, clean(req.body.caption, 140), Date.now());
  res.status(201).json({ ok: true });
});

app.delete('/api/admin/gallery/:id', needAdmin, (req, res) => {
  const g = db.prepare('SELECT * FROM gallery WHERE id=?').get(req.params.id);
  if (!g) return fail(res, 404, 'Photo not found.');
  db.prepare('DELETE FROM gallery WHERE id=?').run(g.id);
  removeImage(g.image);
  res.json({ ok: true });
});

const PLACE_RE = /^(place|temple|trip|adventure)\/[A-Za-z0-9_.~%-]{1,120}$/;
const PP_KINDS = ['Stay', 'Group photo', 'Previous trip'];
app.get('/api/place-photos', (req, res) => {
  const place = clean(req.query.place, 140);
  if (!PLACE_RE.test(place)) return fail(res, 400, 'Unknown place.');
  res.json({ photos: db.prepare('SELECT id, kind, caption, image FROM place_photos WHERE place=? ORDER BY created_at').all(place) });
});
app.post('/api/admin/place-photos', needAdmin, (req, res) => {
  const place = clean(req.body.place, 140), kind = PP_KINDS.includes(req.body.kind) ? req.body.kind : 'Stay';
  if (!PLACE_RE.test(place)) return fail(res, 400, 'Unknown place.');
  const image = saveImage(req.body.image);
  if (!image) return fail(res, 400, 'Image must be a JPEG, PNG or WebP under 1.5 MB.');
  db.prepare('INSERT INTO place_photos(place,kind,caption,image,created_at) VALUES(?,?,?,?,?)').run(place, kind, clean(req.body.caption, 140), image, Date.now());
  res.status(201).json({ ok: true });
});
app.delete('/api/admin/place-photos/:id', needAdmin, (req, res) => {
  const g = db.prepare('SELECT * FROM place_photos WHERE id=?').get(req.params.id);
  if (!g) return fail(res, 404, 'Photo not found.');
  db.prepare('DELETE FROM place_photos WHERE id=?').run(g.id);
  removeImage(g.image);
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', (req, res) => fail(res, 404, 'Not found.'));

/* ---------- Static site ---------- */
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '30d', immutable: true, setHeaders: r => r.setHeader('X-Content-Type-Options', 'nosniff') }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));
app.use((req, res) => res.status(404).sendFile(path.join(__dirname, '..', 'public', 'index.html')));

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return fail(res, 413, 'That upload is too large.');
  if (err instanceof SyntaxError) return fail(res, 400, 'Invalid request.');
  console.error(err);
  fail(res, 500, 'Something went wrong. Please try again.');
});

app.listen(PORT, () => console.log('KenKeen website running on http://localhost:' + PORT));
