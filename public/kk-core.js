/* KenKeen Seva (OPC) Private Limited — shared front-end module: sign-in, customer reviews, admin panel.
   All data lives on the server (see /server/server.js). Usage:
   <script src="/kk-core.js" data-site="main|travel|courier|food" data-head="..." data-ask="..."></script> */
(function () {
  var S = document.currentScript, SITE = S.dataset.site || 'main';
  var HEAD = S.dataset.head || 'What our customers say', ASK = S.dataset.ask || 'How was your experience?';
  var SITES = { main: 'KenKeen (company)', travel: 'Travel & Adventure', courier: 'Courier', food: 'Food delivery' };
  var ui = { modal: null, mode: 'in', tab: 'rev', asite: SITE, rate: 5, txt: '', img: '', err: '', busy: false };
  var user = null, data = { reviews: [], gallery: [], average: null, count: 0 }, adm = { reviews: [], gallery: [] };

  function api(method, url, body) {
    return fetch(url, {
      method: method, credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'kenkeen' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Something went wrong. Please try again.');
        return j;
      });
    });
  }
  function e(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function st(n) { return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n); }
  function dt(t) { return new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  function isAdmin() { return user && user.role === 'admin'; }
  function fail(x) { ui.err = x.message; ui.busy = false; render(); }

  var CSS=':host{all:initial;display:block}*{box-sizing:border-box}.sec{font:15px/1.55 system-ui,Segoe UI,Roboto,sans-serif;color:#1d2530;background:#fffaf0;padding:56px 18px;border-top:1px solid #eadfc8}.in{max-width:1100px;margin:0 auto}h2{font:700 28px/1.2 Georgia,serif;margin:0 0 6px}h3{margin:0 0 10px;font-size:17px}.sub{margin:0 0 22px;color:#5b6573}.st{color:#d9a83a;letter-spacing:2px}.g{display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(250px,1fr))}.c{background:#fff;border:1px solid #eadfc8;border-radius:12px;padding:16px}.c p{margin:8px 0}.m{font-size:12.5px;color:#7a8391}.rp{background:#fff6e0;border-left:3px solid #d9a83a;padding:8px 10px;font-size:13px;margin-top:8px;border-radius:6px}.c img,.gi img{width:100%;border-radius:8px;display:block;margin-top:8px}.gi{background:#fff;border:1px solid #eadfc8;border-radius:12px;padding:8px;font-size:13px}.gi img{margin:0 0 6px;aspect-ratio:4/3;object-fit:cover}button,.b{font:inherit;cursor:pointer;border:0;border-radius:9px;padding:9px 16px;background:#14283b;color:#fff;font-weight:600}button.s{background:#fff;color:#14283b;border:1px solid #c9bfa8}button.d{background:#fff;color:#b3261e;border:1px solid #e3b4b0;padding:4px 10px;font-size:12px}button.s.sm{padding:4px 10px;font-size:12px}input,textarea,select{font:inherit;width:100%;padding:10px 12px;border:1px solid #c9bfa8;border-radius:9px;margin:4px 0 10px;background:#fff;color:#1d2530}.box{background:#fff;border:1px solid #eadfc8;border-radius:14px;padding:18px;margin-top:24px}.rate button{background:none;color:#d9a83a;font-size:26px;padding:0 3px}.fab{position:fixed;left:14px;bottom:92px;z-index:2147483000;box-shadow:0 6px 20px #0004;border-radius:99px;background:#14283b;color:#f7f1e1;border:1px solid #c9a227;font-size:13px;padding:10px 16px}.ov{position:fixed;inset:0;background:#0008;z-index:2147483001;display:grid;place-items:center;padding:14px;overflow:auto}.md{background:#fff;border-radius:16px;padding:22px;width:100%;max-width:520px;max-height:92vh;overflow:auto;font:15px/1.5 system-ui,sans-serif;color:#1d2530}.md.w{max-width:760px}.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.r1{display:flex;flex-wrap:wrap;justify-content:space-between;gap:10px;align-items:flex-start;border-bottom:1px solid #eee;padding:10px 0}.er{color:#b3261e;font-size:13px}.tb button{background:#eee;color:#222}.tb button.on{background:#14283b;color:#fff}.c,.box,.gi{color:#1d2530}.sec.f{background:none;border:0;color:inherit;padding:8px 0 24px}.f h2{font-size:20px}.f .sub{color:inherit;opacity:.7;margin-bottom:12px}.n .g{grid-template-columns:1fr}.f .in{max-width:none}';
  var NAVCSS = ':host{all:initial;display:inline-flex;align-items:center;gap:8px;margin-left:12px;vertical-align:middle}button{font:600 13px system-ui,sans-serif;cursor:pointer;border-radius:8px;padding:8px 14px;border:1px solid #c9a227;background:#14283b;color:#f7f1e1;white-space:nowrap}button.s{background:transparent;color:#c9a227;border-color:#c9a22799}@media(max-width:1450px){button{padding:7px 11px;font-size:12px}}@media(max-width:560px){:host{margin-left:6px;gap:4px}button{padding:6px 9px;font-size:12px}}';

  function card(r) {
    return '<div class="c"><div class="st">' + st(r.rating) + '</div><p>' + e(r.text) + '</p>' +
      (r.image ? '<img src="' + e(r.image) + '" alt="Customer photo" loading="lazy">' : '') +
      '<div class="m">' + e(r.name) + ' · ' + dt(r.date) + '</div>' +
      (r.reply ? '<div class="rp"><b>KenKeen:</b> ' + e(r.reply) + '</div>' : '') +
      (r.mine ? '<p><button class="d" data-a="del" data-id="' + r.id + '">Delete</button></p>' : '') + '</div>';
  }

  function adminPanel() {
    var h = '<div class="ov"><div class="md w"><div class="r1" style="border:0"><h3>Admin panel</h3><button class="s" data-a="close">Close</button></div>' +
      '<select data-a="asite">' + Object.keys(SITES).map(function (k) { return '<option value="' + k + '"' + (k == ui.asite ? ' selected' : '') + '>' + SITES[k] + '</option>'; }).join('') + '</select>' +
      '<div class="row tb"><button class="' + (ui.tab == 'rev' ? 'on' : '') + '" data-a="tab" data-t="rev">Reviews (' + adm.reviews.length + ')</button><button class="' + (ui.tab == 'gal' ? 'on' : '') + '" data-a="tab" data-t="gal">Images (' + adm.gallery.length + ')</button></div>' +
      '<div class="er">' + e(ui.err) + '</div>';
    if (ui.tab == 'rev') {
      h += adm.reviews.map(function (r) {
        return '<div class="r1"><div><span class="st">' + st(r.rating) + '</span> ' + (r.hidden ? '<b class="er">[hidden]</b>' : '') + '<br>' + e(r.text) +
          '<div class="m">' + e(r.name) + ' · ' + dt(r.date) + '</div>' + (r.reply ? '<div class="rp">Reply: ' + e(r.reply) + '</div>' : '') + '</div>' +
          '<div class="row"><button class="s sm" data-a="hide" data-id="' + r.id + '" data-h="' + (r.hidden ? 0 : 1) + '">' + (r.hidden ? 'Show' : 'Hide') + '</button>' +
          '<button class="s sm" data-a="reply" data-id="' + r.id + '">Reply</button><button class="d" data-a="del" data-id="' + r.id + '">Delete</button></div></div>';
      }).join('') || '<p class="m">No reviews yet.</p>';
    } else {
      h += '<p class="m" style="margin-top:12px">Photos added here appear in the photo gallery of the selected site.</p><input id="gc" placeholder="Caption (optional)" maxlength="140"><input id="gf" type="file" accept="image/*" multiple data-a="gadd">' +
        '<div class="g" style="margin-top:12px">' + adm.gallery.map(function (g) { return '<div class="gi"><img src="' + e(g.image) + '" alt=""><div>' + e(g.caption) + '</div><button class="d" data-a="gdel" data-id="' + g.id + '">Remove</button></div>'; }).join('') + '</div>';
    }
    return h + '</div></div>';
  }

  function render() {
    var t = sh.getElementById('rt'); if (t) ui.txt = t.value;
    var h = '<style>' + CSS + '</style><section class="sec' + (SITE == 'food' || S.dataset.mount == 'manual' ? ' f' : '') + (SITE == 'food' ? ' n' : '') + '" id="kk-reviews"><div class="in"><h2>' + e(HEAD) + '</h2>' +
      '<p class="sub">' + (data.count ? '<span class="st">★</span> <b>' + data.average + '</b> out of 5 · ' + data.count + ' review' + (data.count == 1 ? '' : 's') : 'No reviews yet — be the first to share your experience.') + '</p>' +
      (data.count ? '<div class="g">' + data.reviews.map(card).join('') + '</div>' : '');
    if (data.gallery.length) h += '<h3 style="margin-top:28px">Photo gallery</h3><div class="g">' + data.gallery.map(function (g) { return '<div class="gi"><img src="' + e(g.image) + '" alt="" loading="lazy">' + e(g.caption) + '</div>'; }).join('') + '</div>';
    if (!user) h += '<div class="box"><h3>' + e(ASK) + '</h3><p class="sub">Sign in as a customer to write a review.</p><button data-a="open">Sign in / Create account</button></div>';
    else if (isAdmin()) h += '<div class="box"><h3>Signed in as administrator</h3><p class="sub">Manage reviews and images for every KenKeen site.</p><button data-a="admin">Open admin panel</button> <button class="s" data-a="out">Sign out</button></div>';
    else h += '<div class="box"><h3>' + e(ASK) + '</h3><div class="rate">' + [1, 2, 3, 4, 5].map(function (i) { return '<button data-a="rate" data-n="' + i + '" aria-label="' + i + ' stars">' + (i <= ui.rate ? '★' : '☆') + '</button>'; }).join('') + '</div>' +
      '<textarea id="rt" rows="3" maxlength="1000" placeholder="Write your review...">' + e(ui.txt) + '</textarea><input id="rf" type="file" accept="image/*" data-a="rimg">' +
      (ui.img ? '<img src="' + ui.img + '" alt="" style="max-width:160px;border-radius:8px"><br>' : '') + '<div class="er">' + e(ui.err) + '</div><button data-a="post"' + (ui.busy ? ' disabled' : '') + '>Post review</button> <button class="s" data-a="out">Sign out</button></div>';
    h += '</div></section>';
    if (ui.modal == 'auth') h += '<div class="ov"><div class="md"><h3>' + (ui.mode == 'in' ? 'Sign in' : 'Create customer account') + '</h3>' +
      (ui.mode == 'up' ? '<input id="an" placeholder="Your name" autocomplete="name" maxlength="60">' : '') +
      '<input id="ae" type="email" placeholder="Email" autocomplete="email"><input id="ap" type="password" placeholder="Password' + (ui.mode == 'up' ? ' (8+ characters)' : '') + '" autocomplete="' + (ui.mode == 'in' ? 'current-password' : 'new-password') + '">' +
      '<div class="er">' + e(ui.err) + '</div><div class="row"><button data-a="auth"' + (ui.busy ? ' disabled' : '') + '>' + (ui.mode == 'in' ? 'Sign in' : 'Create account') + '</button>' +
      '<button class="s" data-a="mode">' + (ui.mode == 'in' ? 'New here? Sign up' : 'Have an account? Sign in') + '</button><button class="s" data-a="close">Cancel</button></div></div></div>';
    if (ui.modal == 'admin' && isAdmin()) h += adminPanel();
    sh.innerHTML = h;
    if (pk) pr();
    sh2.innerHTML = '<style>' + NAVCSS + '</style>' + (user ? '<button data-a="' + (isAdmin() ? 'admin' : 'jump') + '">👤 ' + e(user.name.split(' ')[0]) + (isAdmin() ? ' · Admin' : '') + '</button><button class="s" data-a="out">Logout</button>' : '<button data-a="open">Login</button>');
  }

  function load() {
    return api('GET', '/api/reviews?site=' + SITE).then(function (d) { data = d; }).catch(function () { });
  }
  function loadAdmin() {
    return api('GET', '/api/admin/reviews?site=' + ui.asite).then(function (d) { adm = d; });
  }
  function refresh() { return Promise.all([load(), isAdmin() ? loadAdmin().catch(function () { }) : 0]).then(render); }

  function img(f, cb) {
    var r = new FileReader();
    r.onload = function () {
      var i = new Image();
      i.onload = function () {
        var k = Math.min(1, 900 / Math.max(i.width, i.height)), c = document.createElement('canvas');
        c.width = i.width * k; c.height = i.height * k; c.getContext('2d').drawImage(i, 0, 0, c.width, c.height);
        cb(c.toDataURL('image/jpeg', .78));
      };
      i.src = r.result;
    };
    r.readAsDataURL(f);
  }
  function session(p) {
    ui.busy = true; ui.err = ''; render();
    p.then(function (d) { user = d.user; ui.busy = false; ui.modal = isAdmin() ? 'admin' : null; return load().then(function () { return isAdmin() ? loadAdmin() : 0; }); }).then(render).catch(fail);
  }

var PC=':host{all:initial;display:block}*{box-sizing:border-box}.w{max-width:1200px;margin:0 auto;padding:26px 22px 0;font:14px/1.5 system-ui,sans-serif;color:#1d2530}h3{margin:0;font:700 22px Georgia,serif}.m{color:#5b6573;margin:2px 0 12px}.s{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding-bottom:10px}.i{flex:none;width:min(300px,78vw);aspect-ratio:4/3;scroll-snap-align:start;position:relative;border-radius:12px;overflow:hidden;background:#ccd}.i img{width:100%;height:100%;object-fit:cover;display:block}.cp{position:absolute;left:0;right:0;bottom:0;padding:22px 10px 8px;color:#fff;background:linear-gradient(transparent,#000a);font-size:13px}.k{position:absolute;top:8px;left:8px;background:#14283bcc;color:#fff;border-radius:99px;padding:2px 10px;font-size:11px;font-weight:700}button{font:inherit;cursor:pointer;border:0;border-radius:8px;padding:4px 10px;background:#fff;color:#b3261e;position:absolute;top:8px;right:8px;font-size:12px}label.add{display:grid;place-items:center;text-align:center;border:2px dashed #14283b88;background:#ffffff80;color:#14283b;font-weight:700;cursor:pointer}input,select{font:inherit;padding:8px 10px;border:1px solid #b9c4a0;border-radius:8px;background:#fff;color:#1d2530;margin:0 6px 8px 0}input[type=file]{display:none}';
  var pk = '', pl = [], ph = document.createElement('div'), ps = ph.attachShadow({ mode: 'open' });
  function pkey() { var m = location.hash.match(/^#\/(place|temple|trip|adventure)\/([^\/?]+)/); return m && m[1] + '/' + m[2]; }
  function pr() {
    var adm = isAdmin(), hi = document.querySelector('#app .det img');
    if (!pl.length && !adm) { ps.innerHTML = ''; return; }
    var h = '<style>' + PC + '</style><div class="w"><h3>Stay &amp; trip photos</h3><p class="m">' + (pl.length ? 'Slide left to see photos from previous trips: the stay, the group and the journey.' : 'No photos yet. Add the first ones below.') + '</p>';
    if (adm) h += '<div><select id="pk"><option>Stay</option><option>Group photo</option><option>Previous trip</option></select><input id="pc" placeholder="Caption (optional)" maxlength="140"></div>';
    h += '<div class="s">' + (hi && pl.length ? '<div class="i"><img src="' + e(hi.src) + '" alt=""><span class="k">The place</span></div>' : '') +
      pl.map(function (x) { return '<div class="i"><img src="' + e(x.image) + '" alt=""><span class="k">' + e(x.kind) + '</span>' + (x.caption ? '<div class="cp">' + e(x.caption) + '</div>' : '') + (adm ? '<button data-d="' + x.id + '">Remove</button>' : '') + '</div>'; }).join('') +
      (adm ? '<label class="i add">+ Add photos<input id="pf" type="file" accept="image/*" multiple></label>' : '') + '</div></div>';
    ps.innerHTML = h;
  }
  function ploadFor(k) { api('GET', '/api/place-photos?place=' + encodeURIComponent(k)).then(function (d) { if (pk == k) { pl = d.photos; pr(); } }).catch(function () { }); }
  ps.addEventListener('click', function (ev) {
    var d = ev.target.getAttribute && ev.target.getAttribute('data-d');
    if (d && confirm('Remove this photo?')) api('DELETE', '/api/admin/place-photos/' + d).then(function () { ploadFor(pk); }).catch(function (x) { alert(x.message); });
  });
  ps.addEventListener('change', function (ev) {
    var t = ev.target; if (t.id != 'pf') return;
    var kd = ps.querySelector('#pk').value, cap = ps.querySelector('#pc').value, key = pk, chain = Promise.resolve();
    [].slice.call(t.files).forEach(function (f) { chain = chain.then(function () { return new Promise(function (ok) { img(f, ok); }); }).then(function (d) { return api('POST', '/api/admin/place-photos', { place: key, kind: kd, caption: cap, image: d }); }); });
    chain.then(function () { ploadFor(key); }).catch(function (x) { alert(x.message); });
  });
  function pm() {
    var k = pkey(), d = document.querySelector('#app .det');
    if (!k || !d) { if (ph.parentNode) ph.remove(); pk = ''; pl = []; return; }
    if (pk == k && ph.previousElementSibling == d) return;
    pk = k; pl = []; d.parentNode.insertBefore(ph, d.nextSibling); pr(); ploadFor(k);
  }
  function pinit() {
    var a = document.getElementById('app'); if (!a) return;
    new MutationObserver(pm).observe(a, { childList: true });
    window.addEventListener('hashchange', function () { setTimeout(pm, 60); }); pm();
  }

  var A = {
    open: function () { ui.modal = 'auth'; ui.err = ''; render(); },
    close: function () { ui.modal = null; ui.err = ''; render(); },
    jump: function () { sh.getElementById('kk-reviews').scrollIntoView({ behavior: 'smooth' }); },
    mode: function () { ui.mode = ui.mode == 'in' ? 'up' : 'in'; ui.err = ''; render(); },
    auth: function () {
      var em = sh.getElementById('ae').value, pw = sh.getElementById('ap').value;
      if (ui.mode == 'in') return session(api('POST', '/api/auth/login', { email: em, password: pw }));
      session(api('POST', '/api/auth/signup', { name: sh.getElementById('an').value, email: em, password: pw }));
    },
    out: function () { api('POST', '/api/auth/logout').finally(function () { user = null; ui.modal = null; adm = { reviews: [], gallery: [] }; refresh(); }); },
    rate: function (t) { ui.rate = +t.dataset.n; render(); },
    post: function () {
      var tx = sh.getElementById('rt').value.trim();
      if (tx.length < 5) { ui.err = 'Please write a few words.'; return render(); }
      ui.busy = true; ui.err = ''; ui.txt = tx; render();
      api('POST', '/api/reviews', { site: SITE, rating: ui.rate, text: tx, image: ui.img || undefined })
        .then(function () { ui.txt = ''; ui.img = ''; ui.rate = 5; ui.busy = false; return refresh(); }).catch(fail);
    },
    del: function (t) {
      if (!confirm('Delete this review?')) return;
      api('DELETE', '/api/reviews/' + t.dataset.id).then(refresh).catch(function (x) { alert(x.message); });
    },
    admin: function () { ui.modal = 'admin'; loadAdmin().then(render); },
    asite: function (t) { ui.asite = t.value; loadAdmin().then(render); },
    tab: function (t) { ui.tab = t.dataset.t; render(); },
    hide: function (t) { api('PATCH', '/api/admin/reviews/' + t.dataset.id, { hidden: t.dataset.h == '1' }).then(refresh).catch(function (x) { alert(x.message); }); },
    reply: function (t) {
      var x = prompt('Reply as KenKeen (leave empty to remove):'); if (x === null) return;
      api('PATCH', '/api/admin/reviews/' + t.dataset.id, { reply: x }).then(refresh).catch(function (x) { alert(x.message); });
    },
    gdel: function (t) { if (confirm('Remove this photo?')) api('DELETE', '/api/admin/gallery/' + t.dataset.id).then(refresh).catch(function (x) { alert(x.message); }); }
  };

  var host = document.createElement('div'), sh = host.attachShadow({ mode: 'open' });
  var host2 = document.createElement('div'), sh2 = host2.attachShadow({ mode: 'open' });
  sh.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-a]'); if (!t || t.tagName == 'INPUT' || t.tagName == 'SELECT') return;
    if (t.classList.contains('ov') && ev.target != t) return;
    A[t.dataset.a] && A[t.dataset.a](t);
  });
  sh.addEventListener('change', function (ev) {
    var t = ev.target, a = t.dataset.a;
    if (a == 'asite') return A.asite(t);
    if (a == 'rimg' && t.files[0]) img(t.files[0], function (d) { ui.img = d; render(); });
    if (a == 'gadd') {
      var cap = sh.getElementById('gc').value, fs = [].slice.call(t.files), chain = Promise.resolve();
      fs.forEach(function (f) { chain = chain.then(function () { return new Promise(function (ok) { img(f, ok); }); }).then(function (d) { return api('POST', '/api/admin/gallery', { site: ui.asite, image: d, caption: cap }); }); });
      chain.then(function () { return Promise.all([loadAdmin(), load()]); }).then(render).catch(fail);
    }
  });
  sh2.addEventListener('click', function (ev) { var t = ev.target.closest('[data-a]'); t && A[t.dataset.a](t); });

  function place() {
    var T = null, q = ['.topbar .wrap', 'header .hr', 'header .w>span', 'header .wrap'];
    for (var i = 0; i < q.length && !T; i++) T = document.querySelector(q[i]);
    if (!T) { host2.style.cssText = 'position:fixed;top:10px;right:12px;z-index:2147483000'; document.body.appendChild(host2); return; }
    if (T.classList.contains('wrap') && T.parentNode.classList.contains('topbar')) {
      var nl = T.querySelector('.navlinks'), w = document.createElement('div');
      w.style.cssText = 'display:flex;align-items:center;gap:8px'; T.insertBefore(w, nl); w.appendChild(nl); w.appendChild(host2);
    } else T.appendChild(host2);
  }
  function mount() {
    place(); if (SITE == 'travel') pinit();
    var sl = document.getElementById('kk-slot'), fp = SITE == 'food' && document.getElementById('p-reviews'), f = document.querySelector('body > footer'), man = S.dataset.mount == 'manual';
    sl ? sl.appendChild(host) : fp ? fp.appendChild(host) : man ? 0 : f ? f.parentNode.insertBefore(host, f) : document.body.appendChild(host);
    render();
    api('GET', '/api/auth/me').then(function (d) { user = d.user; }).catch(function () { }).then(refresh);
  }
  window.kkMount = function (el) { if (el) { el.appendChild(host); render(); } };
  document.readyState == 'loading' ? document.addEventListener('DOMContentLoaded', mount) : mount();
})();
