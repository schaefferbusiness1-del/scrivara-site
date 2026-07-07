/* ============================================================================
 * ext_reviews_reader.js -- MLS Assist review-site reader (candidate for v1.51+)
 * ----------------------------------------------------------------------------
 * CONTENT SCRIPT module. Add to manifest.json content_scripts "js" AFTER
 * content.js (matches <all_urls> is already the extension's pattern).
 *
 * What it does (READ-ONLY, public business pages, no PHI):
 *   - Exposes window.__mlsReviewsReader.read() which extracts the current
 *     page's review data: listing {name, rating, reviewCount, address, url}
 *     + individual reviews [{rating, text, author, when}].
 *   - Extraction order: (1) schema.org JSON-LD (stable, used by Healthgrades /
 *     Vitals / WebMD / RateMDs / Zocdoc / Yelp / most practice sites),
 *     (2) Google-Maps DOM heuristics (Maps has no JSON-LD),
 *     (3) generic DOM fallback ([itemprop=review] blocks).
 *   - Answers chrome.runtime message {type:'mlsExtReadReviews'} with the read
 *     result (for the background-driven scrape job -- see SCRAPE_DESIGN.md #2).
 *   - Assisted-capture mode: if chrome.storage.local.mlsScrapePending names
 *     this page's host, it auto-reads ~2.5s after load and pushes
 *     {type:'mlsExtScrapeCaptured', resp} to the background for relay to the
 *     MLS tab. This makes the doctor's "Open -> it captures itself" flow work
 *     even before the background tab-driver ships.
 *
 * SAFETY: never clicks, types, signs in, or navigates. Reads DOM text only.
 * Reversible: remove this file from the manifest. Guard: __mlsReviewsReader.
 * Pure-ASCII source. ES5/ES3-parseable (validated with JScript new Function).
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsReviewsReader) return;

  var VER = 'rr-1.0.0';

  /* ------------------------------ helpers -------------------------------- */
  function txt(el) { try { return (el && (el.innerText || el.textContent) || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, ''); } catch (e) { return ''; } }
  function toNum(v) { var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : null; }
  function toInt(v) { var n = parseInt(String(v == null ? '' : v).replace(/[^0-9]/g, ''), 10); return isFinite(n) ? n : null; }
  function clampRating(n) { return (n != null && n >= 0 && n <= 5) ? Math.round(n * 10) / 10 : null; }
  function qsa(sel, root) { try { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); } catch (e) { return []; } }
  function first(sel, root) { try { return (root || document).querySelector(sel); } catch (e) { return null; } }

  /* ------------------------- site detection ------------------------------ */
  /* Same host map as Lane C reviewsFind.js LINK_SOURCES (kept in sync). */
  var SITES = [
    { key: 'google',       re: /(google\.[a-z.]+\/maps|maps\.app\.goo\.gl|g\.page)/i },
    { key: 'healthgrades', re: /healthgrades\.com/i },
    { key: 'vitals',       re: /vitals\.com/i },
    { key: 'webmd',        re: /webmd\.com/i },
    { key: 'ratemds',      re: /ratemds\.com/i },
    { key: 'zocdoc',       re: /zocdoc\.com/i },
    { key: 'yelp',         re: /yelp\.com/i },
    { key: 'facebook',     re: /facebook\.com/i }
  ];
  function siteKey() {
    var u = String(location.href || '');
    for (var i = 0; i < SITES.length; i++) { if (SITES[i].re.test(u)) return SITES[i].key; }
    return 'website';
  }

  /* --------------------------- JSON-LD path ------------------------------ */
  function ldObjects() {
    var out = [];
    var scripts = qsa('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      var raw = scripts[i].textContent || scripts[i].innerText || '';
      if (!raw) continue;
      var parsed = null;
      try { parsed = JSON.parse(raw); } catch (e) { parsed = null; }
      if (!parsed) continue;
      collectLd(parsed, out, 0);
    }
    return out;
  }
  function collectLd(node, out, depth) {
    if (!node || depth > 6) return;
    if (Object.prototype.toString.call(node) === '[object Array]') {
      for (var i = 0; i < node.length; i++) collectLd(node[i], out, depth + 1);
      return;
    }
    if (typeof node === 'object') {
      out.push(node);
      if (node['@graph']) collectLd(node['@graph'], out, depth + 1);
      /* review arrays are walked explicitly in extractLd; only recurse graphs */
    }
  }
  function ldType(o) {
    var t = o && o['@type'];
    if (!t) return '';
    if (Object.prototype.toString.call(t) === '[object Array]') t = t.join(' ');
    return String(t).toLowerCase();
  }
  function ldAuthorName(a) {
    if (!a) return '';
    if (typeof a === 'string') return a;
    if (a.name) return String(a.name);
    return '';
  }
  function extractLd() {
    var objs = ldObjects();
    if (!objs.length) return null;
    var listing = { name: null, rating: null, reviewCount: null, address: null, url: location.href };
    var reviews = [];
    var i, o;
    for (i = 0; i < objs.length; i++) {
      o = objs[i];
      var t = ldType(o);
      /* entity that CARRIES an aggregateRating (Physician, MedicalBusiness, LocalBusiness, Organization...) */
      if (o.aggregateRating) {
        var ar = o.aggregateRating;
        var r = clampRating(toNum(ar.ratingValue));
        var c = toInt(ar.ratingCount != null ? ar.ratingCount : ar.reviewCount);
        if (r != null && listing.rating == null) {
          listing.rating = r;
          listing.reviewCount = c;
          if (o.name && !listing.name) listing.name = String(o.name);
          if (o.address) {
            var ad = o.address;
            if (typeof ad === 'string') listing.address = ad;
            else listing.address = [ad.streetAddress, ad.addressLocality, ad.addressRegion].join(', ').replace(/^, |, ,|, $/g, '');
          }
        }
      }
      /* standalone AggregateRating object */
      if (t.indexOf('aggregaterating') >= 0 && listing.rating == null) {
        listing.rating = clampRating(toNum(o.ratingValue));
        listing.reviewCount = toInt(o.ratingCount != null ? o.ratingCount : o.reviewCount);
      }
      /* Review objects: standalone, or nested under entity.review */
      var revArr = null;
      if (t.indexOf('review') >= 0 && t.indexOf('aggregate') < 0) revArr = [o];
      else if (o.review) revArr = (Object.prototype.toString.call(o.review) === '[object Array]') ? o.review : [o.review];
      if (revArr) {
        for (var j = 0; j < revArr.length; j++) {
          var rv = revArr[j]; if (!rv || typeof rv !== 'object') continue;
          var body = rv.reviewBody != null ? rv.reviewBody : rv.description;
          var rr = rv.reviewRating ? clampRating(toNum(rv.reviewRating.ratingValue)) : null;
          if (body == null && rr == null) continue;
          reviews.push({
            rating: rr,
            text: body != null ? String(body).slice(0, 1200) : '',
            author: ldAuthorName(rv.author).slice(0, 120),
            when: rv.datePublished ? String(rv.datePublished) : null
          });
          if (reviews.length >= 60) break;
        }
      }
    }
    if (listing.rating == null && !reviews.length) return null;
    if (!listing.name) { var h = first('h1'); listing.name = h ? txt(h).slice(0, 160) : (document.title || '').slice(0, 160); }
    return { method: 'jsonld', listing: listing, reviews: reviews };
  }

  /* ------------------------- Google Maps DOM ----------------------------- */
  function starsFromAria(el) {
    var lab = el ? (el.getAttribute('aria-label') || '') : '';
    var m = lab.match(/(\d(?:\.\d)?)\s*star/i);
    return m ? clampRating(toNum(m[1])) : null;
  }
  function readGoogleMaps() {
    var h1 = first('h1');
    var name = h1 ? txt(h1).slice(0, 160) : '';
    var rating = null, count = null;
    /* aggregate: any [role=img] star aria-label near the top; count from nearby "(1,234)" or "N reviews" */
    var imgs = qsa('[role="img"][aria-label]');
    for (var i = 0; i < imgs.length && rating == null; i++) rating = starsFromAria(imgs[i]);
    var body = '';
    try { body = (document.body.innerText || '').slice(0, 200000); } catch (e) { body = ''; }
    var mc = body.match(/(\d(?:\.\d)?)\s*(?:stars?)?\s*[\(\u00B7\u2022]?\s*([\d,]+)\s*(?:Google\s+)?reviews?/i);
    if (mc) { if (rating == null) rating = clampRating(toNum(mc[1])); count = toInt(mc[2]); }
    if (count == null) { var m2 = body.match(/([\d,]+)\s+reviews?/i); if (m2) count = toInt(m2[1]); }
    /* individual reviews: [data-review-id] blocks */
    var reviews = [];
    var blocks = qsa('[data-review-id]');
    var seen = {};
    for (var b = 0; b < blocks.length && reviews.length < 60; b++) {
      var blk = blocks[b];
      var id = blk.getAttribute('data-review-id') || String(b);
      if (seen[id]) continue; seen[id] = 1;
      var rEl = first('[role="img"][aria-label*="star" i]', blk);
      var rr = starsFromAria(rEl);
      /* review text: the longest span in the block */
      var spans = qsa('span', blk); var best = '';
      for (var s = 0; s < spans.length; s++) { var tt = txt(spans[s]); if (tt.length > best.length) best = tt; }
      if (!best && rr == null) continue;
      /* author: first short line of the block */
      var lines = txt(blk).split(/\s{2,}|\n/); var author = (lines[0] || '').slice(0, 80);
      reviews.push({ rating: rr, text: best.slice(0, 1200), author: author, when: null });
    }
    if (rating == null && !reviews.length) return null;
    return { method: 'dom', listing: { name: name, rating: rating, reviewCount: count, address: null, url: location.href }, reviews: reviews };
  }

  /* -------------------------- generic DOM -------------------------------- */
  function readGenericDom() {
    var blocks = qsa('[itemprop="review"], [data-qa-target*="review" i], article[class*="review" i], li[class*="review" i]');
    if (!blocks.length) return null;
    var reviews = [];
    for (var i = 0; i < blocks.length && reviews.length < 60; i++) {
      var blk = blocks[i];
      var t = txt(blk); if (t.length < 25) continue;
      var rr = null;
      var rEl = first('[itemprop="ratingValue"]', blk);
      if (rEl) rr = clampRating(toNum(rEl.getAttribute('content') || txt(rEl)));
      if (rr == null) { var m = t.match(/(\d(?:\.\d)?)\s*(?:out of 5|stars?|\/\s*5)/i); if (m) rr = clampRating(toNum(m[1])); }
      reviews.push({ rating: rr, text: t.slice(0, 1200), author: '', when: null });
    }
    if (!reviews.length) return null;
    var h = first('h1');
    return { method: 'dom', listing: { name: h ? txt(h).slice(0, 160) : (document.title || '').slice(0, 160), rating: null, reviewCount: null, address: null, url: location.href }, reviews: reviews };
  }

  /* ------------------------------ read() --------------------------------- */
  function read() {
    var key = siteKey();
    var got = null, err = null;
    try {
      if (key === 'google') { got = readGoogleMaps() || extractLd(); }
      else { got = extractLd(); if (!got && key !== 'website') got = readGenericDom(); }
    } catch (e) { err = 'reader-exception'; }
    if (!got) {
      return { ok: false, key: key, url: location.href, error: err || 'unreadable',
               hint: 'No structured review data found on this page. If this is a search page, open the actual profile and try again.' };
    }
    return { ok: true, key: key, url: location.href, method: got.method, listing: got.listing, reviews: got.reviews, readerVersion: VER };
  }

  window.__mlsReviewsReader = { version: VER, siteKey: siteKey, read: read };

  /* ---------------- chrome wiring (no-op outside the extension) ---------- */
  var chromeOk = false;
  try { chromeOk = !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage); } catch (e) { chromeOk = false; }
  if (chromeOk) {
    try {
      chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
        if (msg && msg.type === 'mlsExtReadReviews') {
          /* small settle delay helps Maps lazy content; respond async */
          setTimeout(function () { try { sendResponse(read()); } catch (e) {} }, 400);
          return true; /* keep the channel open for the async response */
        }
        return false;
      });
    } catch (e) {}
    /* assisted-capture: a pending job that names this host auto-captures */
    try {
      if (chrome.storage && chrome.storage.local) {
        chrome.storage.local.get('mlsScrapePending', function (o) {
          var p = o && o.mlsScrapePending;
          if (!p || !p.host) return;
          if (String(location.host).indexOf(String(p.host)) < 0) return;
          setTimeout(function () {
            try {
              var resp = read();
              resp.jobId = p.jobId || null;
              chrome.runtime.sendMessage({ type: 'mlsExtScrapeCaptured', resp: resp });
            } catch (e) {}
          }, 2500);
        });
      }
    } catch (e) {}
  }
})();
