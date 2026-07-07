/* ============================================================================
 * mls_reviews_scrape_app.js -- __mlsRepScrape v1.2.1 (2026-07-07)
 * v1.2.1 (deploy gate): Marketing CTA probes for mls-marketing.html before
 *   opening it; while the console page is not deployed (held for Michael's
 *   approval) the CTA falls back to the honest pending-state + prefilled
 *   email to michael@mlsscribe.com (same pattern the console itself uses
 *   when signed out). Forward-compatible: once the page ships, the same
 *   click opens it.
 * v1.2.0: AUTO-DISCOVERY is the primary path. Doctor enters name + practice;
 *   MLS finds their Healthgrades/Vitals/WebMD/RateMDs/Zocdoc/Google profiles
 *   itself (extension two-hop: open site search -> discover profile link ->
 *   read reviews; paste mode discovers from a pasted search page too), then
 *   pulls every review. Manual link paste demoted to an optional override.
 *   Drops the "add API key on the server / paste links" framing (also hides
 *   review-finder's stale #repSources API-key grid at runtime). MLS Marketing
 *   CTA now opens the real mls-marketing.html console.
 * v1.1.0: + MLS Marketing activation CTA (upgrades review-finder #repUpsell
 *   from a soft interest flag to a real activation flow)
 * ----------------------------------------------------------------------------
 * APP/PAGE-SIDE module for API-free review collection. Designed to be loaded
 * by review-finder.html with ONE tag:
 *     <script src="mls_reviews_scrape_app.js?v=20260707"></script>
 * (also runs standalone on any page for testing; it floats its own card).
 *
 * What it does:
 *   1. EXTENSION SCRAPE (primary): asks MLS Assist (>= the build carrying
 *      ext_reviews_reader.js) to read each review site via the postMessage
 *      bridge -- {source:'mls-app', type:'mlsAppScrapeReviews', job} ->
 *      {source:'mls-ext', type:'mlsAppScrapeResult'} (see SCRAPE_DESIGN.md).
 *   2. ASSISTED CAPTURE (works TODAY, no extension change): per-site "Open"
 *      button + a paste box; pasted page source / text is parsed locally
 *      (JSON-LD first, text heuristics second). Nothing leaves the page.
 *   3. API FALLBACK: GET /api/reviews/find (Lane C) merges in when available.
 *
 * Output: ONE dataset in exactly the /api/reviews/find response shape,
 * cached in localStorage.mlsRFScrapeCache (24h), rendered in its own card
 * with STRICT doctor-vs-practice scope separation (classifier is a verbatim
 * ES5 port of reviewsFind.js classifyScope), and broadcast via
 * document CustomEvent 'mls-reviews-data' for other modules (GBP wizard,
 * __mlsRepAuto2) to consume.
 *
 * Guard: window.__mlsRepScrape. Revert: window.__mlsRepScrape.revert().
 * Pure-ASCII, ES5/ES3-parseable (JScript new Function validated). READ-ONLY:
 * no Athena, no PHI, public business data only.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsRepScrape) return;

  var VER = '1.2.1';
  var MKT_URL = 'mls-marketing.html';
  var BK = 'https://scrivara-backend.onrender.com';
  var CACHE_KEY = 'mlsRFScrapeCache';
  var CACHE_TTL = 24 * 60 * 60 * 1000;
  var EXT_TIMEOUT = 120000; /* whole job */
  var CARD_ID = 'repScrapeCard';

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
    /* Prefer the live review-finder form (its doc() helper), else mlsRF store */
    try { if (typeof window.doc === 'function') { var d = window.doc(); if (d && (d.name || d.practice)) return { doctor: d.name || '', practice: d.practice || '', city: d.city || '' }; } } catch (e) {}
    try {
      var saved = JSON.parse(lsGet('mlsRF') || '{}');
      if (saved && saved.doc) return { doctor: saved.doc.name || '', practice: saved.doc.practice || '', city: saved.doc.city || '' };
    } catch (e) {}
    return { doctor: '', practice: '', city: '' };
  }
  function manualLinks() {
    var raw = lsGet('mlsRFLinks') || '';
    var lines = raw.split(/\r?\n/), out = [], i, u;
    for (i = 0; i < lines.length; i++) {
      u = lines[i].replace(/^\s+|\s+$/g, '');
      if (/^https?:\/\//i.test(u)) out.push(u);
      if (out.length >= 6) break;
    }
    return out;
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
  /* PROFILE-URL patterns (a real doctor profile, not a search page) \u2014 kept in
   * sync with ext_reviews_reader.js PROFILE_PATTERNS. */
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
  /* Pull the doctor's profile links out of a pasted SEARCH-RESULTS page (paste
   * fallback for auto-discovery when the extension isn't driving it). */
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
  /* add discovered links into mlsRFLinks so the next scan uses them directly */
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
      /* practice listing carries most reviews; doctor listing checked via links */
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
    /* direct profile links first (highest fidelity) */
    for (i = 0; i < links.length; i++) {
      k = keyForUrl(links[i]);
      out.push({ key: k, url: links[i], direct: true });
      used[k] = true;
    }
    /* search URLs for sites we have no direct link for */
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
             scraped: true, scrapedAt: nowIso() };
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
        url: L.url || r.url, website: null });
    }
    var revs = r.reviews || [], i;
    for (i = 0; i < revs.length; i++) {
      payload.reviews.push({ source: r.key, scope: scope, listingName: L.name || '',
        rating: revs[i].rating != null ? revs[i].rating : null,
        text: String(revs[i].text || '').slice(0, 1200),
        author: String(revs[i].author || '').slice(0, 120),
        when: revs[i].when || null });
      if (payload.reviews.length >= 300) break;
    }
  }
  function summarize(payload) {
    var d = { rating: null, reviewCount: 0, listings: 0 };
    var p = { rating: null, reviewCount: 0, listings: 0 };
    var i, L, bucket;
    for (i = 0; i < payload.listings.length; i++) {
      L = payload.listings[i];
      bucket = (L.scope === 'doctor') ? d : (L.scope === 'practice') ? p : null;
      if (!bucket) continue;
      bucket.listings++;
      if (L.reviewCount) bucket.reviewCount += L.reviewCount;
      if (L.rating != null && (bucket.rating == null || L.rating > bucket.rating)) bucket.rating = L.rating;
    }
    payload.summary = { doctor: d, practice: p };
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

  /* ------------------------ extension scrape path ------------------------ */
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

  /* --------------------------- API fallback ------------------------------ */
  function apiFind(who, cb) {
    var u = BK + '/api/reviews/find?doctor=' + enc(who.doctor) + '&practice=' + enc(who.practice) + '&city=' + enc(who.city);
    try {
      fetch(u).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; })
        .then(function (j) { cb(j && j.ok ? j : null); }, function () { cb(null); });
    } catch (e) { cb(null); }
  }
  function mergeApi(payload, api) {
    if (!api) return payload;
    var i, k;
    /* API listings/reviews only for sources the scrape did not cover */
    var have = {};
    for (i = 0; i < payload.listings.length; i++) have[payload.listings[i].source] = 1;
    var als = api.listings || [];
    for (i = 0; i < als.length; i++) { if (!have[als[i].source]) payload.listings.push(als[i]); }
    var arv = api.reviews || [];
    for (i = 0; i < arv.length; i++) { if (!have[arv[i].source]) payload.reviews.push(arv[i]); }
    if (api.sources) { for (k in api.sources) { if (!payload.sources[k] || payload.sources[k].status === 'error') { payload.sources[k] = api.sources[k]; payload.sources[k].method = 'api'; } } }
    return payload;
  }

  /* ------------------- paste capture (zero-dependency) ------------------- */
  function parsePaste(text, key, who) {
    text = String(text || '');
    if (!text) return { ok: false, key: key, error: 'empty' };
    /* 1) page-source paste: extract JSON-LD blocks */
    var reviews = [], listing = { name: null, rating: null, reviewCount: null, address: null, url: null };
    var m, re = /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi, foundLd = false;
    while ((m = re.exec(text))) {
      var parsed = null;
      try { parsed = JSON.parse(m[1]); } catch (e) { parsed = null; }
      if (!parsed) continue;
      foundLd = true;
      absorbLdInto(parsed, listing, reviews, 0);
    }
    /* 2) plain-text heuristics */
    if (!foundLd) {
      var agg = text.match(/(\d(?:\.\d)?)\s*(?:out of 5|stars?|\u2605)?[^\n]{0,40}?([\d,]{1,7})\s*(?:patient\s+|Google\s+)?reviews?/i);
      if (agg) { listing.rating = toNum(agg[1]); listing.reviewCount = toInt(agg[2]); }
      var blocks = text.split(/\n\s*\n/), i;
      for (i = 0; i < blocks.length && reviews.length < 60; i++) {
        var b = blocks[i].replace(/^\s+|\s+$/g, '');
        if (b.length < 40) continue;
        if (/<a\s|<\/?(?:div|span|li|script|a)\b/i.test(b)) continue; /* skip raw HTML/anchor soup */
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
    '#' + CARD_ID + ' .rsc-prac{background:#e8effc;color:#1c4fa0}',
    '#' + CARD_ID + ' .rsc-unk{background:#f1f2f6;color:#666}',
    '#' + CARD_ID + ' .rsc-src{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}',
    '#' + CARD_ID + ' .rsc-chip{border:1px solid #dde4f0;border-radius:999px;padding:4px 10px;font-size:12px}',
    '#' + CARD_ID + ' .rsc-ok{border-color:#9adbb6;background:#effaf3}',
    '#' + CARD_ID + ' .rsc-err{border-color:#f0c1c1;background:#fdf1f1}',
    '#' + CARD_ID + ' .rsc-rev{border-top:1px solid #eef1f7;padding:9px 0;font-size:13px}',
    '#' + CARD_ID + ' .rsc-btn{cursor:pointer;border:0;border-radius:9px;padding:9px 14px;font-weight:700;font-size:13px}',
    '#' + CARD_ID + ' .rsc-primary{background:linear-gradient(90deg,#19b8a6,#2f6bed);color:#fff}',
    '#' + CARD_ID + ' .rsc-ghost{background:#eef2fa;color:#24406e}',
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
    return '<span class="rsc-badge rsc-unk">UNVERIFIED</span>';
  }
  function render(payload, statusLine) {
    var card = ensureCard();
    var h = [];
    h.push('<h2>\uD83D\uDD0E Find &amp; pull my reviews \u2014 automatically</h2>');
    h.push('<div class="rsc-note">Just your name + practice above. MLS finds your profiles on Google, Healthgrades, Vitals, WebMD, RateMDs &amp; Zocdoc and pulls every review \u2014 <b>no API keys, no links to hunt down</b>. A practice rating is never shown as the doctor\u2019s personal rating.</div>');
    h.push('<div style="margin:10px 0"><button class="rsc-btn rsc-primary" id="rscScanBtn">\uD83D\uDD0E Find my profiles &amp; pull reviews</button> ' +
           '<button class="rsc-btn rsc-ghost" id="rscPasteBtn">\u2795 Add a profile link (optional)</button> ' +
           '<span class="rsc-note" id="rscStatus">' + esc(statusLine || '') + '</span></div>');
    if (payload) {
      var d = payload.summary.doctor, p = payload.summary.practice;
      h.push('<div class="rsc-kpis">');
      h.push('<div class="rsc-kpi"><div>Doctor\u2019s own rating ' + scopeBadge('doctor') + '</div><b>' + (d.rating != null ? d.rating.toFixed(1) + '\u2605' : '\u2014') + '</b><div class="rsc-note">' + (d.reviewCount || 0) + ' reviews \u00B7 ' + d.listings + ' listing(s)</div></div>');
      h.push('<div class="rsc-kpi"><div>Practice-wide rating ' + scopeBadge('practice') + '</div><b>' + (p.rating != null ? p.rating.toFixed(1) + '\u2605' : '\u2014') + '</b><div class="rsc-note">' + (p.reviewCount || 0) + ' reviews \u00B7 ' + p.listings + ' listing(s) \u2014 reflects the whole office, not the doctor personally</div></div>');
      h.push('</div>');
      h.push('<div class="rsc-src">');
      var k, srcs = payload.sources;
      for (k in srcs) {
        if (!srcs.hasOwnProperty(k)) continue;
        var s = srcs[k], ok = s.status === 'scraped' || s.status === 'ok';
        h.push('<span class="rsc-chip ' + (ok ? 'rsc-ok' : 'rsc-err') + '">' + esc(k) + ': ' + esc(s.status) + (s.method ? ' (' + esc(s.method) + ')' : '') + '</span>');
      }
      h.push('</div>');
      var revs = payload.reviews.slice(0, 25), i;
      if (revs.length) {
        h.push('<div style="margin-top:6px;font-weight:700;font-size:13px">Latest captured reviews (' + payload.reviews.length + ' total)</div>');
        for (i = 0; i < revs.length; i++) {
          var r = revs[i];
          h.push('<div class="rsc-rev">' + (r.rating != null ? ('<b>' + r.rating + '\u2605</b> ') : '') + scopeBadge(r.scope) +
                 ' <span class="rsc-note">' + esc(r.source) + (r.author ? ' \u00B7 ' + esc(r.author) : '') + (r.when ? ' \u00B7 ' + esc(r.when) : '') + '</span>' +
                 '<div>' + esc(String(r.text || '').slice(0, 420)) + '</div></div>');
        }
      }
      h.push('<div class="rsc-note" style="margin-top:8px">Captured ' + esc(payload.scrapedAt || '') + ' \u00B7 cached 24h \u00B7 <a href="#" id="rscRescan">Rescan</a></div>');
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
    var sb = $('rscScanBtn'); if (sb) sb.onclick = function () { scan(true); };
    var rs = $('rscRescan'); if (rs) rs.onclick = function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); scan(true); return false; };
    var pb = $('rscPasteBtn'); if (pb) pb.onclick = function () {
      var box = $('rscPasteBox'); if (!box) return;
      box.style.display = (box.style.display === 'none') ? '' : 'none';
      var row = $('rscOpenRow'), sel = $('rscPasteSite');
      if (row && !row.childNodes.length) {
        var t = buildTargets(who), i, html = '', opts = '';
        for (i = 0; i < t.length; i++) {
          html += '<a class="rsc-chip" target="_blank" rel="noopener" href="' + esc(t[i].url) + '">\u2197 ' + esc(t[i].key) + (t[i].direct ? ' (your link)' : ' (search)') + '</a>';
          opts += '<option value="' + esc(t[i].key) + '">' + esc(t[i].key) + '</option>';
        }
        row.innerHTML = html;
        if (sel) sel.innerHTML = opts;
      }
    };
    var pg = $('rscPasteGo'); if (pg) pg.onclick = function () {
      var ta = $('rscPasteTa'), note = $('rscPasteNote'), sel = $('rscPasteSite');
      var val = ta ? ta.value : '';
      /* bare profile URL pasted -> remember it, then auto-scan */
      var trimmed = String(val).replace(/^\s+|\s+$/g, '');
      if (/^https?:\/\/\S+$/.test(trimmed) && trimmed.indexOf('\n') < 0) {
        var added = rememberLinks([{ url: trimmed, key: keyForUrl(trimmed) }]);
        if (note) note.textContent = added ? 'Added \u2014 pulling reviews\u2026' : 'Already on the list \u2014 pulling reviews\u2026';
        if (ta) ta.value = ''; scan(true); return;
      }
      var key = sel && sel.value ? sel.value : 'website';
      /* SEARCH-RESULTS page (>=2 profile links) -> auto-discover, don't parse */
      var found = discoverFromHtml(val, who);
      if (found.length >= 2) {
        rememberLinks(found);
        if (note) note.textContent = 'Found ' + found.length + ' profile link(s) \u2014 pulling reviews\u2026';
        if (ta) ta.value = ''; scan(true); return;
      }
      /* otherwise treat as a profile/review page */
      var r = parsePaste(val, key, who);
      if (r.ok) { S.perSite[key] = r; finishFromPerSite(who, 'Captured ' + key + '.'); if (ta) ta.value = ''; return; }
      /* single discovered link fallback */
      if (found.length === 1) {
        rememberLinks(found);
        if (note) note.textContent = 'Found your ' + found[0].key + ' profile \u2014 pulling reviews\u2026';
        if (ta) ta.value = ''; scan(true); return;
      }
      if (note) note.textContent = 'Nothing recognized \u2014 paste a profile page, a search-results page, or a profile URL.';
    };
  }

  /* ------------------------------ scan flow ------------------------------ */
  function finishFromPerSite(who, statusLine) {
    var payload = emptyPayload(who), k;
    for (k in S.perSite) { if (S.perSite.hasOwnProperty(k)) absorb(payload, S.perSite[k], who); }
    apiFind(who, function (api) {
      payload = summarize(mergeApi(payload, api));
      saveCache(payload, who);
      broadcast(payload);
      render(payload, statusLine || 'Done.');
    });
  }
  function scan(force) {
    var who = getWho();
    S.who = who;
    if (!who.doctor && !who.practice) { render(null, 'Enter the doctor/practice details above first, then scan.'); return; }
    if (!force) {
      var cached = loadCache(who);
      if (cached) { broadcast(cached); render(cached, 'From cache.'); return; }
    }
    if (S.running) return;
    S.running = true;
    var targets = buildTargets(who);
    S.targets = targets;
    var haveLinks = manualLinks().length;
    render(null, haveLinks ? 'Finding & reading your profiles\u2026' : 'Searching directories for your profiles\u2026');
    extPing(function (hasExt) {
      if (!hasExt) {
        S.running = false;
        render(loadCache(who), 'MLS Assist isn\u2019t installed \u2014 install it for fully automatic profile-finding, or use \u201C\u2795 Add a profile link\u201D below to pull reviews without it.');
        return;
      }
      render(null, 'MLS is finding your profiles across ' + targets.length + ' directories\u2026 (20\u201390s)');
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
        S.running = false;
        var rs = (resp && resp.results) || [], i;
        if (!rs.length && resp && resp.error === 'timeout') {
          /* extension present but no scrape support yet -> honest fallback */
          render(loadCache(who), 'Your MLS Assist needs updating to auto-find profiles \u2014 update the extension, or use \u201C\u2795 Add a profile link\u201D below.');
          return;
        }
        for (i = 0; i < rs.length; i++) { S.perSite[rs[i].key] = rs[i]; }
        finishFromPerSite(who, 'Scan complete.');
      });
    });
  }

  /* ------------- MLS Marketing (paid add-on) entry point ---------------- */
  /* Upgrades review-finder's #repUpsell card into a real "go" that opens the
   * MLS Marketing console (mls-marketing.html) \u2014 the full activate + subscribe
   * + settings + review-reply-queue + campaign surface. The card reflects the
   * console's status (localStorage.mlsMkt.status) and passes the doctor context
   * along (the console reads mlsRF/mlsRFScrapeCache). All backend hooks the
   * console needs are flagged in FINAL_REPORT. */
  function mktStatus() { try { var o = JSON.parse(lsGet('mlsMkt') || 'null'); return (o && o.status) || ''; } catch (e) { return ''; } }
  function upgradeMarketing() {
    var card = $('repUpsell');
    if (!card) return false;
    if (card.getAttribute('data-mkt-upgraded')) return true;
    card.setAttribute('data-mkt-upgraded', '1');
    var row = card.querySelector('.row');
    if (!row) { row = document.createElement('div'); row.className = 'row'; card.appendChild(row); }
    row.id = 'mktRow';
    renderMkt(row);
    return true;
  }
  function renderMkt(row) {
    var st = mktStatus();
    if (st === 'active') {
      row.innerHTML = '<button class="btn green" id="mktGo">\u2699\ufe0f Open MLS Marketing console</button>' +
        '<span class="note">\u2705 Active \u2014 manage replies, campaigns &amp; settings.</span>';
    } else if (st === 'pending') {
      row.innerHTML = '<button class="btn green" id="mktGo">\u23f3 Finish activating MLS Marketing</button>' +
        '<span class="note">Subscription started \u2014 open the console to finish setup.</span>';
    } else {
      row.innerHTML = '<button class="btn green" id="mktGo">\ud83d\ude80 Let\u2019s do it \u2014 Start MLS Marketing</button>' +
        '<span class="note">Opens the console: activate, subscribe &amp; set what runs automatically. You approve everything before it publishes.</span>';
    }
    var go = $('mktGo');
    if (go) go.onclick = function () { mktOpen(row); };
  }
  /* Open the console if it is deployed; otherwise (page held / 404) take the
   * honest email path and mark the request pending, exactly like the console's
   * own signed-out fallback. */
  function mktOpen(row) {
    function fallback() {
      try { localStorage.setItem('mlsMkt', JSON.stringify({ status: 'pending', via: 'email', at: new Date().toISOString() })); } catch (e) {}
      try { if (row) renderMkt(row); } catch (e) {}
      var sub = 'MLS Marketing - please activate my practice';
      var body = 'Hi Michael,\n\nPlease activate the MLS Marketing add-on for my practice. (Sent from the review finder - the marketing console page is not live yet.)\n\nThanks!';
      location.href = 'mailto:michael@mlsscribe.com?subject=' + encodeURIComponent(sub) + '&body=' + encodeURIComponent(body);
    }
    try {
      fetch(MKT_URL, { method: 'HEAD', cache: 'no-store' }).then(function (r) {
        if (r && r.ok) { try { window.open(MKT_URL, '_blank'); } catch (e) { location.href = MKT_URL; } }
        else { fallback(); }
      }, function () { fallback(); });
    } catch (e) { fallback(); }
  }

  /* Neutralize review-finder's stale "add API key on the server / paste links"
   * framing (Lane D __mlsRepAuto2). Auto-discovery is now the model, so hide the
   * old #repSources "not connected yet" API-key grid and relabel the manual
   * link box as an optional override. Reversible (revert() restores it). */
  function neutralizeStaleCopy() {
    try {
      var grid = $('repSources');
      if (grid && grid.style.display !== 'none') { grid.setAttribute('data-mls-hid', '1'); grid.style.display = 'none'; }
    } catch (e) {}
    try {
      var ta = $('repLinks');
      if (ta && !ta.getAttribute('data-mls-relabel')) {
        ta.setAttribute('data-mls-relabel', '1');
        var lab = ta.previousElementSibling;
        /* soften any nearby "API key / not connected" helper text */
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
  }

  /* ------------------------------ mount ---------------------------------- */
  function mount() {
    var who = getWho();
    var cached = loadCache(who);
    if (cached) { broadcast(cached); render(cached, 'From cache \u2014 Rescan for fresh data.'); }
    else render(null, '');
    var tries = 0;
    var iv = setInterval(function () { neutralizeStaleCopy(); if (upgradeMarketing() || ++tries > 25) clearInterval(iv); }, 800);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(mount, 600); });
  } else { setTimeout(mount, 600); }

  window.__mlsRepScrape = {
    version: VER,
    scan: scan,
    getData: function () { return loadCache(getWho()); },
    parsePaste: parsePaste,           /* exposed for tests */
    classifyScope: classifyScope,     /* exposed for tests */
    discoverFromHtml: discoverFromHtml, /* exposed for tests */
    upgradeMarketing: upgradeMarketing, /* exposed for tests */
    revert: function () {
      try { var c = $(CARD_ID); if (c && c.parentNode) c.parentNode.removeChild(c); } catch (e) {}
      try { var s = $(CARD_ID + 'Css'); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
      try { var hid = document.querySelectorAll('[data-mls-hid]'); for (var i = 0; i < hid.length; i++) { hid[i].style.display = ''; hid[i].removeAttribute('data-mls-hid'); } } catch (e) {}
      try { delete window.__mlsRepScrape; } catch (e) { window.__mlsRepScrape = undefined; }
      return 'reverted';
    }
  };
})();
