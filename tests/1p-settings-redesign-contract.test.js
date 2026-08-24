'use strict';

/* /1p SETTINGS REDESIGN CONTRACT  (t2settings-1.0.0)
 *
 * The owner's order, verbatim: "everything needs to be simple for anyone to do
 * ... fix up and redo the entire Settings UI it's awful", and the standing rule
 * "if it's on the program it should work — if it's there and doesn't work, make
 * it work."
 *
 * This suite is the every-control-pressed inventory. PART 2 opens Settings in
 * real headless Chrome, walks every tab, PRESSES every visible control, and
 * asserts a property of each one. A list of controls kept by hand rots the
 * moment someone adds a switch; this re-measures, so it cannot.
 *
 * THE TRAP THIS SUITE SHARES WITH 1p-clunky-contract AND 1p-ui-shape-contract:
 * 1p-mls-connect.js and its feature modules are NOT loaded by the page on its
 * own. A measurement taken without window.__mlsEnsureUiBundle() measures a bare
 * shell and reports that everything is fine.
 *
 * THE SECOND TRAP, MEASURED DURING THIS LANE: a first sweep scoped its
 * before/after text delta to #settingsModal and called EIGHT controls dead.
 * Five of them were working perfectly — #r44cGbpOpen, #mlsSetCodeTableOpen,
 * #mlsDrRename and the device-role buttons all open a surface OUTSIDE the
 * modal, and one asks a confirm() the harness was answering "no" to. The
 * instrument lied first. Everything here measures the WHOLE document.
 */

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

let checks = 0;
const measured = {};
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

/* ============================================================ PART 1: static */

const BLOCK = 't2settings-1.0.0';
for (const name of SHELLS) {
  const src = read(name);
  const open = '<!-- ===== ' + BLOCK + ' ';
  const close = '<!-- ===== end ' + BLOCK;
  eq(src.split(open).length - 1, 1, `${name}: ${BLOCK} must open exactly once`);
  eq(src.split(close).length - 1, 1, `${name}: ${BLOCK} must close exactly once`);
  ok(src.indexOf(open) < src.indexOf(close), `${name}: ${BLOCK} closes before it opens`);

  const span = src.slice(src.indexOf(open), src.indexOf(close));
  /* LANE NEUTRALITY — a block that names this lane cannot be promoted by copy. */
  ok(!/__MLS_P1_PREVIEW/.test(span), `${name}: ${BLOCK} references __MLS_P1_PREVIEW and cannot be promoted`);
  ok(!/\b1p-[\w.-]*\.js\b/.test(span), `${name}: ${BLOCK} references a 1p-prefixed file and cannot be promoted`);
  ok(!/1pScribeFlow\.html/.test(span), `${name}: ${BLOCK} references the 1p shell by name`);
  ok(!/['"]\/1p\//.test(span), `${name}: ${BLOCK} references the /1p route`);

  /* THE BACKSLASH TRAP (shell-transport-eats-backslashes): a bare d{n} inside a
     regex literal is the fingerprint of an escape eaten in transport. */
  const bare = span.match(/\/\^?[^/\n*][^/\n]*\/[gimsuy]*/g) || [];
  for (const lit of bare) {
    ok(!/[^\\[]d\{\d/.test(lit), `${name}: ${BLOCK} has a regex with a bare d{n}: ${lit}`);
  }

  /* The Advanced tab is retired by RENAMING a heading, never by hiding a
     section — an unmapped or hidden section is reachable from no tab and fails
     silently (settings-every-section-reachable). */
  ok(!/set-section[^>]*display\s*:\s*none/.test(span),
    `${name}: ${BLOCK} hides a whole .set-section — that is how a setting becomes unreachable with no error`);
}

/* The heading rename that retires the Advanced tab lives in the connect script,
   and it must still be a heading the organizer's classifier can file. */
const connect = read('1p-mls-connect.js');
ok(connect.indexOf("head.textContent = '\u{1F39B}\u{FE0F} More display options';") > 0,
  '1p-mls-connect.js: the controls panel heading is not the Display-classified one');
ok(/Display/i.test('More display options'),
  'the new controls heading must contain the word the classifier files under Display');
eq(connect.indexOf("where: 'Settings (gear) → MLS Controls'"), -1,
  '1p-mls-connect.js: Help/Search still routes people to a tab that no longer exists');

/* ============================================================ PART 2: runtime */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml'
};
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/1pScribeFlow.html';
      const file = path.resolve(root, '.' + p);
      if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); res.end('x'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
        res.end(buf);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

/* Injected. Synthetic only — no login, no network, no PHI. */
function harness() {
  function inClosedDetails(el) {
    for (var p = el; p && p !== document.documentElement; p = p.parentElement) {
      var par = p.parentElement;
      if (par && par.tagName === 'DETAILS' && !par.open && p.tagName !== 'SUMMARY') return true;
    }
    return false;
  }
  function visible(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    var cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    return !inClosedDetails(el);
  }
  function cssPath(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    var parts = [];
    for (var n = el; n && n.nodeType === 1 && n.id !== 'settingsModal'; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      var i = 1, s = n.previousElementSibling;
      while (s) { if (s.tagName === n.tagName) i++; s = s.previousElementSibling; }
      parts.unshift(n.tagName.toLowerCase() + ':nth-of-type(' + i + ')');
    }
    return (parts[0] && parts[0].charAt(0) === '#' ? '' : '#settingsModal > ') + parts.join(' > ');
  }
  function name(el) {
    var t = (el.getAttribute('aria-label') || '').trim();
    if (!t) {
      var lab = el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null;
      if (!lab && el.closest) lab = el.closest('label');
      if (lab) t = (lab.innerText || lab.textContent || '').trim();
    }
    if (!t) t = (el.innerText || el.textContent || '').trim();
    if (!t) t = (el.placeholder || '').trim();
    return t.replace(/\s+/g, ' ').trim();
  }
  function ls() {
    var o = {};
    for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); o[k] = localStorage.getItem(k); }
    return o;
  }
  var CTRL = 'button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button]';
  window.__t2 = {
    visible: visible,
    tabs: function () {
      return Array.prototype.slice.call(document.querySelectorAll('#settingsTabBar .set-tab'))
        .filter(visible).map(function (t) {
          /* the rail button is an icon chip plus a label span; innerText is
             both, and the label span is the words a reader actually reads */
          var lb = t.querySelector('.mls-set-lb');
          return { label: (t.innerText || t.textContent || '').replace(/\s+/g, ' ').trim(),
            words: ((lb ? lb.textContent : t.textContent) || '').replace(/\s+/g, ' ').trim(),
            group: t.getAttribute('data-mls-settings-group') || '' };
        });
    },
    clickTab: function (label) {
      var t = Array.prototype.slice.call(document.querySelectorAll('#settingsTabBar .set-tab')).filter(visible)
        .filter(function (x) { return (x.innerText || '').replace(/\s+/g, ' ').trim() === label; })[0];
      if (t) t.click();
      return !!t;
    },
    /* Every visible section shown by the tab that is selected right now. */
    shownSections: function () {
      return Array.prototype.slice.call(document.querySelectorAll('#settingsModal .modal > .set-section'))
        .filter(visible)
        .map(function (s) { var h = s.querySelector('.set-head'); return h ? (h.innerText || '').replace(/\s+/g, ' ').trim() : (s.id || '?'); });
    },
    controls: function () {
      var m = document.getElementById('settingsModal'); if (!m) return [];
      return Array.prototype.slice.call(m.querySelectorAll(CTRL)).filter(function (el) {
        return visible(el) && !el.closest('#settingsTabBar');
      }).map(function (el) {
        var field = el.closest ? el.closest('.field') : null;
        var sec = el.closest ? el.closest('.set-section') : null;
        return {
          sel: cssPath(el), id: el.id || '',
          tag: el.tagName.toLowerCase() + (el.type ? ':' + el.type : ''),
          name: name(el).slice(0, 90),
          disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
          chip: !!(field && field.querySelector('.mlsT2Now')),
          hasField: !!field,
          reason: !!(field && /Premium|not available|unavailable|cannot|sign in/i.test(field.innerText || '')),
          footer: !sec && !!el.closest('.modal > .row'),
          isLink: el.tagName === 'A'
        };
      });
    },
    /* A control is not inert because the page's TEXT did not change. Adding an
       empty intake row changes no characters; opening a fold changes many. The
       signature is text length AND element count AND how many disclosures are
       open AND whatever a toast is saying — measured over the whole document,
       because half the Settings buttons open a surface outside the modal. */
    sig: function () {
      var toast = '';
      Array.prototype.slice.call(document.querySelectorAll('.toast,#toast,[class*=toast]')).forEach(function (t) {
        if (!toast && visible(t)) toast = (t.innerText || '').replace(/\s+/g, ' ').trim();
      });
      return {
        chars: (document.body.innerText || '').length,
        nodes: document.getElementsByTagName('*').length,
        open: document.querySelectorAll('details[open]').length,
        /* COUNT, not text. Two neighbouring buttons that raise the SAME message
           ("Sign in first.") are indistinguishable by text, and REMOVING the
           stale toast node is worse: the app reuses one node, so deleting it
           silenced every toast for the rest of the run and reported two working
           buttons dead. Counting the calls is non-destructive and exact. */
        toasts: window.__t2toasts || 0,
        toast: toast
      };
    },
    /* Wait until the page stops moving on its own before taking the baseline.
       MEASURED: without this, a toast still fading from the PREVIOUS control
       was present in both the before and after samples, so "Run backup now"
       — which does nothing but raise that toast — was reported inert. The
       control was right; the baseline was stale. */
    quiesce: function () {
      return new Promise(function (done) {
        var last = JSON.stringify(window.__t2.sig()), stable = 0, tries = 0;
        var t = setInterval(function () {
          var now = JSON.stringify(window.__t2.sig());
          stable = (now === last) ? stable + 1 : 0;
          last = now;
          if (stable >= 2 || ++tries > 12) { clearInterval(t); done(true); }
        }, 220);
      });
    },
    begin: function () {
      window.__t2ls = ls(); window.__t2sig = window.__t2.sig(); window.__t2err = [];
      window.__t2moved = false; window.__t2seen = '';
    },
    /* Watch the whole press window, not just its end. MEASURED: "Copied ✓",
       the device "Checked just now, at …" receipt and the "Sign in first."
       toast are all TRANSIENT — they appear and are gone again inside a
       second. A single sample taken after the press found the page back at its
       baseline and called three working controls dead. Any sample that differs
       from the baseline is the control having done something. */
    watch: function (ms) {
      var base = JSON.stringify(window.__t2sig || {});
      var moved = false, seen = '';
      return new Promise(function (done) {
        var n = 0, every = 150;
        var t = setInterval(function () {
          var now = JSON.stringify(window.__t2.sig());
          if (!moved && now !== base) { moved = true; seen = now; }
          if (++n * every >= ms) { clearInterval(t); window.__t2moved = moved; window.__t2seen = seen; done(moved); }
        }, every);
      });
    },
    press: function (sel, probe) {
      var el = document.querySelector(sel); if (!el) return 'not-found';
      var tag = el.tagName.toLowerCase();
      try {
        if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) { el.click(); return 'toggled'; }
        if (tag === 'select') {
          var next = Array.prototype.slice.call(el.options).filter(function (o) { return o.value !== el.value; })[0];
          if (!next) return 'one-option';
          el.value = next.value; el.dispatchEvent(new Event('change', { bubbles: true })); return 'changed';
        }
        if (tag === 'input' && el.type === 'file') return 'file';
        if (tag === 'input' || tag === 'textarea') {
          el.focus(); el.value = probe || 'T2PROBE';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          /* .blur() alone does NOT run an onblur handler when the element was
             never the real focus owner, which is the normal case in a
             non-compositing tab. MEASURED: #defaultComment commits through
             onblur="setDefaultComment(this.value)" and this probe reported it
             inert until the blur EVENT was dispatched explicitly. The control
             was always right; the instrument was not. */
          el.blur();
          el.dispatchEvent(new Event('blur', { bubbles: false }));
          return 'typed';
        }
        el.click(); return 'clicked';
      } catch (e) { window.__t2err.push(String(e && e.message).slice(0, 140)); return 'threw'; }
    },
    end: function (sel) {
      var before = window.__t2ls || {}, after = ls(), wrote = [];
      Object.keys(after).forEach(function (k) { if (!(k in before) || before[k] !== after[k]) wrote.push(k); });
      Object.keys(before).forEach(function (k) { if (!(k in after)) wrote.push(k); });
      var b = window.__t2sig || { chars: 0, nodes: 0, open: 0, toast: '' }, a = window.__t2.sig();
      var el = sel ? document.querySelector(sel) : null;
      return {
        wrote: wrote,
        moved: !!window.__t2moved || (a.chars !== b.chars) || (a.nodes !== b.nodes) || (a.open !== b.open) || (a.toasts !== b.toasts) || (a.toast !== b.toast),
        toast: a.toast,
        /* for a value control, "it works" means the value it now holds is the
           one that was set — Save is what persists it, and that is not this
           control's job to prove */
        took: !!(el && (el.type === 'checkbox' || el.type === 'radio'
          ? true : String(el.value === undefined ? '' : el.value).length > 0)),
        errs: window.__t2err || [],
        modalOpen: !!(document.getElementById('settingsModal') || { classList: { contains: function () { return false; } } })
          .classList.contains('show')
      };
    },
    dupNames: function () {
      var seen = {}, dups = [];
      Array.prototype.slice.call(document.querySelectorAll('#settingsModal ' + CTRL))
        .filter(function (e) { return visible(e) && e.tagName !== 'SUMMARY'; })
        .forEach(function (e) {
          var n = name(e).toLowerCase();
          if (!n) return;
          if (seen[n]) { if (dups.indexOf(n) < 0) dups.push(n); } else seen[n] = 1;
        });
      return dups;
    }
  };
}

async function boot(page, port) {
  await page.goto(`http://127.0.0.1:${port}/1pScribeFlow.html`, { waitUntil: 'load', timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
  await page.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => {
    const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
    const s = document.getElementById('appScreen'); if (s) s.style.display = '';
    const st = document.createElement('style');
    st.textContent = '.modal-bg.show,.modal-bg.show .modal{opacity:1!important}';
    document.head.appendChild(st);
    window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
    try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
    /* a confirm() the harness must not silently answer "no" to — that is how
       the working device-role buttons were first reported dead */
    window.confirm = function () { return true; };
    window.prompt = function () { return 'T2PROBE'; };
    window.alert = function () {};
  });
  await page.waitForTimeout(2000);
  await page.evaluate(harness);
  /* Count toasts without touching them (see sig()). */
  await page.evaluate(() => {
    window.__t2toasts = 0;
    if (typeof window.toast === 'function' && !window.__t2toastHook) {
      const orig = window.toast;
      window.toast = function () { window.__t2toasts++; return orig.apply(this, arguments); };
      window.__t2toastHook = true;
    }
  });
}

/* Never pressed: it wipes this account's storage, and the suite would be
   measuring the wipe from then on. Its wiring is asserted statically instead. */
const NEVER_PRESS = /clearDeviceData|logout\(/i;

async function runtime() {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pageErrors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 160)));
    await boot(page, port);
    await page.evaluate(() => { try { openSettings(); } catch (e) {} });
    await page.waitForTimeout(2500);

    /* -- 1: SEVEN TABS, IN WORDS A CLINIC USES --------------------------- */
    const tabs = await page.evaluate(() => window.__t2.tabs());
    measured.tabs = tabs.map((t) => t.words);
    ok(tabs.length >= 6 && tabs.length <= 7,
      `Settings offers ${tabs.length} tabs: ${JSON.stringify(measured.tabs)} — the redesign is 7 or fewer`);
    const LABELS = await page.evaluate(() => (window.__mlsT2Settings || {}).labels || {});
    ok(Object.keys(LABELS).length >= 7, 't2settings-1.0.0 is not installed — its label table is missing');
    for (const t of tabs) {
      eq(t.words, LABELS[t.group],
        `the "${t.group}" tab reads "${t.words}" — the block's own table says "${LABELS[t.group]}"`);
    }
    /* The words the audit named. "Advanced" as a whole TAB is the one that had
       five display switches behind it. */
    for (const jargon of [/^.{0,4}Advanced/, /Features & navigation/, /MLS Controls/, /^.{0,4}Integrations$/]) {
      const hit = measured.tabs.filter((l) => jargon.test(l));
      eq(hit.length, 0, `a Settings tab is still named in product vocabulary: ${JSON.stringify(hit)}`);
    }
    ok(measured.tabs.some((l) => /letterhead/i.test(l)),
      `no tab names the letterhead, and the Legal/IME letter pulls from it: ${JSON.stringify(measured.tabs)}`);

    /* -- 2: EVERY SECTION IS SHOWN BY EXACTLY ONE TAB -------------------- */
    const byTab = {};
    for (const t of tabs) {
      await page.evaluate((l) => window.__t2.clickTab(l), t.label);
      await page.waitForTimeout(650);
      byTab[t.label] = await page.evaluate(() => window.__t2.shownSections());
    }
    measured.sections = byTab;
    const allShown = [].concat.apply([], Object.keys(byTab).map((k) => byTab[k]));
    const dupSection = allShown.filter((s, i) => allShown.indexOf(s) !== i);
    eq(dupSection.length, 0, `these sections appear under more than one tab: ${JSON.stringify(dupSection)}`);
    /* innerText collapses differently on a section that is display:none (no
       space between the heading and its scope chip), so the comparison is made
       on a whitespace-free key — otherwise every hidden section reads as an
       orphan and the instrument invents the defect it is looking for. */
    const key = (s) => String(s).replace(/\s+/g, '');
    const inDom = await page.evaluate(() =>
      Array.prototype.slice.call(document.querySelectorAll('#settingsModal .modal > .set-section:not([hidden])'))
        .map((s) => { const h = s.querySelector('.set-head'); return h ? (h.textContent || '').replace(/\s+/g, ' ').trim() : (s.id || '?'); }));
    const shownKeys = allShown.map(key);
    const orphan = inDom.filter((s) => shownKeys.indexOf(key(s)) < 0);
    eq(orphan.length, 0,
      `these sections are in the dialog but reachable from NO tab — the silent failure mode: ${JSON.stringify(orphan)}`);
    ok(byTab['🎨 What you see'] && byTab['🎨 What you see'].some((s) => /More display options/i.test(s)),
      `the controls panel did not land on the Display tab: ${JSON.stringify(byTab['🎨 What you see'])}`);

    /* -- 3: EVERY CONTROL, ON EVERY TAB, PRESSED ------------------------- */
    const inventory = [];
    for (const t of tabs) {
      await page.evaluate((l) => window.__t2.clickTab(l), t.label);
      await page.waitForTimeout(700);
      const ctrls = await page.evaluate(() => window.__t2.controls());
      for (const c of ctrls) {
        if (c.footer) continue;                       /* asserted in step 4 */
        if (NEVER_PRESS.test(c.name)) continue;
        if (/clear saved data/i.test(c.name)) continue;
        await page.evaluate(() => window.__t2.quiesce());
        await page.evaluate(() => window.__t2.begin());
        const did = await page.evaluate((s) => window.__t2.press(s), c.sel);
        /* an action control may fetch, toast, or build a dialog; a value
           control settles immediately. Pay the wait only where it can matter,
           and SAMPLE ACROSS the window so a transient receipt is not missed. */
        await page.evaluate((ms) => window.__t2.watch(ms), did === 'clicked' ? 1500 : 450);
        const res = await page.evaluate((s) => window.__t2.end(s), c.sel);

        /* CAUSALITY. A key that moved inside this window is not necessarily
           THIS control's doing: MEASURED, a one-off dock-side seeding write
           from another module landed inside #idleMins' window and reported the
           auto-logoff dropdown as an instant-commit control. A value control is
           therefore pressed a SECOND time, and only the keys that move BOTH
           times are attributed to it — a one-off write from elsewhere cannot
           survive that, and a real commit always does. */
        if (/^(input|select|textarea)/.test(c.tag) && !/file/.test(c.tag) && res.modalOpen) {
          await page.evaluate(() => window.__t2.quiesce());
          await page.evaluate(() => window.__t2.begin());
          await page.evaluate((s) => window.__t2.press(s, 'T2PROBE-B'), c.sel);
          await page.waitForTimeout(420);
          const again = await page.evaluate((s) => window.__t2.end(s), c.sel);
          res.wrote = res.wrote.filter((k) => again.wrote.indexOf(k) >= 0);
        }
        /* Settings search is a view filter, not a durable setting. Leaving the
           probe in it hides the remaining sections while this loop continues
           clicking selectors captured from the old visible inventory. That
           measures hidden controls and can call a working action inert. Clear
           the probe before continuing so every later press is visible. */
        if (c.id === 'settingsSearch' && res.modalOpen) {
          await page.evaluate(() => {
            const search = document.getElementById('settingsSearch');
            if (!search) return;
            search.value = '';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            search.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await page.waitForTimeout(250);
        }
        inventory.push(Object.assign({ tab: t.label, did }, c, res));
        if (!res.modalOpen) {
          await page.evaluate(() => { try { openSettings(); } catch (e) {} });
          await page.waitForTimeout(900);
          await page.evaluate((l) => window.__t2.clickTab(l), t.label);
          await page.waitForTimeout(400);
        }
      }
    }
    measured.pressed = inventory.length;
    ok(inventory.length >= 70,
      `only ${inventory.length} controls were pressed — the inventory did not run over the real dialog`);

    /* (a) nothing a doctor can press throws */
    const threw = inventory.filter((c) => c.did === 'threw' || (c.errs && c.errs.length));
    eq(threw.length, 0,
      `pressing these Settings controls threw: ${JSON.stringify(threw.map((c) => c.name + ' :: ' + (c.errs || []).join('|')))}`);

    /* (b) THE FOOTER'S PROMISE, CONTROL BY CONTROL. A control that commits the
           moment you touch it is not undone by Cancel, so it must carry the
           mark; a control that waits for Save must NOT carry it, or the mark
           means nothing. This is what stops the hand-kept list from rotting. */
    const valueCtrl = inventory.filter((c) => /^(input|select|textarea)/.test(c.tag) && !/file/.test(c.tag) && c.hasField);
    const writesNoChip = valueCtrl.filter((c) => c.wrote.length > 0 && !c.chip);
    const chipNoWrites = valueCtrl.filter((c) => c.wrote.length === 0 && c.chip);
    measured.appliesNow = {
      writers: valueCtrl.filter((c) => c.wrote.length > 0).length,
      savers: valueCtrl.filter((c) => c.wrote.length === 0).length
    };
    eq(writesNoChip.length, 0,
      'these controls take effect the instant they are touched, so Cancel cannot undo them, and nothing on screen says so: ' +
      JSON.stringify(writesNoChip.map((c) => (c.id || c.name) + ' -> ' + c.wrote.slice(0, 3).join(','))));
    eq(chipNoWrites.length, 0,
      'these controls are marked "' + (await page.evaluate(() => window.__mlsT2Settings.appliesNowWords)) +
      '" but wrote nothing when pressed — a mark that is not true is worse than none: ' +
      JSON.stringify(chipNoWrites.map((c) => c.id || c.name)));
    ok(measured.appliesNow.writers > 0 && measured.appliesNow.savers > 0,
      `the two save models were not both observed (${JSON.stringify(measured.appliesNow)}) — the instrument, not the app`);

    /* (c) a control that cannot be used says why, on screen, next to itself */
    const mute = inventory.filter((c) => c.disabled && !c.reason);
    eq(mute.length, 0,
      `these controls are greyed out with no reason anywhere in their field: ${JSON.stringify(mute.map((c) => c.id || c.name))}`);

    /* (d) NOTHING IN THIS DIALOG IS INERT — the owner's rule, as a machine
           check. An ACTION control (a button or a disclosure) must, when
           pressed, write something or move something anywhere in the document:
           a dialog, a toast, a status line, a fold, a new row. Value controls
           are judged separately below, because a field that waits for Save is
           supposed to change nothing when you type into it. */
    const actions = inventory.filter((c) => c.did === 'clicked' && !c.disabled && !c.isLink);
    const inert = actions.filter((c) => c.wrote.length === 0 && !c.moved && c.modalOpen);
    measured.actionsPressed = actions.length;
    eq(inert.length, 0,
      `these controls are on the screen and pressing them did nothing measurable anywhere in the document: ${JSON.stringify(inert.map((c) => (c.id || c.name) + ' [' + c.tab + ']'))}`);
    ok(actions.length >= 8, `only ${actions.length} action controls were pressed — the walk did not reach them`);

    /* (e) every value control actually accepted what was set into it.
           A dropdown with nothing to choose is excluded: #emrSyncHour is filled
           by loadEmrSync() from the server, so signed out — which this harness
           always is — it legitimately has no options. That is a property of the
           harness, not of the shipped dialog, and asserting on it would pin the
           harness's own limitation as if it were a defect. */
    const refused = valueCtrl.filter((c) => !c.took && !c.disabled && c.did !== 'one-option');
    eq(refused.length, 0,
      `these fields would not hold a value: ${JSON.stringify(refused.map((c) => c.id || c.name))}`);

    /* -- 4: ONE FOOTER, ONE SHAPE, AND IT TELLS THE TRUTH ---------------- */
    const foot = {};
    for (const t of tabs) {
      await page.evaluate((l) => window.__t2.clickTab(l), t.label);
      await page.waitForTimeout(450);
      foot[t.label] = await page.evaluate(() => {
        const row = document.querySelector('#settingsModal .modal > .row');
        const btns = row ? Array.prototype.slice.call(row.querySelectorAll('button')).filter(window.__t2.visible)
          .map((b) => (b.textContent || '').trim()).join('|') : '';
        const note = document.getElementById('mlsT2FootNote');
        return { btns, note: !!(note && window.__t2.visible(note)), text: note ? (note.innerText || '').trim() : '' };
      });
    }
    measured.footer = foot;
    const shapes = Object.keys(foot).map((k) => foot[k].btns);
    eq(new Set(shapes).size, 1, `the Settings footer changes shape by tab: ${JSON.stringify(foot)}`);
    ok(shapes[0].indexOf('Save changes') >= 0 && shapes[0].indexOf('Cancel') >= 0,
      `the one footer is "${shapes[0]}" — Save and Cancel must both survive`);
    for (const k of Object.keys(foot)) {
      ok(foot[k].note, `the footer on "${k}" does not say which changes Cancel cannot undo`);
      ok(/Cancel will not undo/i.test(foot[k].text), `the footer note on "${k}" does not name the limit of Cancel`);
    }

    /* -- 5: ONE ADVANCED AREA, ONE ROUTE TO THE INSTALL PAGE ------------- */
    const conn = tabs.filter((t) => t.group === 'integrations')[0];
    ok(conn, 'there is no connections tab');
    await page.evaluate((l) => window.__t2.clickTab(l), conn.label);
    await page.waitForTimeout(1200);
    const adv = await page.evaluate(() => {
      const folds = Array.prototype.slice.call(document.querySelectorAll('#settingsModal details > summary'))
        .filter(window.__t2.visible)
        .map((s) => (s.innerText || '').replace(/\s+/g, ' ').trim());
      const vendor = document.getElementById('mlsClunkySetVendor');
      const advInt = document.getElementById('advIntegrations');
      return {
        advancedFolds: folds.filter((f) => /advanced/i.test(f)),
        vendorInsideAdvanced: !!(vendor && advInt && advInt.contains(vendor)),
        vendorClosed: !!(vendor && !vendor.open),
        vendorHoldsBoth: ['athApiSettingsCard', 'schedApiCard']
          .filter((id) => { const c = document.getElementById(id); return !!(c && c.closest('#mlsClunkySetVendor')); }).length,
        installLinks: Array.prototype.slice.call(document.querySelectorAll('#settingsModal a[href]'))
          .filter(window.__t2.visible)
          .filter((a) => /get-extension/i.test(a.getAttribute('href') || ''))
          .map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)),
        downloads: Array.prototype.slice.call(document.querySelectorAll('#settingsModal button, #settingsModal a[href]'))
          .filter(window.__t2.visible)
          .filter((e) => /download mls assist|direct package/i.test(e.textContent || ''))
          .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40)),
        /* A HEADING NAMES ITS SUBJECT FIRST and is short. Matching "MLS Assist"
           anywhere in a label also caught the "Follow each other" checkbox,
           whose sentence happens to end "needs MLS Assist v3.0.23+" — that is a
           description of a switch, not a second heading, and counting it would
           have invented a duplicate. */
        assistHeadings: Array.prototype.slice.call(document.querySelectorAll('#settingsModal .set-head, #settingsModal label'))
          .filter(window.__t2.visible)
          .map((n) => (n.innerText || '').replace(/\s+/g, ' ').trim())
          .filter((t) => t.length < 60 && /^[^A-Za-z0-9]{0,4}\s*MLS Assist/i.test(t))
      };
    });
    measured.connections = adv;
    eq(adv.advancedFolds.length, 1,
      `the connections tab offers ${adv.advancedFolds.length} things called "advanced": ${JSON.stringify(adv.advancedFolds)}`);
    ok(adv.vendorInsideAdvanced, 'the vendor cards are not inside the one Advanced disclosure');
    ok(adv.vendorClosed, 'the vendor disclosure ships open');
    eq(adv.vendorHoldsBoth, 2, 'the Athena API and Scheduling API cards are not both inside the vendor fold');
    eq(adv.installLinks.length, 1,
      `${adv.installLinks.length} links to one install page: ${JSON.stringify(adv.installLinks)}`);
    eq(adv.downloads.length, 1,
      `${adv.downloads.length} controls to download one file: ${JSON.stringify(adv.downloads)}`);
    eq(adv.assistHeadings.length, 1,
      `${adv.assistHeadings.length} headings in one pane open "MLS Assist": ${JSON.stringify(adv.assistHeadings)}`);

    /* -- 6: THE LETTERHEAD IS NAMED WHERE IT LIVES ----------------------- */
    const pr = tabs.filter((t) => t.group === 'practice')[0];
    await page.evaluate((l) => window.__t2.clickTab(l), pr.label);
    await page.waitForTimeout(700);
    const lh = await page.evaluate(() => {
      const f = document.getElementById('practiceName');
      const sec = f && f.closest('.set-section');
      const d = sec && sec.querySelector('.set-desc');
      return { desc: d ? (d.innerText || '').trim() : '', hasFields: ['practiceName', 'providerName', 'npi', 'clinicAddress']
        .every((id) => !!document.getElementById(id)) };
    });
    measured.letterhead = lh.desc.slice(0, 80);
    ok(/letterhead/i.test(lh.desc), `the practice section never says the word letterhead: "${lh.desc}"`);
    ok(lh.hasFields, 'a letterhead field was lost from the practice section');

    /* -- 7: THE AVATAR PANE ENDS IN WORDS -------------------------------- */
    const av = tabs.filter((t) => t.group === 'avatar')[0];
    ok(av, 'the check-in avatar lost its own tab');
    await page.evaluate((l) => window.__t2.clickTab(l), av.label);
    /* the block gives the module 9s to answer before it says so */
    await page.waitForTimeout(12000);
    const stall = await page.evaluate(() => {
      const host = document.getElementById('mlsAvSettingsHost');
      const box = document.getElementById('mlsT2AvatarStall');
      const btn = box ? box.querySelector('button') : null;
      return {
        stillWaiting: /Opening your avatar setup/i.test((host && host.innerText) || ''),
        said: box ? (box.innerText || '').replace(/\s+/g, ' ').trim() : '',
        retry: !!(btn && window.__t2.visible(btn))
      };
    });
    measured.avatar = stall;
    if (stall.stillWaiting) {
      ok(stall.said.length > 0,
        'the avatar pane has held "Opening your avatar setup…" for 12 seconds and still says nothing about it');
      ok(/did not load/i.test(stall.said), `the avatar refusal does not say what happened: "${stall.said}"`);
      ok(stall.retry, 'the avatar refusal offers nothing to press');
    } else {
      ok(!stall.said, 'the avatar settings loaded, but the stall message was shown anyway');
    }

    /* -- 8: NO TWO VISIBLE CONTROLS SHARE A NAME ------------------------- */
    const dups = {};
    for (const t of tabs) {
      await page.evaluate((l) => window.__t2.clickTab(l), t.label);
      await page.waitForTimeout(450);
      const d = await page.evaluate(() => window.__t2.dupNames());
      if (d.length) dups[t.label] = d;
    }
    measured.duplicateNames = dups;
    eq(Object.keys(dups).length, 0,
      `two controls on one Settings tab answer to the same name: ${JSON.stringify(dups)}`);

    await page.close();
  } finally {
    await browser.close();
    srv.close();
  }
  eq(pageErrors.length, 0, `the page threw while Settings was driven: ${JSON.stringify(pageErrors)}`);
}

runtime().then(() => {
  console.log('1p-settings-redesign-contract.test.js: OK — ' + checks + ' checks');
  console.log('  tabs        : ' + JSON.stringify(measured.tabs));
  console.log('  pressed     : ' + measured.pressed + ' controls, ' +
    JSON.stringify(measured.appliesNow) + ' (apply-now / save-later)');
  console.log('  connections : ' + JSON.stringify(measured.connections));
  console.log('  avatar      : ' + JSON.stringify(measured.avatar));
}).catch((e) => {
  console.error('1p-settings-redesign-contract.test.js FAILED after ' + checks + ' checks');
  console.error('measured: ' + JSON.stringify(measured, null, 1));
  console.error(e && e.stack || e);
  process.exit(1);
});
