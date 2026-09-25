'use strict';
/*
 * h9-1.0.0 (2026-09-25): the MLS Best Doctors pages say only what happened.
 *
 * The directory is dark in production and the rating engine ingests nothing
 * today; these cases are about the day either is switched on. Each one ran red
 * on f57f2aaf, driven through the page's real script against scripted answers:
 *
 *   BD-3  The patient's opt-out link came back from every ingest, and the only
 *         client dropped it: the toast never showed it, so the one published
 *         page of this lane could not be reached for any scored visit.
 *   BD-4  The console told doctors to "Ask us to exclude a visit" and had no
 *         control; the route now takes the visit's ref and the console calls it.
 *   BD-7  A refused profile save (401, 500) said "Saved locally (service not
 *         live yet)." The page keeps no local copy; a reload lost the edits.
 *   BD-8  A slow answer for an older search replaced the current results.
 *   BD-9  Reloading the opt-out page, even right after "Done", said the link was
 *         incomplete and blamed the email program.
 *
 * h9-1.1.0 (2026-09-25), second review round; each was red on the round-1 fix:
 *
 *   BD-9  The reopen message said "that choice is saved" to every tokenless load,
 *         including a reload after a failed save. It now claims nothing and
 *         says the link shows whether the visit is already excluded.
 *   BD-4  The console said excluding "can never raise" the rating; it can (the
 *         rating is a weighted mean). Exclude/Restore re-ran the profile load
 *         and overwrote unsaved profile edits; it now refreshes only the rating
 *         and visits. A refused restore shows the server's reason (409), and a
 *         401/403 says to sign in again, as does a 403 on the profile save.
 *   BD-3  The link toast stayed up while the next visit was signed, so a failed,
 *         skipped or silent send left the previous patient's link on screen. A
 *         Sign for a different visit now clears it, and the link names its
 *         visit ref and date.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const inlineScript = (html) => {
  const blocks = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];
  return blocks[blocks.length - 1][1];
};
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
const text = (html) => String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/* A small element store: enough DOM for these pages' own scripts. Buttons a
   page renders into innerHTML are materialised on demand so a test can press
   them the way a doctor would. */
function fakeDom() {
  const els = {};
  const made = [];
  function el(id) {
    if (els[id]) return els[id];
    const e = {
      id, innerHTML: '', textContent: '', value: '', className: '', checked: false, disabled: false,
      attrs: {}, handlers: {}, children: [],
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      addEventListener(t, fn) { (this.handlers[t] = this.handlers[t] || []).push(fn); },
      appendChild(c) { this.children.push(c); c.parentNode = this; if (c.id) els[c.id] = c; return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; if (c.id && els[c.id] === c) delete els[c.id]; },
      getElementsByClassName(cls) {
        /* Same markup, same element objects: what the page wired is what a test presses. */
        const key = cls + '\u0000' + this.innerHTML;
        if (this._cls && this._cls.key === key) return this._cls.out;
        const out = [];
        const re = /<(\w+)\b([^>]*)>/g;
        let m;
        while ((m = re.exec(this.innerHTML))) {
          const attrs = {};
          m[2].replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => { attrs[k] = v.replace(/&amp;/g, '&'); });
          if ((' ' + (attrs.class || '') + ' ').indexOf(' ' + cls + ' ') === -1) continue;
          const b = { attrs, disabled: false, textContent: '', onclick: null, getAttribute(k) { return k in attrs ? attrs[k] : null; } };
          out.push(b);
        }
        made.push(...out);
        this._cls = { key, out };
        return out;
      },
      getElementsByTagName() { return []; },
    };
    els[id] = e;
    return e;
  }
  /* An id first seen inside rendered markup starts with that markup's value. */
  function byId(id) {
    if (els[id]) return els[id];
    const e = el(id);
    for (const k of Object.keys(els)) {
      const m = new RegExp('<\\w+\\b[^>]*\\bid="' + id + '"[^>]*>').exec(els[k].innerHTML);
      const v = m && /\bvalue="([^"]*)"/.exec(m[0]);
      if (v) { e.value = v[1].replace(/&amp;/g, '&'); break; }
    }
    return e;
  }
  return {
    el,
    has: (id) => !!els[id],
    document: {
      getElementById: byId,
      getElementsByName: () => [],
      createElement: () => el('__new' + made.length + Math.random()),
      addEventListener() {},
      removeEventListener() {},
      get body() { return el('__body'); },
      get head() { return el('__head'); },
      documentElement: el('__html'),
    },
  };
}
function storage(seed) {
  const m = Object.assign({}, seed);
  return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, _m: m };
}
function answer(status, json) {
  return { ok: status >= 200 && status < 300, status, json: () => (json === undefined ? Promise.reject(new Error('no body')) : Promise.resolve(json)) };
}

(async () => {
  /* ---------------- BD-9: the opt-out page after a reload ---------------- */
  {
    const code = inlineScript(read('best-doctors-optout.html'));
    const runOptout = (query) => {
      const dom = fakeDom();
      const calls = [];
      const sb = {
        window: { __mlsSensitiveUrl: { query } }, document: dom.document, encodeURIComponent,
        mlsSensitiveFetch: (u, o) => { calls.push(o && o.method || 'GET'); return new Promise(() => {}); },
      };
      vm.createContext(sb);
      vm.runInContext(code, sb);
      return { body: text(dom.el('body').innerHTML), calls };
    };
    const reloaded = runOptout({});
    assert(/open your link again/i.test(reloaded.body), 'a reload (token scrubbed from the bar) must ask to reopen the link: ' + reloaded.body);
    assert(!/incomplete|email programs/i.test(reloaded.body), 'a reload must not blame the link or the email program: ' + reloaded.body);
    /* h9-1.1.0: the page cannot know what happened before the reload (the save
       may have failed), so it claims nothing; the link itself shows the state. */
    assert(!/\bsaved\b|\bdone\b|recorded/i.test(reloaded.body), 'a tokenless load must never claim a choice was saved: ' + reloaded.body);
    assert(/shows whether your visit is already excluded/i.test(reloaded.body), 'a tokenless load must say the link shows whether the visit is already excluded: ' + reloaded.body);
    assert.deepStrictEqual(reloaded.calls, [], 'with no token there is nothing to ask the server');
    const broken = runOptout({ t: 'abc123' });
    assert(/incomplete/i.test(broken.body), 'a malformed token is still reported as a broken link: ' + broken.body);
    assert.deepStrictEqual(runOptout({ t: 'a'.repeat(48) }).calls, ['GET'], 'a well-formed token still loads the choice');
  }

  /* ---------------- BD-3: the ingest toast carries the opt-out link ---------------- */
  {
    const code = read('feat_mls_best_doctors.js');
    const OPT = 'https://mlsscribe.com/best-doctors-optout.html?t=' + 'b'.repeat(48);
    const T = 'Doctor: How are you feeling? I hear you. Patient: sore knee, thank you. '.repeat(8);
    /* The clock the page stamps occurred_at with: 2026-09-24 (UTC). */
    class FixedDate extends Date { constructor(...a) { super(...(a.length ? a : ['2026-09-24T15:00:00Z'])); } }
    const run = (plan) => {
      const dom = fakeDom();
      dom.el('transcript').value = T;
      const timers = [];
      const posts = [];
      const clicks = [];
      let copied = null;
      dom.document.addEventListener = (type, fn) => { if (type === 'click') clicks.push(fn); };
      const sb = {
        window: {}, document: dom.document, JSON, String, Date: FixedDate,
        sessionStorage: storage({ sf_bk_token: 'tok' }), localStorage: storage({}),
        navigator: { clipboard: { writeText: (v) => { copied = v; return Promise.resolve(); } } },
        setTimeout: (fn, ms) => { timers.push(ms); return 0; },
        fetch: (u, o) => { posts.push({ u, body: JSON.parse(o.body) }); const s = plan.shift(); return s.reject ? Promise.reject(new Error('offline')) : s.later ? s.later : Promise.resolve(s); },
      };
      sb.window = sb;
      vm.createContext(sb);
      vm.runInContext(code, sb);
      /* The toast actually on screen (null once removed), not a stale lookup. */
      const shown = () => dom.el('__body').children.find((c) => c.id === 'mlsBdToast') || null;
      const sign = (label) => clicks.forEach((fn) => fn({ target: { closest: () => ({ textContent: label }), textContent: label } }));
      return { sb, dom, timers, posts, clicks, sign, shown, copied: () => copied };
    };
    /* The server's two answers, as visitRatings.js sends them. */
    const ingest = { ok: true, ref: 'VR-AAAAAA', date: '2026-09-23', countsToward: true, reason: 'counted_verified', verified: true, optoutUrl: OPT,
      doctor: { countedVisits: 1, stars: 3.4, minVisits: 15, published: false } };
    const deduped = { ok: true, deduped: true, ref: 'VR-AAAAAA', date: '2026-09-23', score: 80, countsToward: true, dimensions: {}, optoutUrl: OPT,
      doctor: { countedVisits: 1, stars: 3.4, minVisits: 15, published: false } };

    let r = run([answer(200, ingest)]);
    r.sb.__mlsBestDoctors.submit(false);
    await settle();
    const toast = r.shown();
    assert(toast && toast.innerHTML.indexOf(OPT) !== -1, 'the toast must show the patient opt-out link: ' + text(toast && toast.innerHTML));
    assert(/MLS has not sent it/i.test(toast.innerHTML), 'the toast must say MLS did not deliver the link');
    assert(/VR-AAAAAA/.test(text(toast.innerHTML)) && /2026-09-23/.test(text(toast.innerHTML)),
      'the link names the visit it belongs to (ref and date): ' + text(toast.innerHTML));
    assert(!r.timers.includes(12000), 'a toast carrying the link must stay until dismissed');
    r.dom.el('mlsBdCopy').onclick();
    await settle();
    assert.strictEqual(r.copied(), OPT, 'Copy link must copy the opt-out link');
    assert.strictEqual(r.dom.el('mlsBdCopy').textContent, 'Copied');

    /* A lost answer must not block the retry that carries the link. */
    r = run([{ reject: true }, answer(200, deduped)]);
    r.sb.__mlsBestDoctors.submit(false);
    await settle();
    r.sb.__mlsBestDoctors.submit(false);
    await settle();
    assert.strictEqual(r.posts.length, 2, 'after a failed send the next Sign must send again');
    assert(r.shown() && r.shown().innerHTML.indexOf(OPT) !== -1, 'the deduped retry must show the same opt-out link');
    assert(/VR-AAAAAA/.test(r.shown().innerHTML) && !/0\/\?/.test(text(r.shown().innerHTML)), 'the deduped retry reads like a first answer: ' + text(r.shown().innerHTML));

    /* An answer without a date (an older server) is labelled with the date sent. */
    r = run([answer(200, Object.assign({}, ingest, { date: undefined }))]);
    r.sb.__mlsBestDoctors.submit(false);
    await settle();
    assert.strictEqual(r.posts[0].body.occurred_at, '2026-09-24');
    assert(/VR-AAAAAA/.test(text(r.shown().innerHTML)) && /2026-09-24/.test(text(r.shown().innerHTML)), 'fallback label: ' + text(r.shown().innerHTML));

    /* h9-1.1.0: signing a different visit clears the previous patient's link at
       once, whatever then happens to the new send. */
    const T2 = 'Doctor: Tell me about the shoulder. Patient: it clicks when I reach up, thanks. '.repeat(8);
    for (const [name, next, plan] of [
      ['a failed send', () => { r.dom.el('transcript').value = T2; r.sb.__mlsBestDoctors.submit(false); }, [answer(500, { error: 'x' })]],
      ['a lost answer', () => { r.dom.el('transcript').value = T2; r.sb.__mlsBestDoctors.submit(false); }, [{ reject: true }]],
      ['a silent send', () => { r.dom.el('transcript').value = T2; r.sb.__mlsBestDoctors.submit(true); }, [answer(200, Object.assign({}, ingest, { ref: 'VR-BBBBBB' }))]],
      ['a transcript too short to send', () => { r.dom.el('transcript').value = 'Brief visit.'; r.sb.__mlsBestDoctors.submit(false); }, []],
      ['no sign-in', () => { r.dom.el('transcript').value = T2; r.sb.sessionStorage.removeItem('sf_bk_token'); r.sb.__mlsBestDoctors.submit(false); }, []],
      ['a Sign click (before its 1.5 s delay)', () => { r.dom.el('transcript').value = T2; r.sign('Sign'); }, []],
    ]) {
      r = run([answer(200, ingest)].concat(plan));
      r.sb.__mlsBestDoctors.submit(false);
      await settle();
      assert(r.shown() && r.shown().innerHTML.indexOf(OPT) !== -1, name + ': fixture shows patient A\'s link');
      next();
      assert.strictEqual(r.shown(), null, name + ': the previous patient\'s link must leave the screen when the next visit is signed');
      await settle();
      assert(!r.shown() || r.shown().innerHTML.indexOf(OPT) === -1, name + ': the previous patient\'s link must not come back: ' + text(r.shown() && r.shown().innerHTML));
    }
    /* An answer for patient A that lands after patient B's Sign never paints
       A's link; A's next Sign asks again and gets it. */
    {
      let release;
      const later = new Promise((res) => { release = res; });
      r = run([{ later }, answer(500, { error: 'x' }), answer(200, deduped)]);
      r.sb.__mlsBestDoctors.submit(false);
      await settle();
      r.dom.el('transcript').value = T2;
      r.sb.__mlsBestDoctors.submit(false);
      await settle();
      release(answer(200, ingest));
      await settle();
      assert(!r.shown() || r.shown().innerHTML.indexOf(OPT) === -1, 'a late answer for the previous patient must not put that link on screen: ' + text(r.shown() && r.shown().innerHTML));
      r.dom.el('transcript').value = T;
      r.sb.__mlsBestDoctors.submit(false);
      await settle();
      assert.strictEqual(r.posts.length, 3, 'signing patient A again asks the server again');
      assert(r.shown() && r.shown().innerHTML.indexOf(OPT) !== -1, 'and then shows A\'s link, labelled with its visit');
    }
    /* Pressing Sign again for the same visit keeps that visit's link. */
    r = run([answer(200, ingest)]);
    r.sb.__mlsBestDoctors.submit(false);
    await settle();
    r.sign('Sign & save');
    r.sb.__mlsBestDoctors.submit(false);
    await settle();
    assert.strictEqual(r.posts.length, 1, 'the same transcript is not sent twice');
    assert(r.shown() && r.shown().innerHTML.indexOf(OPT) !== -1, 'a second Sign for the same visit keeps its link on screen');
  }

  /* ---------------- BD-4 + BD-7: the doctor console ---------------- */
  {
    const code = inlineScript(read('mls-best-doctors-admin.html'));
    const run = (route) => {
      const dom = fakeDom();
      const calls = [];
      const sb = {
        window: {}, document: dom.document, JSON, String, Math, encodeURIComponent,
        sessionStorage: storage({ sf_bk_token: 'tok' }), localStorage: storage({}),
        fetch: (u, o) => { calls.push({ u, o: o || {} }); return Promise.resolve(route(u, o || {})); },
      };
      sb.window = sb;
      vm.createContext(sb);
      vm.runInContext(code, sb);
      return { dom, calls };
    };
    const visitA = { ref: 'VR-AAAAAA', date: '2026-09-20', score: 80, confidence: 0.9, countsToward: true, reason: 'counted_verified', verified: true, optout: false, excluded: false };
    const visitB = { ref: 'VR-BBBBBB', date: '2026-09-21', score: 70, confidence: 0.9, countsToward: false, reason: 'patient_opted_out', verified: false, optout: true, excluded: false };
    const visitC = { ref: 'VR-CCCCCC', date: '2026-09-22', score: 60, confidence: 0.9, countsToward: false, reason: 'excluded', verified: true, optout: false, excluded: true };
    const meOf = (counted, visits) => answer(200, { ok: true, rating: { published: false, countedVisits: counted, minVisits: 15 }, totals: {}, visits });
    let meAnswer = meOf(1, [visitA, visitB, visitC]);
    let saveAnswer;
    let excludeAnswer = answer(200, { ok: true, excluded: true });
    const route = (u, o) => {
      if (/\/api\/ratings\/me$/.test(u)) return meAnswer;
      if (/\/api\/best-doctors\/profile$/.test(u) && o.method === 'POST') return saveAnswer;
      if (/\/api\/best-doctors\/profile$/.test(u)) return answer(200, { ok: true, profile: { displayName: 'Dr. Jane Smith', bio: 'Stored bio', city: 'Phila' }, rating: {}, status: {}, placement: {} });
      if (/\/exclude$/.test(u)) return excludeAnswer;
      return answer(404, {});
    };

    for (const [status, body, want] of [
      [401, { error: 'Not authenticated' }, /Not saved\. Sign in to MLS again/],
      [403, { error: 'The owner account cannot access patient data.' }, /Not saved\. Sign in to MLS again/],
      [500, undefined, /Not saved\. Please try again/],
      [400, { ok: false, error: 'bad_photo_url', message: 'The photo link must start with https:// or http://.' }, /Not saved\. The photo link must start/],
    ]) {
      saveAnswer = answer(status, body);
      const r = run(route);
      await settle();
      r.dom.el('bio').value = 'NEW BIO typed by the doctor';
      r.dom.el('saveBtn').onclick();
      await settle();
      const note = r.dom.el('saveNote').textContent;
      assert(!/saved locally/i.test(note), `a ${status} must not read as saved: ${note}`);
      assert(want.test(note), `a ${status} must say it was not saved and why: ${note}`);
      assert.strictEqual(r.dom.el('bio').value, 'NEW BIO typed by the doctor', 'a failed save keeps the form as typed');
    }

    const page = read('mls-best-doctors-admin.html');
    assert(!/Ask us to exclude/.test(page), 'the console must not send doctors elsewhere for an exclusion it can do');
    /* Excluding a below-average visit raises a weighted mean; the page must not say otherwise. */
    assert(!/never raise|cannot raise|can't raise|only (ever )?lower/i.test(page), 'the console must not claim an exclusion cannot raise the rating');
    assert(/If a patient asks, exclude their visit here\./.test(page));

    const r = run(route);
    await settle();
    const rows = r.dom.el('visitsBody');
    const button = (ref) => rows.getElementsByClassName('vx').find((b) => b.getAttribute('data-ref') === ref);
    assert(/no — patient opted out/.test(text(rows.innerHTML)), 'an opted-out visit reads as not counting: ' + text(rows.innerHTML));
    assert.deepStrictEqual(rows.getElementsByClassName('vx').map((b) => b.getAttribute('data-ref') + ':' + b.getAttribute('data-on')), ['VR-AAAAAA:1', 'VR-CCCCCC:0'],
      'Exclude for a counted visit, Restore for an excluded one, and nothing for the visit the patient opted out of');
    assert.strictEqual(r.dom.el('bio').value, 'Stored bio', 'fixture: the stored profile is loaded');

    /* The doctor is mid-edit, then presses Exclude. */
    r.dom.el('bio').value = 'NEW BIO typed, not yet saved';
    r.dom.el('city').value = 'Typed City';
    meAnswer = meOf(0, [Object.assign({}, visitA, { excluded: true, countsToward: false, reason: 'excluded' }), visitB, visitC]);
    let wired = r.calls.length;
    assert.strictEqual(typeof button('VR-AAAAAA').onclick, 'function', 'the Exclude control must be wired');
    button('VR-AAAAAA').onclick.call(button('VR-AAAAAA'));
    await settle();
    let after = r.calls.slice(wired);
    const post = after.find((c) => /\/exclude$/.test(c.u));
    assert(post, 'Exclude must call the exclude route');
    assert(/\/api\/ratings\/visit\/VR-AAAAAA\/exclude$/.test(post.u), 'the route is addressed by the visit ref: ' + post.u);
    assert.deepStrictEqual(JSON.parse(post.o.body), { excluded: true });
    assert(/Excluded/.test(r.dom.el('visitNote').textContent), 'a done exclusion says so');
    assert.deepStrictEqual(after.map((c) => (c.o.method || 'GET') + ' ' + c.u.replace(/^https?:\/\/[^/]+/, '')),
      ['POST /api/ratings/visit/VR-AAAAAA/exclude', 'GET /api/ratings/me'], 'after Exclude only the rating and visits are refreshed');
    assert.strictEqual(r.dom.el('bio').value, 'NEW BIO typed, not yet saved', 'Exclude must not overwrite an unsaved bio');
    assert.strictEqual(r.dom.el('city').value, 'Typed City', 'Exclude must not overwrite an unsaved city');
    assert.strictEqual(button('VR-AAAAAA').getAttribute('data-on'), '0', 'the refreshed table offers Restore for the excluded visit');
    assert(/0 of 15 counted visits/.test(text(r.dom.el('ratingBody').innerHTML)), 'the refreshed rating is shown: ' + text(r.dom.el('ratingBody').innerHTML));

    /* A refused restore says why, and a sign-in failure says to sign in again. */
    const reason = 'Another visit with this patient on 2026-09-22 already counts, and only one visit per patient per day can count. To count this one instead, exclude the other visit first.';
    for (const [ref, ans, want] of [
      ['VR-CCCCCC', answer(409, { ok: false, error: 'same_day_counted', message: reason }), 'Not restored. ' + reason],
      ['VR-CCCCCC', answer(401, { error: 'Not authenticated' }), 'Not restored. Sign in to MLS again, then press Restore.'],
      ['VR-CCCCCC', answer(403, { error: 'The owner account cannot access patient data.' }), 'Not restored. Sign in to MLS again, then press Restore.'],
      ['VR-CCCCCC', answer(500, undefined), 'Not restored. Please try again.'],
      ['VR-AAAAAA', answer(401, { error: 'Not authenticated' }), 'Not excluded. Sign in to MLS again, then press Exclude.'],
      ['VR-AAAAAA', answer(403, { error: 'Lawyer accounts cannot access patient data.' }), 'Not excluded. Sign in to MLS again, then press Exclude.'],
      ['VR-AAAAAA', answer(500, undefined), 'Not excluded. Please try again.'],
    ]) {
      meAnswer = meOf(1, [visitA, visitB, visitC]);
      const q = run(route);
      await settle();
      const b = q.dom.el('visitsBody').getElementsByClassName('vx').find((x) => x.getAttribute('data-ref') === ref);
      excludeAnswer = ans;
      b.onclick.call(b);
      await settle();
      assert.strictEqual(q.dom.el('visitNote').textContent, want, `${ref} answered ${ans.status}`);
      assert.strictEqual(b.disabled, false, 'a refused change leaves the control usable');
    }
    excludeAnswer = answer(200, { ok: true, excluded: true });
  }

  /* ---------------- BD-8: only the newest search paints ---------------- */
  {
    const code = inlineScript(read('mls-best-doctors.html'));
    const dom = fakeDom();
    const pending = [];
    const sb = {
      window: {}, document: dom.document, JSON, String, Math, encodeURIComponent, URLSearchParams,
      location: { search: '' },
      setTimeout: (fn) => { fn(); return 0; }, clearTimeout() {},
      fetch: (u) => new Promise((resolve) => pending.push({ u, resolve })),
    };
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(code, sb);
    const doc = (name) => ({ slug: name.toLowerCase().replace(/\W+/g, '-'), name, specialty: 'Pain', promotion: {} });
    const reply = (p, names) => p.resolve(answer(200, { ok: true, live: true, doctors: names.map(doc), featured: [], specialties: [] }));
    await settle();
    reply(pending.shift(), ['Dr. Ann Jones', 'Dr. Bob Johnson', 'Dr. Cy Jordan']);
    await settle();
    const typeQ = (v) => { dom.el('q').value = v; dom.el('q').handlers.input.forEach((fn) => fn()); };
    typeQ('jo');
    typeQ('johnson');
    const [older, newer] = pending.splice(0);
    assert(/q=jo&/.test(older.u) && /q=johnson&/.test(newer.u), 'two searches in flight');
    reply(newer, ['Dr. Bob Johnson']);
    await settle();
    reply(older, ['Dr. Ann Jones', 'Dr. Bob Johnson', 'Dr. Cy Jordan']);
    await settle();
    const shown = text(dom.el('grid').innerHTML);
    assert(/Bob Johnson/.test(shown) && !/Ann Jones|Cy Jordan/.test(shown), 'a late answer for an older query must not replace the current results: ' + shown);
  }

  console.log('PASS best doctors pages: the opt-out link reaches the clinician with a Copy control, names its visit and leaves the screen when another visit is signed, the console excludes by ref without touching unsaved profile edits and says why a change was refused, never claims an unsaved save, the newest search wins, and a reloaded opt-out page asks to reopen the link without claiming anything was saved');
})().catch((e) => { console.error(e); process.exit(1); });
