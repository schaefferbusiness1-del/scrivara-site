'use strict';
/* Typed visit notes reach the phone, and the notes box keeps what was typed
   (visitfix-1.1.0, 2026-09-23). Found by the Visit hunt on the signed-in 1p
   shell:
   - phone 390x844: "Type or paste visit notes" > "Use these visit notes"
     toasted "Transcript added to this visit." while the only transcript box
     on the phone stayed empty, read "0 words captured" and offered only
     Start Recording - no Generate, even 20 s later;
   - typing into that empty box then spliced the text into the hidden
     transcript after its first letter ("DAlso reports numbness.octor: ...");
   - typing a transcript straight into the phone box never showed Generate;
   - the notes box threw typed notes away on Escape or a stray backdrop
     click, and Tab walked out of the aria-modal dialog to the page behind.
   And by the review of the first fix:
   - showing Generate re-rendered the room from inside the box's own input
     event, which moved the focused box and committed an IME composition
     half-way: composing "Patient" saved "PPatient", "Back" saved "BBack"
     (driven here through CDP Input.imeSetComposition, as Gboard and CJK
     keyboards do - keyboard.type never composes);
   - a backdrop press left focus on <body> instead of "Keep editing";
   - with a confirm open above the notes dialog, Tab was pulled back into the
     notes dialog underneath and Escape acted on both;
   - entering a stale phone box threw away the spot the doctor tapped.
   Real Chrome; the AI is stubbed through window.aiCallRaw; nothing leaves
   127.0.0.1. */
const http = require('http'), fs = require('fs'), path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const T = fs.readFileSync(path.join(__dirname, '1p-clunky-contract.test.js'), 'utf8');
const HARNESS = '(' + T.slice(T.indexOf('function harness() {'), T.indexOf('async function boot(page, port)')).trim() + ')()';
const TRANSCRIPT = 'Doctor: What brings you in today? Patient: I have had low back pain for three weeks and it goes down my left leg. Doctor: On exam straight leg raise is positive on the left. We will start physical therapy and follow up in four weeks.';
const WORDS = TRANSCRIPT.trim().split(/\s+/).length;
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' };
const DESK = { viewport: { width: 1400, height: 900 } };

const srv = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' })[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(f).pipe(r);
}).listen(0, '127.0.0.1', async () => {
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const boot = async (ctxOpts) => {
    const pg = await (await b.newContext(ctxOpts)).newPage();
    pg.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
    await pg.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.fulfill({ status: 503, body: 'x' }));
    await pg.goto('http://127.0.0.1:' + srv.address().port + '/1pScribeFlow.html', { waitUntil: 'load', timeout: 90000 });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null));
    await pg.waitForFunction(() => !!window.__mlsSimpleLayer, null, { timeout: 60000 });
    await pg.waitForTimeout(4000);
    await pg.evaluate(() => {
      const a = document.getElementById('authScreen'); if (a) a.style.display = 'none';
      const s = document.getElementById('appScreen'); if (s) s.style.display = '';
      window.__mlsHarnessAccountEmail = 'ui-harness@mlsscribe.test';
      try { window.__mlsDeferAsset = function (fn) { return setTimeout(fn, 0); }; } catch (e) {}
      try { window.dispatchEvent(new Event('mls:loader-ready')); } catch (e) {}
      try { if (window.__mlsP1CalmDock && typeof window.__mlsP1CalmDock.ensure === 'function') window.__mlsP1CalmDock.ensure(); } catch (e) {}
    });
    await pg.waitForTimeout(2500);
    await pg.evaluate(() => { try { if (window.__mlsCalmShell && typeof window.__mlsCalmShell.boot === 'function') window.__mlsCalmShell.boot(); } catch (e) {} });
    await pg.evaluate(HARNESS);
    await pg.evaluate(() => window.__clunky.seed());
    await pg.waitForTimeout(800);
    /* the AI answers locally; nothing is generated unless Generate is pressed */
    await pg.evaluate(() => {
      const note = 'HPI:\nPatient reports low back pain for three weeks radiating to the left leg.\nROS:\nNot documented in today\'s transcript.\nEXAM:\nStraight leg raise positive on the left.\nASSESSMENT:\nLumbar radiculopathy with left leg radiation.\nPLAN:\nStart physical therapy. Follow up in four weeks.';
      const obj = { note, athena_note: note, insurance_note: 'MEDICAL NECESSITY:\nPositive straight leg raise supports lumbar radiculopathy.',
        chief_complaint: 'Low back pain', diagnoses: 'Lumbar radiculopathy', medications: 'None', orders: 'None', follow_up: '4 weeks',
        em_level: '99213', em_justification: 'Low MDM', em_evidence_quote: 'low back pain',
        icd10: [{ code: 'M54.16', desc: 'Radiculopathy, lumbar', evidence_quote: 'low back pain' }], cpt: [],
        red_flags: [], suggested_orders: [], differentials: [], opioids: [], recommendations: [] };
      window.__aiCalls = 0;
      window.aiCallRaw = function (sys, user, key, opts) {
        window.__aiCalls++;
        return new Promise((resolve) => setTimeout(() => resolve((opts && opts.freeform) ? 'ok' : JSON.stringify(obj)), 50));
      };
    });
    await pg.evaluate(async () => { window.__mlsPatientLock.switchAsDoctor('syn-0'); await new Promise((r) => setTimeout(r, 500)); showView('visit'); });
    await pg.waitForTimeout(1500);
    return pg;
  };
  /* what the doctor sees in the Visit room */
  const room = () => {
    const vis = (el) => !!(el && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none');
    const box = document.getElementById('ez3Transcript');
    const bigs = [...document.querySelectorAll('#mlsEz3 .ez3-big')].filter(vis).map((x) => x.textContent.replace(/\s+/g, ' ').trim());
    return {
      real: document.getElementById('transcript').value,
      box: box ? box.value : null, boxShown: vis(box), boxFocused: !!box && document.activeElement === box,
      sameBox: !!box && box === window.__boxNode && !window.__boxMoved, caret: box ? box.selectionStart : null,
      boxEvents: (window.__boxEv || []).join(','),
      count: (document.getElementById('ez3TranscriptCount') || {}).textContent || '',
      generate: bigs.some((t) => /^✨ Generate one note/.test(t)),
      startRecording: bigs.some((t) => /Start Recording/i.test(t))
    };
  };
  try {
    /* ---- PHONE: the notes reach the only box on the screen ---- */
    const ph = await boot(PHONE);
    await ph.tap('#ez3ActiveNotes');
    await ph.waitForSelector('#mlsQuickToolPopup .mls-qtp-textarea', { timeout: 8000 });
    await ph.fill('#mlsQuickToolPopup .mls-qtp-textarea', TRANSCRIPT);
    /* a stray tap on the backdrop asks, and the question keeps the focus */
    await ph.touchscreen.tap(195, 6);
    await ph.waitForTimeout(250);
    const phAsk = await ph.evaluate(() => {
      const ov = document.getElementById('mlsQuickToolPopup'), ask = ov && ov.querySelector('.mls-qtp-ask');
      return { open: !!ov, asking: !!(ask && !ask.hidden), onKeep: !!ask && document.activeElement === ask.querySelector('button:not(.danger)'),
        active: (document.activeElement && (document.activeElement.className || document.activeElement.tagName)) || '' };
    });
    assert.ok(phAsk.open && phAsk.asking, 'a backdrop tap with typed notes asks first on the phone: ' + JSON.stringify(phAsk));
    assert.ok(phAsk.onKeep, 'focus is on Keep editing after the backdrop tap, not on the page: ' + JSON.stringify(phAsk));
    await ph.tap('#mlsQuickToolPopup .mls-qtp-ask button:not(.danger)');
    await ph.tap('#mlsQuickToolPopup .mls-qtp-btn.primary');
    await ph.waitForTimeout(1200);
    const added = await ph.evaluate(room);
    assert.strictEqual(added.real, TRANSCRIPT, 'the notes are in the visit transcript');
    assert.ok(added.boxShown, 'the phone shows its transcript box');
    assert.strictEqual(added.box, TRANSCRIPT, 'the phone box shows the notes that were just added: ' + JSON.stringify(added).slice(0, 300));
    assert.strictEqual(added.count, WORDS + ' words captured', 'the phone word count counts them');
    assert.ok(added.generate, 'Generate one note is offered once the visit has notes: ' + JSON.stringify(added).slice(0, 300));
    assert.ok(!added.startRecording, 'the primary control is not a bare Start Recording beside a full transcript');

    /* typing goes where the caret is in the visible text - no splice */
    await ph.tap('#ez3Transcript');
    const mid = TRANSCRIPT.indexOf(' Patient:');
    await ph.evaluate((n) => { const x = document.getElementById('ez3Transcript'); x.focus(); x.setSelectionRange(n, n); }, mid);
    await ph.keyboard.type(' (seen with a family member)', { delay: 10 });
    await ph.evaluate(() => { const x = document.getElementById('ez3Transcript'); x.setSelectionRange(x.value.length, x.value.length); });
    await ph.keyboard.type(' Also reports numbness.', { delay: 10 });
    await ph.waitForTimeout(500);
    const edited = await ph.evaluate(room);
    const want = TRANSCRIPT.slice(0, mid) + ' (seen with a family member)' + TRANSCRIPT.slice(mid) + ' Also reports numbness.';
    assert.strictEqual(edited.real, want, 'typed words land at the caret in the visible text, in the visit transcript: ' + edited.real.slice(0, 90));
    assert.strictEqual(edited.box, want, 'and the box shows exactly that');

    /* a stale box keeps the spot the doctor taps: words reached the visit
       while nobody was in the box (a writer that does not announce itself),
       so the box still shows the older text as the doctor taps into it */
    const MORE = ' Denies bowel or bladder change.';
    await ph.evaluate((more) => {
      const x = document.getElementById('ez3Transcript'); x.blur(); x.scrollTop = 0;
      const t = document.getElementById('transcript'); t.value = t.value + more;
    }, MORE);
    const spot = await ph.evaluate(() => { const r = document.getElementById('ez3Transcript').getBoundingClientRect(); return { x: r.left + 40, y: r.top + 22 }; });
    await ph.touchscreen.tap(spot.x, spot.y);
    await ph.waitForTimeout(300);
    const tapped = await ph.evaluate(room);
    assert.strictEqual(tapped.box, want + MORE, 'the box is brought up to date as the doctor enters it');
    assert.ok(tapped.boxFocused && tapped.caret > 0 && tapped.caret < 40, 'the caret stays on the first line where the doctor tapped, not at the end: ' + tapped.caret);
    await ph.keyboard.type('Z');
    await ph.waitForTimeout(200);
    const atSpot = await ph.evaluate(room);
    const wantSpot = want.slice(0, tapped.caret) + 'Z' + want.slice(tapped.caret) + MORE;
    assert.strictEqual(atSpot.real, wantSpot, 'the key lands at the tapped spot and the new words stay: ' + atSpot.real.slice(0, 80));
    await ph.keyboard.press('Backspace');
    await ph.waitForTimeout(150);
    assert.strictEqual(await ph.evaluate(() => document.getElementById('transcript').value), want + MORE, 'and it can be taken back out');

    /* an emptied box, then a transcript composed straight into it through
       an IME: each word is composed letter by letter, then committed */
    const cdp = await ph.context().newCDPSession(ph);
    const compose = async (word) => {
      for (let i = 1; i <= word.length; i++) {
        const part = word.slice(0, i);
        await cdp.send('Input.imeSetComposition', { text: part, selectionStart: part.length, selectionEnd: part.length });
        await ph.waitForTimeout(30);
      }
      await cdp.send('Input.insertText', { text: word });
      await ph.waitForTimeout(200);
    };
    const clearBox = async () => {
      await ph.evaluate(() => { const x = document.getElementById('ez3Transcript'); x.focus(); x.select(); });
      await ph.keyboard.press('Backspace');
      await ph.waitForTimeout(400);
    };
    await ph.evaluate(() => {
      const x = document.getElementById('ez3Transcript');
      window.__boxNode = x; window.__boxEv = []; window.__boxMoved = 0;
      ['compositionstart', 'compositionend', 'blur', 'focus'].forEach((n) => x.addEventListener(n, () => window.__boxEv.push(n)));
      /* taking the box out of the page is what commits a composition */
      new MutationObserver((recs) => recs.forEach((r) => r.removedNodes.forEach((n) => { if (n === x || (n.contains && n.contains(x))) window.__boxMoved++; })))
        .observe(document.body, { childList: true, subtree: true });
    });
    await clearBox();
    const cleared = await ph.evaluate(room);
    assert.strictEqual(cleared.real, '', 'clearing the phone box clears the transcript');
    assert.ok(!cleared.generate && cleared.startRecording, 'an empty visit offers Start Recording, not Generate: ' + JSON.stringify(cleared));
    assert.ok(cleared.sameBox && cleared.boxFocused, 'the box the doctor is in stays in place while Start Recording comes back: ' + JSON.stringify(cleared));
    await ph.evaluate(() => { window.__boxEv = []; });
    await compose('Back');
    const back = await ph.evaluate(room);
    assert.strictEqual(back.real, 'Back', 'a composed first word is saved once, not doubled: ' + JSON.stringify(back.real));
    assert.strictEqual(back.box, 'Back', 'and the box shows it once');
    assert.ok(back.generate && !back.startRecording, 'Generate appears for the composed word: ' + JSON.stringify(back));
    assert.ok(back.sameBox && back.boxFocused, 'the box was never taken out and put back: ' + JSON.stringify(back));
    assert.strictEqual(back.boxEvents, 'compositionstart,compositionend', 'one composition, never interrupted by a blur: ' + back.boxEvents);
    await clearBox();
    /* an EMPTY box left stale (words reached the visit while nobody was in
       it) is filled as the doctor taps in, Generate is offered at once, and
       the next words go after the text instead of being spliced into it */
    await ph.evaluate(() => { document.getElementById('ez3Transcript').blur(); document.getElementById('transcript').value = 'Seen today.'; });
    await ph.tap('#ez3Transcript');
    await ph.waitForTimeout(300);
    const staleEmpty = await ph.evaluate(room);
    assert.ok(staleEmpty.box === 'Seen today.' && staleEmpty.boxFocused && staleEmpty.caret === 'Seen today.'.length, 'the empty box shows the visit text with the caret after it: ' + JSON.stringify(staleEmpty));
    assert.ok(staleEmpty.generate && !staleEmpty.startRecording, 'Generate is offered for the text now in the box: ' + JSON.stringify(staleEmpty));
    assert.ok(staleEmpty.sameBox, 'the box was not taken out and put back');
    await ph.keyboard.type(' Doing well.', { delay: 10 });
    await ph.waitForTimeout(200);
    assert.strictEqual(await ph.evaluate(() => document.getElementById('transcript').value), 'Seen today. Doing well.', 'the words go after the text, not into it');
    await clearBox();
    await ph.evaluate(() => { window.__boxEv = []; });
    await compose('Patient');
    await compose(' reports');
    const first = await ph.evaluate(room);
    assert.strictEqual(first.real, 'Patient reports', 'composed words reach the visit transcript exactly: ' + JSON.stringify(first.real));
    assert.ok(first.generate, 'Generate appears as soon as the box has text: ' + JSON.stringify(first));
    assert.ok(first.boxFocused && first.sameBox, 'the box keeps focus while Generate appears');
    assert.strictEqual(first.boxEvents, 'compositionstart,compositionend,compositionstart,compositionend', 'two whole compositions, no blur or refocus: ' + first.boxEvents);
    const REST = ' low back pain for three weeks going down the left leg. Straight leg raise is positive on the left. We will start physical therapy and follow up in four weeks.';
    await ph.keyboard.type(REST, { delay: 5 });
    await ph.waitForTimeout(500);
    const typed = await ph.evaluate(room);
    const TYPED = 'Patient reports' + REST;
    assert.strictEqual(typed.real, TYPED, 'typing is not interrupted by Generate appearing: ' + typed.real);
    assert.strictEqual(typed.box, typed.real, 'the box and the transcript agree');
    assert.strictEqual(typed.count, TYPED.split(/\s+/).length + ' words captured', 'the count follows the typing');
    assert.ok(typed.generate && typed.boxFocused, 'Generate stays offered and the caret stays in the box');
    await ph.tap('#ez3Gen');
    await ph.waitForFunction(() => /Lumbar radiculopathy/.test((document.getElementById('noteBox') || {}).value || ''), null, { timeout: 20000 });
    assert.ok(await ph.evaluate(() => window.__aiCalls > 0), 'the phone Generate press reached the (stubbed) AI');

    /* ---- the notes box keeps what was typed ---- */
    const pg = await boot(DESK);
    const dlg = () => {
      const ov = document.getElementById('mlsQuickToolPopup');
      const ask = ov && ov.querySelector('.mls-qtp-ask');
      const ta = ov && ov.querySelector('.mls-qtp-textarea');
      return { open: !!ov, asking: !!(ask && !ask.hidden && ask.getClientRects().length), askText: ask ? ask.textContent.replace(/\s+/g, ' ').trim() : '',
        text: ta ? ta.value : null, taFocused: !!ta && document.activeElement === ta,
        onKeep: !!ask && document.activeElement === ask.querySelector('button:not(.danger)'),
        real: document.getElementById('transcript').value };
    };
    await pg.click('#ez3ActiveNotes');
    await pg.waitForSelector('#mlsQuickToolPopup .mls-qtp-textarea', { timeout: 8000 });
    await pg.click('#mlsQuickToolPopup .mls-qtp-textarea');
    const DICT = 'Seen for knee pain. Exam shows a small effusion.';
    await pg.keyboard.type(DICT);
    /* Tab and Shift+Tab stay inside the aria-modal dialog */
    const walk = [];
    for (let i = 0; i < 9; i++) { await pg.keyboard.press('Tab'); walk.push(await pg.evaluate(() => !!(document.activeElement && document.activeElement.closest('#mlsQuickToolPopup')))); }
    for (let i = 0; i < 5; i++) { await pg.keyboard.press('Shift+Tab'); walk.push(await pg.evaluate(() => !!(document.activeElement && document.activeElement.closest('#mlsQuickToolPopup')))); }
    assert.ok(walk.every(Boolean), 'focus never leaves the notes dialog on Tab / Shift+Tab: ' + JSON.stringify(walk));
    /* Escape asks instead of throwing the notes away */
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(200);
    let d = await pg.evaluate(dlg);
    assert.ok(d.open && d.asking, 'Escape with typed notes asks first: ' + JSON.stringify(d));
    assert.match(d.askText, /Discard the notes you typed\?/, 'the question says what would be lost');
    assert.strictEqual(d.text, DICT, 'the typed notes are still there');
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(200);
    d = await pg.evaluate(dlg);
    assert.ok(d.open && !d.asking && d.taFocused && d.text === DICT, 'a second Escape means keep editing: ' + JSON.stringify(d));
    /* a stray backdrop click asks too */
    await pg.mouse.click(30, 450);
    await pg.waitForTimeout(200);
    d = await pg.evaluate(dlg);
    assert.ok(d.open && d.asking && d.text === DICT, 'a backdrop click with typed notes asks first: ' + JSON.stringify(d));
    assert.ok(d.onKeep, 'the backdrop press leaves focus on Keep editing, not on the page: ' + JSON.stringify(d));
    for (let i = 0; i < 6; i++) { await pg.keyboard.press('Tab'); assert.ok(await pg.evaluate(() => !!(document.activeElement && document.activeElement.closest('#mlsQuickToolPopup'))), 'focus stays in the dialog while it asks'); }
    await pg.click('#mlsQuickToolPopup .mls-qtp-ask button:not(.danger)');
    await pg.waitForTimeout(200);
    d = await pg.evaluate(dlg);
    assert.ok(d.open && !d.asking && d.taFocused, 'Keep editing returns to the notes: ' + JSON.stringify(d));
    await pg.click('#mlsQuickToolPopup .mls-qtp-btn.primary');
    await pg.waitForTimeout(1200);
    d = await pg.evaluate(dlg);
    assert.ok(!d.open && d.real === DICT, 'Use these visit notes still adds them: ' + JSON.stringify(d));
    const lane = await pg.evaluate(() => ({ box: (document.getElementById('ez3flTranscript') || {}).value, gen: !!(document.getElementById('ez3flGen') && document.getElementById('ez3flGen').getClientRects().length) }));
    assert.ok(lane.box === DICT && lane.gen, 'the desktop lane shows the notes and Generate: ' + JSON.stringify(lane));
    /* unchanged notes close on Escape without a question */
    await pg.evaluate(() => window.__mlsVisitControlContinuity.openPasteTranscript());
    await pg.waitForTimeout(200);
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(200);
    d = await pg.evaluate(dlg);
    assert.ok(!d.open, 'Escape closes the box at once when nothing was typed: ' + JSON.stringify(d));
    /* Discard is an explicit choice and leaves the visit transcript alone */
    await pg.evaluate(() => window.__mlsVisitControlContinuity.openPasteTranscript());
    await pg.waitForTimeout(200);
    await pg.keyboard.type(' Extra line.');
    await pg.mouse.click(30, 450);
    await pg.waitForTimeout(200);
    assert.ok((await pg.evaluate(dlg)).asking, 'a changed box asks before closing');
    await pg.click('#mlsQuickToolPopup .mls-qtp-ask button.danger');
    await pg.waitForTimeout(300);
    d = await pg.evaluate(dlg);
    assert.ok(!d.open && d.real === DICT, 'Discard closes the box and leaves the visit transcript as it was: ' + JSON.stringify(d));

    /* a confirm open ABOVE the notes dialog owns Tab and Escape, even once
       Tab has walked focus out of it */
    await pg.evaluate(() => window.__mlsVisitControlContinuity.openPasteTranscript());
    await pg.waitForTimeout(200);
    await pg.keyboard.type(' Knee is warm.');
    await pg.evaluate(() => {
      window.__askRes = 'pending';
      window.mlsConfirm('Allow the microphone for this visit?').then((v) => { window.__askRes = v; });
      window.__tabs = [];
      window.addEventListener('keydown', (e) => { if (e.key === 'Tab') window.__tabs.push(e.defaultPrevented); });
    });
    await pg.waitForTimeout(200);
    const where = () => { const a = document.activeElement; return a && a.closest('#_mlsAskDialog') ? 'ask' : a && a.closest('#mlsQuickToolPopup') ? 'notes' : 'page'; };
    assert.strictEqual(await pg.evaluate(where), 'ask', 'the confirm has the focus');
    const walked = [];
    for (let i = 0; i < 4; i++) { await pg.keyboard.press('Tab'); walked.push(await pg.evaluate(where)); }
    assert.ok(!walked.includes('notes'), 'Tab is never pulled into the notes dialog under the open confirm: ' + JSON.stringify(walked));
    assert.ok(!(await pg.evaluate(() => window.__tabs)).some(Boolean), 'the notes dialog leaves Tab alone while the confirm is open');
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(250);
    d = await pg.evaluate(dlg);
    assert.strictEqual(await pg.evaluate(() => window.__askRes), false, 'Escape answers the confirm');
    assert.ok(d.open && !d.asking && d.text === DICT + ' Knee is warm.', 'and only the confirm - the notes dialog neither closed nor asked: ' + JSON.stringify(d));
    /* with the confirm gone the notes dialog has the keys back */
    await pg.evaluate(() => { const ta = document.querySelector('#mlsQuickToolPopup .mls-qtp-textarea'); if (ta) ta.focus(); });
    for (let i = 0; i < 6; i++) { await pg.keyboard.press('Tab'); assert.strictEqual(await pg.evaluate(where), 'notes', 'Tab stays in the notes dialog once the confirm is gone'); }
    await pg.keyboard.press('Escape');
    await pg.waitForTimeout(200);
    d = await pg.evaluate(dlg);
    assert.ok(d.open && d.asking, 'Escape on the notes dialog asks again: ' + JSON.stringify(d));
    await pg.click('#mlsQuickToolPopup .mls-qtp-ask button.danger');
    await pg.waitForTimeout(200);
    d = await pg.evaluate(dlg);
    assert.ok(!d.open && d.real === DICT, 'Discard closes it and the visit keeps its notes: ' + JSON.stringify(d));

    assert.deepStrictEqual(errs, [], 'no page errors: ' + errs.join(' | '));
    console.log('PASS typed visit notes reach the phone: the phone box shows added notes with their count and Generate, typing lands at the caret and at the tapped spot, composed words are saved once while Generate appears, and the notes dialog asks before discarding, keeps focus on the question, keeps Tab inside and stands down under a confirm');
  } finally { await b.close(); srv.close(); }
});
