/* ============================================================================
 * mls_reviews_scrape_app.js -- __mlsRepScrape v1.4.1 (2026-07-10)
 *
 * v1.4.0 (one clean flow): the page previously showed a maze -- an AI-found
 *   3.8-star listing right under a headline that said "-- / 0 reviews / 0
 *   confirmed", with no way to get from one to the other. Fixes:
 *   1. CONFIRM FLOW: every unconfirmed listing now has "This is me -- count
 *      it" / "Not me -- hide" buttons. Confirming marks the listing (and its
 *      reviews) verified, persists in localStorage (mlsRFConfirmed /
 *      mlsRFDenied, survives rescans), recomputes the headline and re-renders.
 *   2. PLACES ALWAYS MERGED: the authoritative zero-AI Google Places rating
 *      (/api/reviews/find) is now merged into GROUNDED results too (it was
 *      fallback-only), so a verified Google listing counts immediately.
 *   3. HONEST HINT: while nothing is confirmed, the "--" headline explains
 *      itself ("Found 3.8 stars on healthgrades -- unconfirmed. Click This is
 *      me below to count it.") instead of looking broken.
 *   4. NO FLASH: the duplicate __mlsRepAuto2 card + stale API-key grid are
 *      hidden by CSS injected at parse time (was: ~1.4s late via interval).
 * ----------------------------------------------------------------------------
 * v1.3.0 (auto-reviews): GROUNDED API is now the PRIMARY, default path and the
 *   browser extension is no longer required to find reviews. The "Find my
 *   profiles & pull reviews" button calls the backend route
 *       POST /api/reviews/auto-find  (OpenAI Responses API + web_search)
 *   which finds the doctor's REAL profiles on Google, Healthgrades, Vitals,
 *   WebMD, RateMDs and Zocdoc and pulls representative reviews -- server-side,
 *   using the practice's own OpenAI key (never exposed to the browser). The old
 *   "MLS Assist isn't installed" nag is gone: the extension + manual paste are
 *   now OPTIONAL enhancements used only if the API path is unavailable.
 *   Every result carries a verified/unconfirmed flag and a citation link; a
 *   practice-wide rating is never shown as the doctor's personal rating; the
 *   headline number is computed from CONFIRMED listings only.
 * ----------------------------------------------------------------------------
 * Earlier history (retained):
 *   v1.2.1  Historical marketing CTA (now release-held).
 *   v1.2.0  Auto-discovery primary (extension two-hop); manual paste demoted;
 *           hides review-finder's stale API-key grid; MLS Marketing CTA.
 *   v1.1.0  MLS Marketing activation CTA.
 * ----------------------------------------------------------------------------
 * APP/PAGE-SIDE module. Loaded by review-finder.html with ONE tag:
 *     <script src="mls_reviews_scrape_app.js?v=20260708"></script>
 * (also runs standalone on any page for testing; it floats its own card).
 *
 * Discovery order (each step falls through cleanly to the next):
 *   1. GROUNDED API (primary):  POST /api/reviews/auto-find -- no extension,
 *      no per-site API keys, all six sources. Requires the user to be signed
 *      into MLS (Bearer sf_bk_token) because it spends the practice's AI usage.
 *   2. GOOGLE PLACES fallback:  GET /api/reviews/find -- an authoritative Google
 *      rating with zero AI, merged in when the grounded path is unavailable.
 *   3. EXTENSION / PASTE (optional): only surfaced if 1 & 2 return nothing; the
 *      per-site "Open" + paste-a-page capture still works with no extension.
 *
 * Output: ONE dataset in the /api/reviews/find response shape (+ verified,
 * unconfirmed, sourceUrl, foundOnPage), cached in localStorage.mlsRFScrapeCache
 * (24h), broadcast via document CustomEvent 'mls-reviews-data'.
 *
 * Guard: window.__mlsRepScrape. Revert: window.__mlsRepScrape.revert().
 * Pure-ASCII, ES5/ES3-parseable (JScript new Function validated). READ-ONLY:
 * no Athena, no PHI, public business data only.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsRepScrape) return;

  var VER = '1.4.1';
  var BK = 'https://scrivara-backend.onrender.com';
  /* v1.4.1: new key. Payloads cached by v1.4.0 can carry a `verified:true` that
   * a confirm-then-undo left behind (the flag was mutated in place before
   * __srcVerified existed), which would keep counting an un-confirmed listing
   * toward the headline. Ignoring the old key self-heals every browser with no
   * user action; the next scan repopulates it. */
  var CACHE_KEY = 'mlsRFScrapeCache2';
  var CACHE_TTL = 24 * 60 * 60 * 1000;
  var EXT_TIMEOUT = 120000; /* whole extension job */
  var AUTO_TIMEOUT = 100000; /* grounded API can take ~30-60s of web search */
  var CARD_ID = 'repScrapeCard';

  /* v1.4.0: hide the duplicate __mlsRepAuto2 card + stale API-key grid the
   * instant this file parses (script tag sits at the end of body, so the DOM
   * exists) -- kills the flash-of-duplicate-dashboard. revert() removes it. */
  try {
    var hideSt = document.createElement('style');
    hideSt.id = CARD_ID + 'HideCss';
    hideSt.textContent = '#repLiveCard,#repSources{display:none !important}';
    (document.head || document.documentElement).appendChild(hideSt);
  } catch (e) {}

  /* ------------------------------ utils ---------------------------------- */
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toNum(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : null; }
  function toInt(v) { var n = parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10); return isFinite(n) ? n : null; }
  function nowIso() { try { return new Date().toISOString(); } catch (e) { return ''; } }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function token() { try { return sessionStorage.getItem('sf_bk_token') || lsGet('sf_bk_token') || ''; } catch (e) { return ''; } }
  var REVIEW_HOSTS = ['google.com', 'maps.app.goo.gl', 'g.page', 'healthgrades.com', 'vitals.com', 'webmd.com', 'ratemds.com', 'zocdoc.com', 'yelp.com', 'facebook.com'];
  function safeReviewUrl(value) {
    try {
      var u = new URL(String(value || ''));
      if (u.protocol !== 'https:' || u.username || u.password || String(value).length > 2048) return '';
      var host = u.hostname.toLowerCase(), i;
      for (i = 0; i < REVIEW_HOSTS.length; i++) if (host === REVIEW_HOSTS[i] || host.slice(-(REVIEW_HOSTS[i].length + 1)) === '.' + REVIEW_HOSTS[i]) return u.href;
    } catch (e) {}
    return '';
  }

  /* ------------- scope classifier (ES5 port of reviewsFind.js) ----------- */
  function norm(s) {
    return String(s || '').toLowerCase()
      .replace(/\b(dr|md|do|dpm|dds|dmd|pa-c|pa|np|crnp|phd|jr|sr|ii|iii)\b\.?/g, ' ')
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/^\s+|\s+$/g, '');
  }
  function nameTokens(s) {
    var parts = norm(s).split(' '), out = [], i;
    for (i = 0; i < parts.length; i++) { if (parts[i].length > 1) out.push(parts[i]); }
    return out;
  }
  function tokenOverlap(needle, hay) {
    var n = nameTokens(needle); if (!n.length) return 0;
    var h = nameTokens(hay), set = {}, i, hits = 0;
    for (i = 0; i < h.length; i++) set[h[i]] = 1;
    for (i = 0; i < n.length; i++) { if (set[n[i]]) hits++; }
    return hits / n.length;
  }
  function classifyScope(title, doctor, practice) {
    var dScore = doctor ? tokenOverlap(doctor, title) : 0;
    var pScore = practice ? tokenOverlap(practice, title) : 0;
    var dTokens = nameTokens(doctor || '');
    var lastName = dTokens.length ? dTokens[dTokens.length - 1] : null;
    var hasLast = false;
    if (lastName) { var tt = nameTokens(title), i; for (i = 0; i < tt.length; i++) { if (tt[i] === lastName) { hasLast = true; break; } } }
    if (dScore >= 0.6 && hasLast) return 'doctor';
    if (pScore >= 0.6) return 'practice';
    if (hasLast && dScore >= 0.4) return 'doctor';
    return 'unknown';
  }

  /* ------------------------- who are we scanning ------------------------- */
  function getWho() {
    try { if (typeof window.doc === 'function') { var d = window.doc(); if (d && (d.name || d.practice)) return { doctor: d.name || '', practice: d.practice || '', city: d.city || '', spec: d.spec || '' }; } } catch (e) {}
    try {
      var saved = JSON.parse(lsGet('mlsRF') || '{}');
      if (saved && saved.doc && (saved.doc.name || saved.doc.practice)) return { doctor: saved.doc.name || '', practice: saved.doc.practice || '', city: saved.doc.city || '', spec: saved.doc.spec || '' };
    } catch (e) {}
    /* b385: Settings fallback — in-app this satellite can read the getters. */
    try {
      var d2 = { doctor: '', practice: '', city: '', spec: '' };
      if (typeof getProviderName === 'function') d2.doctor = getProviderName() || '';
      if (!d2.doctor && typeof getName === 'function') d2.doctor = getName() || '';
      if (typeof getPracticeName === 'function') d2.practice = getPracticeName() || '';
      if (typeof getSpec === 'function') d2.spec = getSpec() || '';
      if (typeof getClinicAddress === 'function') { var a = getClinicAddress() || ''; var p = a.split(','); d2.city = p.length >= 2 ? p.slice(-2).join(',').trim() : a; }
      if (d2.doctor || d2.practice) return d2;
    } catch (e) {}
    return { doctor: '', practice: '', city: '', spec: '' };
  }
  function manualLinks() {
    var raw = lsGet('mlsRFLinks') || '';
    var lines = raw.split(/\r?\n/), out = [], i, u;
    for (i = 0; i < lines.length; i++) {
      u = safeReviewUrl(lines[i].replace(/^\s+|\s+$/g, ''));
      if (u) out.push(u);
      if (out.length >= 6) break;
    }
    return out;
  }

  /* -------------------- v1.4.0: confirm / deny listings ------------------ */
  /* The doctor confirms "this profile is me" once; it persists across rescans
   * (localStorage) and the listing + its reviews count toward the headline. */
  var CONF_KEY = 'mlsRFConfirmed', DENY_KEY = 'mlsRFDenied';
  function jsonList(k) { try { var a = JSON.parse(lsGet(k) || '[]'); return Object.prototype.toString.call(a) === '[object Array]' ? a : []; } catch (e) { return []; } }
  function keyOfListing(L) {
    if (L && L.url) return String(L.url).toLowerCase().replace(/[?#].*$/, '').replace(/\/+$/, '');
    return String((L && L.source) || '') + '|' + String((L && L.name) || '').toLowerCase();
  }
  function markConfirmed(k, on) {
    var l = jsonList(CONF_KEY), ix = -1, i;
    for (i = 0; i < l.length; i++) { if (l[i] === k) { ix = i; break; } }
    if (on && ix < 0) l.push(k);
    if (!on && ix >= 0) l.splice(ix, 1);
    lsSet(CONF_KEY, JSON.stringify(l.slice(0, 60)));
  }
  function markDenied(k) {
    var l = jsonList(DENY_KEY), i, seen = false;
    for (i = 0; i < l.length; i++) { if (l[i] === k) { seen = true; break; } }
    if (!seen) l.push(k);
    lsSet(DENY_KEY, JSON.stringify(l.slice(0, 60)));
  }
  function clearDenied() { lsSet(DENY_KEY, '[]'); }
  /* Re-apply the doctor's saved confirm/deny marks to any payload (fresh scan,
   * cache load, Places merge). Denied listings are flagged (render hides them,
   * weightedSummary already skips verified:false). Reviews inherit confirmed
   * status from their source listing (same source + scope). */
  function applyUserMarks(payload) {
    if (!payload || !payload.listings) return payload;
    var conf = jsonList(CONF_KEY), deny = jsonList(DENY_KEY), i, j, L, k;
    for (i = 0; i < payload.listings.length; i++) {
      L = payload.listings[i]; k = keyOfListing(L);
      /* v1.4.1: remember what the SOURCE said before any user mark, so an
       * "undo" restores it. Without this, confirming then undoing left
       * verified:true forever (the mutation survived in the cached payload)
       * and the headline kept counting a listing the doctor had un-confirmed. */
      if (L.__srcVerified === undefined) L.__srcVerified = !!L.verified;
      L.userDenied = false; L.userConfirmed = false;
      for (j = 0; j < deny.length; j++) { if (deny[j] === k) { L.userDenied = true; break; } }
      if (L.userDenied) { L.verified = false; L.unconfirmed = true; continue; }
      for (j = 0; j < conf.length; j++) { if (conf[j] === k) { L.userConfirmed = true; break; } }
      if (L.userConfirmed) { L.verified = true; L.unconfirmed = false; }
      else { L.verified = L.__srcVerified; L.unconfirmed = !L.__srcVerified; }
    }
    var confSrc = {};
    for (i = 0; i < payload.listings.length; i++) {
      L = payload.listings[i];
      if (L.verified && !L.userDenied) confSrc[String(L.source) + '|' + String(L.scope || '')] = 1;
    }
    var revs = payload.reviews || [];
    for (i = 0; i < revs.length; i++) {
      /* same undo-safety as listings: never lose what the source said */
      if (revs[i].__srcVerified === undefined) revs[i].__srcVerified = !!revs[i].verified;
      if (confSrc[String(revs[i].source) + '|' + String(revs[i].scope || '')]) { revs[i].verified = true; revs[i].unconfirmed = false; }
      else { revs[i].verified = revs[i].__srcVerified; revs[i].unconfirmed = !revs[i].__srcVerified; }
    }
    return payload;
  }

  /* --------------------------- scrape targets ---------------------------- */
  var SITE_DEFS = [
    { key: 'google',       label: 'Google',       host: 'google.com' },
    { key: 'healthgrades', label: 'Healthgrades', host: 'healthgrades.com' },
    { key: 'vitals',       label: 'Vitals',       host: 'vitals.com' },
    { key: 'webmd',        label: 'WebMD',        host: 'webmd.com' },
    { key: 'ratemds',      label: 'RateMDs',      host: 'ratemds.com' },
    { key: 'zocdoc',       label: 'Zocdoc',       host: 'zocdoc.com' }
  ];
  function keyForUrl(u) {
    u = String(u || '');
    if (/(google\.[a-z.]+\/maps|maps\.app\.goo\.gl|g\.page)/i.test(u)) return 'google';
    if (/healthgrades\.com/i.test(u)) return 'healthgrades';
    if (/vitals\.com/i.test(u)) return 'vitals';
    if (/webmd\.com/i.test(u)) return 'webmd';
    if (/ratemds\.com/i.test(u)) return 'ratemds';
    if (/zocdoc\.com/i.test(u)) return 'zocdoc';
    if (/yelp\.com/i.test(u)) return 'yelp';
    return 'website';
  }
  var PROFILE_PATTERNS = [
    { key: 'healthgrades', re: /healthgrades\.com\/(physician|providers?|dentist)\//i },
    { key: 'vitals',       re: /vitals\.com\/doctors\//i },
    { key: 'webmd',        re: /doctor\.webmd\.com\/doctor\//i },
    { key: 'ratemds',      re: /ratemds\.com\/doctor-ratings\//i },
    { key: 'zocdoc',       re: /zocdoc\.com\/doctor\//i },
    { key: 'google',       re: /(google\.[a-z.]+\/maps\/place\/|maps\.app\.goo\.gl\/|\/maps\/place\/)/i }
  ];
  function profileKeyForUrl(u) {
    u = String(u || '');
    for (var i = 0; i < PROFILE_PATTERNS.length; i++) { if (PROFILE_PATTERNS[i].re.test(u)) return PROFILE_PATTERNS[i].key; }
    return null;
  }
  function discoverFromHtml(html, who) {
    html = String(html || '');
    var toks = nameTokens(who && who.doctor || '');
    var re = /href\s*=\s*["']([^"']+)["']/gi, m, seen = {}, out = [];
    while ((m = re.exec(html))) {
      var u = m[1];
      try { var mq = u.match(/[?&](?:q|url)=([^&]+)/); if (/\/url\?/.test(u) && mq) u = decodeURIComponent(mq[1]); } catch (e) {}
      var pk = profileKeyForUrl(u);
      if (!pk) continue;
      var clean = u.split('#')[0].replace(/&amp;/g, '&');
      if (seen[clean]) continue; seen[clean] = 1;
      var hay = clean.toLowerCase(), hits = 0, j; for (j = 0; j < toks.length; j++) { if (hay.indexOf(toks[j]) >= 0) hits++; }
      out.push({ url: clean, key: pk, score: toks.length ? hits / toks.length : 0 });
      if (out.length >= 40) break;
    }
    out.sort(function (a, b) { return b.score - a.score; });
    var best = {}, list = []; for (var i = 0; i < out.length; i++) { if (!best[out[i].key]) { best[out[i].key] = 1; list.push(out[i]); } }
    return list;
  }
  function rememberLinks(list) {
    if (!list || !list.length) return 0;
    var have = manualLinks(), map = {}, i;
    for (i = 0; i < have.length; i++) map[have[i]] = 1;
    var added = 0;
    for (i = 0; i < list.length; i++) { if (!map[list[i].url]) { have.push(list[i].url); map[list[i].url] = 1; added++; } }
    lsSet('mlsRFLinks', have.slice(0, 12).join('\n'));
    return added;
  }

  function enc(s) { return encodeURIComponent(String(s || '').replace(/^\s+|\s+$/g, '')); }
  function searchUrl(key, who) {
    var q = (who.doctor || who.practice) + (who.city ? ' ' + who.city : '');
    if (key === 'google') {
      var g = (who.practice || who.doctor) + (who.city ? ' ' + who.city : '');
      return 'https://www.google.com/maps/search/' + enc(g);
    }
    if (key === 'healthgrades') return 'https://www.healthgrades.com/usearch?what=' + enc(who.doctor) + '&where=' + enc(who.city);
    if (key === 'vitals') return 'https://www.vitals.com/search?q=' + enc(who.doctor) + '&loc=' + enc(who.city);
    if (key === 'webmd') return 'https://doctor.webmd.com/results?q=' + enc(who.doctor) + '&city=' + enc(who.city);
    if (key === 'ratemds') return 'https://www.ratemds.com/best-doctors/?text=' + enc(who.doctor);
    if (key === 'zocdoc') return 'https://www.zocdoc.com/search?dr_specialty=&text=' + enc(who.doctor) + '&address=' + enc(who.city);
    return 'https://www.google.com/search?q=' + enc(q + ' reviews');
  }
  function buildTargets(who) {
    var out = [], used = {}, links = manualLinks(), i, k;
    for (i = 0; i < links.length; i++) {
      k = keyForUrl(links[i]);
      out.push({ key: k, url: links[i], direct: true });
      used[k] = true;
    }
    for (i = 0; i < SITE_DEFS.length; i++) {
      k = SITE_DEFS[i].key;
      if (!used[k]) out.push({ key: k, url: searchUrl(k, who), direct: false });
    }
    return out.slice(0, 8);
  }

  /* ------------------------ state + normalization ------------------------ */
  var S = { who: null, targets: [], perSite: {}, running: false, jobId: null, timer: null };

  function emptyPayload(who) {
    return { ok: true, query: { doctor: who.doctor, practice: who.practice, city: who.city },
             summary: { doctor: { rating: null, reviewCount: null, listings: 0 },
                        practice: { rating: null, reviewCount: null, listings: 0 } },
             listings: [], reviews: [], sources: {}, manualLinks: manualLinks(),
             engine: null, grounded: false, scraped: true, scrapedAt: nowIso() };
  }

  /* one site result {key,url,ok,method,listing,reviews,error} -> merge */
  function absorb(payload, r, who) {
    payload.sources[r.key] = payload.sources[r.key] || {};
    if (!r || !r.ok) {
      payload.sources[r.key].status = 'error';
      payload.sources[r.key].error = (r && r.error) || 'unreadable';
      return;
    }
    payload.sources[r.key].status = 'scraped';
    payload.sources[r.key].method = r.method || 'dom';
    var L = r.listing || {};
    var scope = classifyScope(L.name || '', who.doctor, who.practice);
    if (L.rating != null || L.reviewCount != null || L.name) {
      payload.listings.push({ source: r.key, scope: scope, name: L.name || '',
        address: L.address || null, rating: L.rating != null ? L.rating : null,
        reviewCount: L.reviewCount != null ? L.reviewCount : null,
        url: L.url || r.url, website: null,
        verified: true, unconfirmed: false }); /* hand-captured/DOM-read = confirmed by the user */
    }
    var revs = r.reviews || [], i;
    for (i = 0; i < revs.length; i++) {
      payload.reviews.push({ source: r.key, scope: scope, listingName: L.name || '',
        rating: revs[i].rating != null ? revs[i].rating : null,
        text: String(revs[i].text || '').slice(0, 1200),
        author: String(revs[i].author || '').slice(0, 120),
        relativeTime: revs[i].when || null, sourceUrl: L.url || r.url || null,
        verified: true, unconfirmed: false });
      if (payload.reviews.length >= 300) break;
    }
  }

  /* weighted-average summary, CONFIRMED listings only, doctor vs practice
   * split -- mirrors reviewsAutoFind.js summarize() so a client-merged Places
   * listing counts the same way the server counts. */
  function weightedSummary(payload) {
    function agg(scope) {
      var i, L, n = 0, w = 0, count = 0;
      for (i = 0; i < payload.listings.length; i++) {
        L = payload.listings[i];
        if (L.scope !== scope || L.verified === false || L.rating == null || !(L.reviewCount > 0)) continue;
        n += L.reviewCount; w += L.rating * L.reviewCount; count++;
      }
      if (!n) return { rating: null, reviewCount: 0, listings: count };
      return { rating: Math.round((w / n) * 10) / 10, reviewCount: n, listings: count };
    }
    payload.summary = { doctor: agg('doctor'), practice: agg('practice') };
    return payload;
  }
  function cacheKeyFor(who) { return norm(who.doctor) + '|' + norm(who.practice) + '|' + norm(who.city); }
  function saveCache(payload, who) {
    lsSet(CACHE_KEY, JSON.stringify({ k: cacheKeyFor(who), at: new Date().getTime(), payload: payload }));
  }
  function loadCache(who) {
    try {
      var o = JSON.parse(lsGet(CACHE_KEY) || 'null');
      if (!o || o.k !== cacheKeyFor(who)) return null;
      if (new Date().getTime() - o.at > CACHE_TTL) return null;
      return o.payload;
    } catch (e) { return null; }
  }
  function broadcast(payload) {
    try { document.dispatchEvent(new CustomEvent('mls-reviews-data', { detail: payload })); } catch (e) {}
  }

  /* ----------------- PRIMARY: grounded auto-find (OpenAI) ---------------- */
  /* POST /api/reviews/auto-find -> the final payload shape. cb(result) where
   * result = { status:'ok'|'auth'|'unconfigured'|'error', payload?, message? } */
  function autoFind(who, cb) {
    var url = BK + '/api/reviews/auto-find';
    var body = { doctor: who.doctor || '', practice: who.practice || '', city: who.city || '', specialty: who.spec || '', links: manualLinks() };
    var headers = { 'Content-Type': 'application/json' };
    var t = token(); if (t) headers['Authorization'] = 'Bearer ' + t;
    var done = false;
    var killer = setTimeout(function () { if (!done) { done = true; cb({ status: 'error', message: 'The web search took too long -- try Rescan.' }); } }, AUTO_TIMEOUT);
    function finish(o) { if (done) return; done = true; clearTimeout(killer); cb(o); }
    try {
      fetch(url, { method: 'POST', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', headers: headers, body: JSON.stringify(body) })
        .then(function (r) {
          var st = r.status;
          return r.json().then(function (j) { return { st: st, j: j }; }, function () { return { st: st, j: null }; });
        })
        .then(function (x) {
          var j = x.j;
          if (x.st === 401 || x.st === 403) { finish({ status: 'auth', message: 'Sign in to MLS to auto-pull your reviews (it uses your MLS AI). Or add a profile link below.' }); return; }
          if (j && j.ok) { finish({ status: 'ok', payload: j }); return; }
          var reason = j && j.reason;
          if (reason === 'no_openai_key' || reason === 'disabled') { finish({ status: 'unconfigured', message: (j && j.message) || 'Automatic finding is not turned on yet.' }); return; }
          finish({ status: 'error', message: (j && j.message) || 'The review service had a problem -- try again shortly.' });
        }, function () { finish({ status: 'error', message: 'Network problem reaching the review service.' }); });
    } catch (e) { finish({ status: 'error', message: 'Could not reach the review service.' }); }
  }

  /* Normalize the auto-find payload into our render/cache shape (it already is
   * that shape; we just guarantee the fields exist + carry engine/grounded). */
  function fromAuto(j, who) {
    var p = emptyPayload(who);
    p.engine = j.engine || 'openai-web-search';
    p.grounded = !!j.grounded;
    p.model = j.model || null;
    p.listings = (j.listings || []).slice();
    p.reviews = (j.reviews || []).slice();
    p.sources = j.sources || {};
    p.counts = j.counts || null;
    p.notes = j.notes || null;
    p.apiMessage = j.message || null;
    if (j.summary) p.summary = j.summary; else weightedSummary(p);
    return p;
  }

  /* --------------------- FALLBACK: Google Places API --------------------- */
  function apiFind(who, cb) {
    var u = BK + '/api/reviews/find?doctor=' + enc(who.doctor) + '&practice=' + enc(who.practice) + '&city=' + enc(who.city);
    try {
      fetch(u, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; })
        .then(function (j) { cb(j && j.ok ? j : null); }, function () { cb(null); });
    } catch (e) { cb(null); }
  }
  /* Merge Places results for sources not already covered; Places = authoritative
   * (real Google rating), so its listings are marked verified. */
  function mergeApi(payload, api) {
    if (!api) return payload;
    var i, k, have = {};
    for (i = 0; i < payload.listings.length; i++) { if (payload.listings[i].verified) have[payload.listings[i].source] = 1; }
    var als = api.listings || [];
    for (i = 0; i < als.length; i++) { if (!have[als[i].source]) { var L = als[i]; L.verified = true; L.unconfirmed = false; payload.listings.push(L); } }
    var arv = api.reviews || [];
    for (i = 0; i < arv.length; i++) { if (!have[arv[i].source]) { var R = arv[i]; R.verified = true; R.unconfirmed = false; if (!R.sourceUrl) R.sourceUrl = R.url || null; payload.reviews.push(R); } }
    if (api.sources) { for (k in api.sources) { if (!api.sources.hasOwnProperty(k)) continue; if (!payload.sources[k] || payload.sources[k].status === 'not_found' || payload.sources[k].status === 'error') { payload.sources[k] = api.sources[k]; payload.sources[k].method = 'google-places-api'; } } }
    return payload;
  }

  /* ------------------- paste capture (zero-dependency) ------------------- */
  function parsePaste(text, key, who) {
    text = String(text || '');
    if (!text) return { ok: false, key: key, error: 'empty' };
    var reviews = [], listing = { name: null, rating: null, reviewCount: null, address: null, url: null };
    var m, re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi, foundLd = false;
    while ((m = re.exec(text))) {
      var parsed = null;
      try { parsed = JSON.parse(m[1]); } catch (e) { parsed = null; }
      if (!parsed) continue;
      foundLd = true;
      absorbLdInto(parsed, listing, reviews, 0);
    }
    if (!foundLd) {
      var agg = text.match(/(\d(?:\.\d)?)\s*(?:out of 5|stars?|\u2605)?[^\n]{0,40}?([\d,]{1,7})\s*(?:patient\s+|Google\s+)?reviews?/i);
      if (agg) { listing.rating = toNum(agg[1]); listing.reviewCount = toInt(agg[2]); }
      var blocks = text.split(/\n\s*\n/), i;
      for (i = 0; i < blocks.length && reviews.length < 60; i++) {
        var b = blocks[i].replace(/^\s+|\s+$/g, '');
        if (b.length < 40) continue;
        if (/<a\s|<\/?(?:div|span|li|script|a)\b/i.test(b)) continue;
        var rm = b.match(/(\d(?:\.\d)?)\s*(?:out of 5|stars?|\u2605)/i);
        if (!rm && !/\b(doctor|dr\.?|visit|staff|pain|care|recommend)\b/i.test(b)) continue;
        reviews.push({ rating: rm ? toNum(rm[1]) : null, text: b.slice(0, 1200), author: '', when: null });
      }
    }
    if (listing.rating == null && !reviews.length) return { ok: false, key: key, error: 'nothing-recognized' };
    if (!listing.name) listing.name = who.doctor || who.practice || '';
    return { ok: true, key: key, url: null, method: foundLd ? 'jsonld-paste' : 'text-paste', listing: listing, reviews: reviews };
  }
  function absorbLdInto(node, listing, reviews, depth) {
    if (!node || depth > 6) return;
    if (Object.prototype.toString.call(node) === '[object Array]') {
      for (var i = 0; i < node.length; i++) absorbLdInto(node[i], listing, reviews, depth + 1);
      return;
    }
    if (typeof node !== 'object') return;
    if (node.aggregateRating && listing.rating == null) {
      listing.rating = toNum(node.aggregateRating.ratingValue);
      listing.reviewCount = toInt(node.aggregateRating.ratingCount != null ? node.aggregateRating.ratingCount : node.aggregateRating.reviewCount);
      if (node.name && !listing.name) listing.name = String(node.name);
    }
    var revArr = null, t = String(node['@type'] || '').toLowerCase();
    if (t.indexOf('review') >= 0 && t.indexOf('aggregate') < 0) revArr = [node];
    else if (node.review) revArr = (Object.prototype.toString.call(node.review) === '[object Array]') ? node.review : [node.review];
    if (revArr) {
      for (var j = 0; j < revArr.length && reviews.length < 60; j++) {
        var rv = revArr[j]; if (!rv || typeof rv !== 'object') continue;
        var body = rv.reviewBody != null ? rv.reviewBody : rv.description;
        reviews.push({ rating: rv.reviewRating ? toNum(rv.reviewRating.ratingValue) : null,
          text: body != null ? String(body).slice(0, 1200) : '',
          author: rv.author ? String(rv.author.name || rv.author).slice(0, 120) : '', when: rv.datePublished || null });
      }
    }
    if (node['@graph']) absorbLdInto(node['@graph'], listing, reviews, depth + 1);
  }

  /* ------------------------ extension scrape (optional) ------------------ */
  function extPing(cb) {
    var done = false;
    function onMsg(e) {
      var m = e && e.data;
      if (m && m.source === 'mls-ext' && m.type === 'mlsPong' && !done) { done = true; window.removeEventListener('message', onMsg); cb(true); }
    }
    window.addEventListener('message', onMsg);
    try { window.postMessage({ source: 'mls-app', type: 'mlsPing' }, '*'); } catch (e) {}
    setTimeout(function () { if (!done) { done = true; window.removeEventListener('message', onMsg); cb(false); } }, 2500);
  }
  function extScrape(who, targets, onProgress, onDone) {
    var jobId = 'sj' + new Date().getTime();
    S.jobId = jobId;
    var finished = false;
    function onMsg(e) {
      var m = e && e.data;
      if (!m || m.source !== 'mls-ext') return;
      if (m.type === 'mlsAppScrapeProgress' && m.resp && m.resp.jobId === jobId) { onProgress(m.resp); return; }
      if (m.type === 'mlsAppScrapeResult' && m.resp && m.resp.jobId === jobId && !finished) {
        finished = true;
        window.removeEventListener('message', onMsg);
        if (S.timer) { clearTimeout(S.timer); S.timer = null; }
        onDone(m.resp);
      }
    }
    window.addEventListener('message', onMsg);
    try {
      window.postMessage({ source: 'mls-app', type: 'mlsAppScrapeReviews',
        job: { id: jobId, mode: 'auto-find', doctor: who.doctor, practice: who.practice, city: who.city, targets: targets } }, '*');
    } catch (e) {}
    S.timer = setTimeout(function () {
      if (finished) return;
      finished = true;
      window.removeEventListener('message', onMsg);
      onDone({ jobId: jobId, ok: false, error: 'timeout', results: [] });
    }, EXT_TIMEOUT);
  }

  /* ------------------------------- UI ------------------------------------ */
  var CSS = [
    '#' + CARD_ID + '{border:1px solid #d7e0ef;border-radius:14px;padding:18px;margin:14px 0;background:#fff;font-family:system-ui,Segoe UI,Arial,sans-serif}',
    '#' + CARD_ID + ' h2{margin:0 0 6px;font-size:17px}',
    '#' + CARD_ID + ' .rsc-note{font-size:12.5px;color:#5b6b83}',
    '#' + CARD_ID + ' .rsc-kpis{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}',
    '#' + CARD_ID + ' .rsc-kpi{flex:1;min-width:180px;border:1px solid #e3e9f4;border-radius:12px;padding:12px}',
    '#' + CARD_ID + ' .rsc-kpi b{font-size:24px}',
    '#' + CARD_ID + ' .rsc-badge{display:inline-block;font-size:10.5px;font-weight:700;border-radius:999px;padding:2px 8px;margin-left:6px;vertical-align:middle}',
    '#' + CARD_ID + ' .rsc-doc{background:#e7f6ee;color:#116b3e}',
    '#' + CARD_ID + ' .rsc-prac{background:#e8effc;color:#204034}',
    '#' + CARD_ID + ' .rsc-unk{background:#f1f2f6;color:#666}',
    '#' + CARD_ID + ' .rsc-uncf{background:#fff4e5;color:#9a5b00;border:1px solid #ffd699}',
    '#' + CARD_ID + ' .rsc-ver{background:#e7f6ee;color:#116b3e;border:1px solid #b7e4c9}',
    '#' + CARD_ID + ' .rsc-src{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}',
    '#' + CARD_ID + ' .rsc-chip{border:1px solid #dde4f0;border-radius:999px;padding:4px 10px;font-size:12px}',
    '#' + CARD_ID + ' .rsc-ok{border-color:#9adbb6;background:#effaf3}',
    '#' + CARD_ID + ' .rsc-warn{border-color:#ffd699;background:#fff8ee}',
    '#' + CARD_ID + ' .rsc-err{border-color:#f0c1c1;background:#fdf1f1}',
    '#' + CARD_ID + ' .rsc-rev{border-top:1px solid #eef1f7;padding:9px 0;font-size:13px}',
    '#' + CARD_ID + ' .rsc-rev a{font-size:11.5px}',
    '#' + CARD_ID + ' .rsc-list{border:1px solid #eef1f7;border-radius:10px;padding:9px 11px;margin:7px 0;font-size:13px}',
    '#' + CARD_ID + ' .rsc-btn{cursor:pointer;border:0;border-radius:9px;padding:9px 14px;font-weight:700;font-size:13px}',
    '#' + CARD_ID + ' .rsc-primary{background:linear-gradient(90deg,#3B7C5A,#2E6A4B);color:#fff}',
    '#' + CARD_ID + ' .rsc-ghost{background:#eef2fa;color:#204034}',
    '#' + CARD_ID + ' .rsc-banner{border-radius:10px;padding:9px 12px;font-size:12.5px;margin:8px 0}',
    '#' + CARD_ID + ' .rsc-banner.warn{background:#fff8ee;border:1px solid #ffd699;color:#8a5300}',
    '#' + CARD_ID + ' .rsc-banner.info{background:#EAF1EE;border:1px solid #EAF1EE;color:#204034}',
    '#' + CARD_ID + ' textarea{width:100%;min-height:90px;border:1px solid #d7e0ef;border-radius:9px;padding:8px;font-size:12.5px;box-sizing:border-box}'
  ].join('\n');

  function ensureCard() {
    if ($(CARD_ID)) return $(CARD_ID);
    var st = document.createElement('style'); st.id = CARD_ID + 'Css'; st.textContent = CSS;
    document.head.appendChild(st);
    var card = document.createElement('div'); card.id = CARD_ID; card.className = 'card';
    var anchor = $('repLiveCard');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(card, anchor.nextSibling);
    else document.body.appendChild(card);
    return card;
  }
  function scopeBadge(scope) {
    if (scope === 'doctor') return '<span class="rsc-badge rsc-doc">DOCTOR</span>';
    if (scope === 'practice') return '<span class="rsc-badge rsc-prac">PRACTICE-WIDE</span>';
    return '<span class="rsc-badge rsc-unk">UNVERIFIED MATCH</span>';
  }
  function confBadge(item) {
    if (item && item.verified) return '<span class="rsc-badge rsc-ver">\u2714 confirmed</span>';
    return '<span class="rsc-badge rsc-uncf">\u26A0 unconfirmed</span>';
  }
  function hostText(u) { try { return String(u).replace(/^https?:\/\//i, '').split('/')[0]; } catch (e) { return 'link'; } }

  function render(payload, statusLine, banner) {
    var card = ensureCard();
    var h = [];
    h.push('<h2>\uD83D\uDD0E Find &amp; pull my reviews \u2014 automatically</h2>');
    h.push('<div class="rsc-note">Just your name + practice above. MLS finds your profiles on Google, Healthgrades, Vitals, WebMD, RateMDs &amp; Zocdoc and pulls your real reviews \u2014 <b>automatically, no browser extension and no API keys needed</b>. A practice rating is never shown as the doctor\u2019s personal rating, and only <b>confirmed</b> (cited) results count toward your headline rating.</div>');
    h.push('<div style="margin:10px 0"><button class="rsc-btn rsc-primary" id="rscScanBtn">\uD83D\uDD0E Find my profiles &amp; pull reviews</button> ' +
           '<button class="rsc-btn rsc-ghost" id="rscPasteBtn">\u2795 Add a profile link (optional)</button> ' +
           '<span class="rsc-note" id="rscStatus">' + esc(statusLine || '') + '</span></div>');

    if (banner) {
      h.push('<div class="rsc-banner ' + esc(banner.kind || 'info') + '">' + esc(banner.text) + '</div>');
    }

    if (payload) {
      var d = payload.summary.doctor, p = payload.summary.practice;
      /* v1.4.0: while nothing is confirmed, say what WAS found instead of a bare dash */
      var docHint = '';
      if (d.rating == null) {
        var bestU = null, bi;
        for (bi = 0; bi < (payload.listings || []).length; bi++) {
          var BL = payload.listings[bi];
          if (BL.scope === 'doctor' && !BL.verified && !BL.userDenied && BL.rating != null && (!bestU || (BL.reviewCount || 0) > (bestU.reviewCount || 0))) bestU = BL;
        }
        if (bestU) docHint = '<div class="rsc-note" style="margin-top:4px;color:#9a5b00">Found <b>' + bestU.rating + '\u2605 \u00B7 ' + (bestU.reviewCount || 0) + ' reviews</b> on ' + esc(bestU.source) + ' \u2014 unconfirmed. Click \u201C\u2714 This is me\u201D on it below to count it here.</div>';
      }
      h.push('<div class="rsc-kpis">');
      h.push('<div class="rsc-kpi"><div>Doctor\u2019s own rating ' + scopeBadge('doctor') + '</div><b>' + (d.rating != null ? d.rating.toFixed(1) + '\u2605' : '\u2014') + '</b><div class="rsc-note">' + (d.reviewCount || 0) + ' reviews \u00B7 ' + d.listings + ' confirmed listing(s)</div>' + docHint + '</div>');
      h.push('<div class="rsc-kpi"><div>Practice-wide rating ' + scopeBadge('practice') + '</div><b>' + (p.rating != null ? p.rating.toFixed(1) + '\u2605' : '\u2014') + '</b><div class="rsc-note">' + (p.reviewCount || 0) + ' reviews \u00B7 ' + p.listings + ' confirmed listing(s) \u2014 reflects the whole office, not the doctor personally</div></div>');
      h.push('</div>');

      /* per-source chips */
      h.push('<div class="rsc-src">');
      var k, srcs = payload.sources || {};
      for (k in srcs) {
        if (!srcs.hasOwnProperty(k)) continue;
        var s = srcs[k], cls = 'rsc-err', label = s.status;
        if (s.status === 'ok' || s.status === 'scraped') { cls = 'rsc-ok'; label = 'found'; }
        else if (s.status === 'unconfirmed') { cls = 'rsc-warn'; label = 'unconfirmed'; }
        else if (s.status === 'not_found' || s.status === 'searched') { cls = 'rsc-err'; label = 'not found'; }
        h.push('<span class="rsc-chip ' + cls + '">' + esc(k) + ': ' + esc(label) + '</span>');
      }
      h.push('</div>');

      /* confirmed listings with profile links */
      var lst = (payload.listings || []), i, shownL = 0, hiddenN = 0;
      var listHtml = '';
      for (i = 0; i < lst.length && shownL < 12; i++) {
        var L = lst[i];
        if (!L.name && !L.url) continue;
        if (L.userDenied) { hiddenN++; continue; }
        shownL++;
        var lk = keyOfListing(L), act = '';
        if (L.userConfirmed) {
          act = '<div style="margin-top:6px"><span class="rsc-badge rsc-ver">\u2714 counted in your headline</span> <a href="#" class="rsc-unconfirm rsc-note" data-k="' + esc(lk) + '">undo</a></div>';
        } else if (!L.verified) {
          act = '<div style="margin-top:6px"><button class="rsc-btn rsc-primary rsc-confirm" data-k="' + esc(lk) + '" style="padding:6px 11px;font-size:12px">\u2714 This is me \u2014 count it</button> ' +
                '<button class="rsc-btn rsc-ghost rsc-deny" data-k="' + esc(lk) + '" style="padding:6px 11px;font-size:12px">\u2716 Not me \u2014 hide</button></div>';
        }
        listHtml += '<div class="rsc-list"><b>' + esc(L.name || hostText(L.url)) + '</b> ' + scopeBadge(L.scope) + ' ' + confBadge(L) +
          ' <span class="rsc-note">' + esc(L.source) + (L.rating != null ? (' \u00B7 ' + L.rating + '\u2605 \u00B7 ' + (L.reviewCount || 0) + ' reviews') : ' \u00B7 no rating shown') + '</span>' +
          (safeReviewUrl(L.url) ? ('<div><a href="' + esc(safeReviewUrl(L.url)) + '" target="_blank" rel="noopener noreferrer">Open profile \u2197 ' + esc(hostText(L.url)) + '</a></div>') : '') + act + '</div>';
      }
      if (listHtml) { h.push('<div style="margin-top:8px;font-weight:700;font-size:13px">Profiles found <span class="rsc-note" style="font-weight:400">\u2014 confirm yours so they count toward the headline</span></div>'); h.push(listHtml); }
      if (hiddenN) { h.push('<div class="rsc-note">' + hiddenN + ' listing(s) hidden as \u201Cnot me\u201D \u2014 <a href="#" id="rscResetDeny">show them again</a></div>'); }

      /* reviews with citation links */
      var revs = (payload.reviews || []).slice(0, 25);
      if (revs.length) {
        h.push('<div style="margin-top:10px;font-weight:700;font-size:13px">Representative reviews (' + (payload.reviews || []).length + ' pulled)</div>');
        for (i = 0; i < revs.length; i++) {
          var r = revs[i];
          h.push('<div class="rsc-rev">' + (r.rating != null ? ('<b>' + r.rating + '\u2605</b> ') : '') + scopeBadge(r.scope) + ' ' + confBadge(r) +
                 ' <span class="rsc-note">' + esc(r.source) + (r.author ? ' \u00B7 ' + esc(r.author) : '') + (r.relativeTime ? ' \u00B7 ' + esc(r.relativeTime) : '') + '</span>' +
                 '<div>' + esc(String(r.text || '').slice(0, 440)) + '</div>' +
                 (safeReviewUrl(r.sourceUrl) ? ('<a href="' + esc(safeReviewUrl(r.sourceUrl)) + '" target="_blank" rel="noopener noreferrer">source \u2197 ' + esc(hostText(r.sourceUrl)) + '</a>') : '') + '</div>');
        }
        h.push('<div class="rsc-note" style="margin-top:6px">Only use a review as a public testimonial if it is marked <b>\u2714 confirmed</b> and the source platform + patient allow it.</div>');
      }

      var eng = payload.engine === 'openai-web-search' ? 'MLS AI web search' : (payload.engine || 'MLS');
      h.push('<div class="rsc-note" style="margin-top:8px">Found via ' + esc(eng) + (payload.model ? ' (' + esc(payload.model) + ')' : '') + ' \u00B7 ' + esc(payload.scrapedAt || '') + ' \u00B7 cached 24h \u00B7 <a href="#" id="rscRescan">Rescan</a></div>');
    }

    h.push('<div id="rscPasteBox" style="display:none;margin-top:10px">' +
           '<div class="rsc-note"><b>Optional override.</b> MLS finds your profiles on its own \u2014 use this only to add a specific profile it missed, or to capture a page by hand. Paste a profile page (or a directory <i>search-results</i> page and MLS will pick out your profile links).</div>' +
           '<div class="rsc-src" id="rscOpenRow"></div>' +
           '<textarea id="rscPasteTa" placeholder="Paste a profile page, a search-results page, or a profile URL\u2026"></textarea>' +
           '<div style="margin-top:6px"><select id="rscPasteSite"></select> ' +
           '<button class="rsc-btn rsc-ghost" id="rscPasteGo">Capture / find profiles</button> <span class="rsc-note" id="rscPasteNote"></span></div></div>');
    card.innerHTML = h.join('');
    wire(card);
  }

  function wire(card) {
    var who = getWho();
    /* v1.4.0: confirm / deny / undo / reset handlers */
    function reprocess() {
      var w2 = getWho(), c = loadCache(w2);
      if (!c) return;
      c = weightedSummary(applyUserMarks(c));
      saveCache(c, w2); broadcast(c);
      render(c, 'Updated \u2014 your confirmations are saved.');
    }
    var bi2, cbs = card.querySelectorAll('.rsc-confirm');
    for (bi2 = 0; bi2 < cbs.length; bi2++) {
      cbs[bi2].onclick = (function (k) { return function () { markConfirmed(k, true); reprocess(); }; })(cbs[bi2].getAttribute('data-k'));
    }
    var dbs = card.querySelectorAll('.rsc-deny');
    for (bi2 = 0; bi2 < dbs.length; bi2++) {
      dbs[bi2].onclick = (function (k) { return function () { markDenied(k); reprocess(); }; })(dbs[bi2].getAttribute('data-k'));
    }
    var ubs = card.querySelectorAll('.rsc-unconfirm');
    for (bi2 = 0; bi2 < ubs.length; bi2++) {
      ubs[bi2].onclick = (function (k) { return function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); markConfirmed(k, false); reprocess(); return false; }; })(ubs[bi2].getAttribute('data-k'));
    }
    var rd = $('rscResetDeny');
    if (rd) rd.onclick = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); clearDenied(); reprocess(); return false; };
    var sb = $('rscScanBtn'); if (sb) sb.onclick = function () { scan(true); };
    var rs = $('rscRescan'); if (rs) rs.onclick = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); scan(true); return false; };
    var pb = $('rscPasteBtn'); if (pb) pb.onclick = function () {
      var box = $('rscPasteBox'); if (!box) return;
      box.style.display = (box.style.display === 'none') ? '' : 'none';
      var row = $('rscOpenRow'), sel = $('rscPasteSite');
      if (row && !row.childNodes.length) {
        var t = buildTargets(who), i, html = '', opts = '';
        for (i = 0; i < t.length; i++) {
          html += '<a class="rsc-chip" target="_blank" rel="noopener noreferrer" href="' + esc(safeReviewUrl(t[i].url)) + '">\u2197 ' + esc(t[i].key) + (t[i].direct ? ' (your link)' : ' (search)') + '</a>';
          opts += '<option value="' + esc(t[i].key) + '">' + esc(t[i].key) + '</option>';
        }
        row.innerHTML = html;
        if (sel) sel.innerHTML = opts;
      }
    };
    var pg = $('rscPasteGo'); if (pg) pg.onclick = function () {
      var ta = $('rscPasteTa'), note = $('rscPasteNote'), sel = $('rscPasteSite');
      var val = ta ? ta.value : '';
      var trimmed = String(val).replace(/^\s+|\s+$/g, '');
      if (/^https?:\/\/\S+$/.test(trimmed) && trimmed.indexOf('\n') < 0) {
        var added = rememberLinks([{ url: trimmed, key: keyForUrl(trimmed) }]);
        if (note) note.textContent = added ? 'Added \u2014 pulling reviews\u2026' : 'Already on the list \u2014 pulling reviews\u2026';
        if (ta) ta.value = ''; scan(true); return;
      }
      var key = sel && sel.value ? sel.value : 'website';
      var found = discoverFromHtml(val, who);
      if (found.length >= 2) {
        rememberLinks(found);
        if (note) note.textContent = 'Found ' + found.length + ' profile link(s) \u2014 pulling reviews\u2026';
        if (ta) ta.value = ''; scan(true); return;
      }
      var r = parsePaste(val, key, who);
      if (r.ok) { S.perSite[key] = r; finishFromPerSite(who, 'Captured ' + key + '.'); if (ta) ta.value = ''; return; }
      if (found.length === 1) {
        rememberLinks(found);
        if (note) note.textContent = 'Found your ' + found[0].key + ' profile \u2014 pulling reviews\u2026';
        if (ta) ta.value = ''; scan(true); return;
      }
      if (note) note.textContent = 'Nothing recognized \u2014 paste a profile page, a search-results page, or a profile URL.';
    };
  }

  /* ------------------------------ scan flow ------------------------------ */
  /* Manual paste/capture path: build a payload from S.perSite, then merge the
   * Google Places API for anything not hand-captured. */
  function finishFromPerSite(who, statusLine) {
    var payload = emptyPayload(who), k;
    for (k in S.perSite) { if (S.perSite.hasOwnProperty(k)) absorb(payload, S.perSite[k], who); }
    apiFind(who, function (api) {
      payload = weightedSummary(applyUserMarks(mergeApi(payload, api)));
      payload.scrapedAt = nowIso();
      saveCache(payload, who);
      broadcast(payload);
      render(payload, statusLine || 'Done.');
    });
  }

  /* Deep fallback when the grounded API is unavailable: try the extension if it
   * is present (silent -- no nag if it is not), else offer the Places rating +
   * the optional paste tools. */
  function fallbackDiscovery(who, apiMsg, noExt) {
    function placesOnly() {
        /* No (or exhausted) extension: still give them the Google Places rating
         * if we can, and point at the optional paste tools -- never block. */
        apiFind(who, function (api) {
          if (api && ((api.listings && api.listings.length) || (api.reviews && api.reviews.length))) {
            var payload = weightedSummary(applyUserMarks(mergeApi(emptyPayload(who), api)));
            payload.engine = 'google-places-api';
            payload.scrapedAt = nowIso();
            saveCache(payload, who); broadcast(payload);
            render(payload, '', { kind: 'info', text: (apiMsg || 'Automatic AI search is unavailable right now.') + ' Showing your verified Google rating \u2014 use \u201C\u2795 Add a profile link\u201D to pull the other sites.' });
          } else {
            S.running = false;
            render(loadCache(who), '', { kind: 'info', text: (apiMsg || 'Automatic AI search is unavailable right now.') + ' Enter your details and use \u201C\u2795 Add a profile link\u201D to pull reviews, or open the sites below.' });
          }
          S.running = false;
        });
    }
    /* If we already tried the extension this scan, don't ping it again (avoids
     * an infinite retry loop) -- go straight to the Places rating. */
    if (noExt) { placesOnly(); return; }
    extPing(function (hasExt) {
      if (!hasExt) { placesOnly(); return; }
      /* Extension present -> let it try once (optional power path). */
      var targets = buildTargets(who);
      render(null, 'MLS Assist is reading your profiles across ' + targets.length + ' directories\u2026 (20\u201390s)');
      extScrape(who, targets, function (prog) {
        var stEl = $('rscStatus');
        if (!stEl || !prog || !prog.key) return;
        var st = prog.status || '';
        var label = st === 'searching' ? 'Searching ' + prog.key + '\u2026'
          : st === 'found' ? 'Found your ' + prog.key + ' profile \u2014 reading reviews\u2026'
          : st === 'reading' ? 'Reading ' + prog.key + ' reviews\u2026'
          : st === 'notfound' ? 'No ' + prog.key + ' profile found'
          : 'Checking ' + prog.key + '\u2026';
        stEl.textContent = label;
      }, function (resp) {
        var rs = (resp && resp.results) || [], i;
        if (!rs.length) {
          /* extension present but returned nothing -> single quiet fallback to Places */
          fallbackDiscovery(who, apiMsg, true); return;
        }
        for (i = 0; i < rs.length; i++) { S.perSite[rs[i].key] = rs[i]; }
        finishFromPerSite(who, 'Scan complete (via MLS Assist).');
      });
    });
  }

  function scan(force) {
    var who = getWho();
    S.who = who;
    if (!who.doctor && !who.practice) { render(null, 'Enter the doctor/practice details above first, then scan.'); return; }
    if (!force) {
      var cached = loadCache(who);
      if (cached) { cached = weightedSummary(applyUserMarks(cached)); broadcast(cached); render(cached, 'From cache.'); return; }
    }
    if (S.running) return;
    S.running = true;
    render(null, 'MLS is searching the web for your real profiles &amp; reviews\u2026 (this can take 20\u201360s)');
    autoFind(who, function (res) {
      if (res.status === 'ok') {
        S.running = false;
        var payload = fromAuto(res.payload, who);
        payload.scrapedAt = res.payload.scrapedAt || nowIso();
        /* v1.4.0: ALWAYS merge the authoritative zero-AI Google Places rating
         * (it arrives verified) so the headline can work before any manual
         * confirm; then re-apply the doctor's saved confirm/deny marks. */
        apiFind(who, function (api) {
          payload = weightedSummary(applyUserMarks(mergeApi(payload, api)));
          saveCache(payload, who); broadcast(payload);
          var banner = null;
          if (!payload.grounded) banner = { kind: 'warn', text: (payload.apiMessage || 'The AI could not return verifiable web citations this time \u2014 results below are UNCONFIRMED. Try Rescan or add a profile link.') };
          else if (payload.apiMessage) banner = { kind: 'info', text: payload.apiMessage };
          render(payload, 'Done.', banner);
        });
        return;
      }
      if (res.status === 'auth') {
        /* Not signed in -> can't spend AI. Fall back to the public Google rating. */
        fallbackDiscovery(who, res.message);
        return;
      }
      if (res.status === 'unconfigured') {
        fallbackDiscovery(who, res.message);
        return;
      }
      /* error/timeout -> fall back cleanly */
      fallbackDiscovery(who, res.message);
    });
  }

  /* ------------- MLS Marketing (paid add-on) entry point ---------------- */
  function mktStatus() { try { var o = JSON.parse(lsGet('mlsMkt') || 'null'); return (o && o.status) || ''; } catch (e) { return ''; } }
  function upgradeMarketing() {
    var card = $('repUpsell');
    if (!card) return false;
    card.style.display = 'none';
    card.setAttribute('aria-hidden', 'true');
    return false;
  }
  function renderMkt(row) {
    var st = mktStatus();
    if (st === 'active') {
      row.innerHTML = '<button class="btn green" id="mktGo">\u2699\uFE0F Open MLS Marketing console</button>' +
        '<span class="note">\u2705 Active \u2014 manage replies, campaigns &amp; settings.</span>';
    } else if (st === 'pending') {
      row.innerHTML = '<button class="btn green" id="mktGo">\u23F3 Finish activating MLS Marketing</button>' +
        '<span class="note">Subscription started \u2014 open the console to finish setup.</span>';
    } else {
      row.innerHTML = '<button class="btn green" id="mktGo">\uD83D\uDE80 Let\u2019s do it \u2014 Start MLS Marketing</button>' +
        '<span class="note">Opens the console: activate, subscribe &amp; set what runs automatically. You approve everything before it publishes.</span>';
    }
    var go = $('mktGo');
    if (go) go.onclick = function () { mktOpen(row); };
  }
  function mktOpen(row) {
    if (row) row.innerHTML = '<span class="note">Marketing automation is not released yet.</span>';
    return false;
  }

  /* Neutralize review-finder's stale "add API key on the server / paste links"
   * framing (Lane D __mlsRepAuto2). Auto-discovery is the model, so hide the old
   * #repSources "not connected yet" API-key grid and soften the manual-link
   * helper text. Reversible (revert() restores it). */
  function neutralizeStaleCopy() {
    try {
      var grid = $('repSources');
      if (grid && grid.style.display !== 'none') { grid.setAttribute('data-mls-hid', '1'); grid.style.display = 'none'; }
    } catch (e) {}
    try {
      var ta = $('repLinks');
      if (ta && !ta.getAttribute('data-mls-relabel')) {
        ta.setAttribute('data-mls-relabel', '1');
        var host = ta.parentNode;
        if (host) {
          var notes = host.querySelectorAll ? host.querySelectorAll('.note,.hint,small') : [];
          for (var i = 0; i < notes.length; i++) {
            if (/api key|not connected|light up|add.*key/i.test(notes[i].textContent || '')) {
              notes[i].setAttribute('data-mls-hid', '1'); notes[i].style.display = 'none';
            }
          }
        }
      }
    } catch (e) {}
    /* Also hide __mlsRepAuto2's duplicate live card so there is ONE reputation
     * surface (this module) -- the old one still fires /api/reviews/find which
     * is fine as a data source, but its card is now redundant. */
    try {
      var old = $('repLiveCard');
      if (old && old.style.display !== 'none' && !old.getAttribute('data-mls-hid')) { old.setAttribute('data-mls-hid', '1'); old.style.display = 'none'; }
    } catch (e) {}
  }

  /* ------------------------------ mount ---------------------------------- */
  function mount() {
    var who = getWho();
    var cached = loadCache(who);
    if (cached) { cached = weightedSummary(applyUserMarks(cached)); broadcast(cached); render(cached, 'From cache \u2014 Rescan for fresh data.'); }
    else render(null, '');
    var tries = 0;
    var iv = setInterval(function () { neutralizeStaleCopy(); if (upgradeMarketing() || ++tries > 25) clearInterval(iv); }, 800);
    /* NOTE: we do NOT auto-fire the grounded API on load -- it spends the
     * practice's OpenAI usage. The user triggers it with the "Find my profiles
     * & pull reviews" button (or Rescan). Cached results still show instantly. */
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(mount, 600); });
  } else { setTimeout(mount, 600); }

  window.__mlsRepScrape = {
    version: VER,
    scan: scan,
    autoFind: autoFind,               /* exposed for tests */
    getData: function () { return loadCache(getWho()); },
    parsePaste: parsePaste,           /* exposed for tests */
    classifyScope: classifyScope,     /* exposed for tests */
    discoverFromHtml: discoverFromHtml, /* exposed for tests */
    weightedSummary: weightedSummary, /* exposed for tests */
    upgradeMarketing: upgradeMarketing, /* exposed for tests */
    revert: function () {
      try { var c = $(CARD_ID); if (c && c.parentNode) c.parentNode.removeChild(c); } catch (e) {}
      try { var s = $(CARD_ID + 'Css'); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
      try { var s2 = $(CARD_ID + 'HideCss'); if (s2 && s2.parentNode) s2.parentNode.removeChild(s2); } catch (e) {}
      try { var hid = document.querySelectorAll('[data-mls-hid]'); for (var i = 0; i < hid.length; i++) { hid[i].style.display = ''; hid[i].removeAttribute('data-mls-hid'); } } catch (e) {}
      try { delete window.__mlsRepScrape; } catch (e) { window.__mlsRepScrape = undefined; }
      return 'reverted';
    }
  };
})();
