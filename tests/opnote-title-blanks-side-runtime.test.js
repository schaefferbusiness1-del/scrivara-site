'use strict';

/* opcli-1.0.0 - three verified gaps in how MLS Scribe drafts an op note from
 * the doctor's own template, proved on the shipped page.
 *
 *   A. A one-line title ("OPERATIVE REPORT - LUMBAR TRANSFORAMINAL EPIDURAL
 *      STEROID INJECTION", also the em-dash and space-only forms) was cut in two
 *      by sanitizeTemplate before the model saw it, so the note opened on a
 *      dangling " - LUMBAR ..." line, a faithful copy of the doctor's template
 *      failed fidelity and was rebuilt, and a second sanitize pass cut it again.
 *      The repair prompt also quoted normalized labels ("operative report lumbar
 *      tfesi") that invite a rename fidelity accepts.
 *   B. The single-draft status line counted row.missing after
 *      _opReconcileBlanks had cut it down to [[key]] slots: "4 blanks to confirm"
 *      over a Fields box asking for 1 blank and 4 suggested values.
 *   C. A diagnosis/indication naming the OPPOSITE side refused the whole draft,
 *      a narrative targeting the opposite side or an unrequested level passed
 *      with no repair at all, and fillChartSlots stamped an opposite-side chart
 *      problem - joined to an unrelated comorbidity - into the diagnosis.
 *      Review round (C7 + reader): the side masks must stay inside the phrase
 *      they describe - "without myelopathy, right L5" and "advanced without
 *      difficulty to the right L5-S1 foramen" are claims - and the SITE is
 *      judged where it is prepped, numbed or named as a joint ("The right knee
 *      was prepped...").
 *
 * Real Chrome on /ScribeFlow.html, the backend's /api/complete stubbed with a
 * per-case model (every other off-host request is answered locally). The real
 * generate() -> repair -> guards -> finalizer -> room -> Fields box path runs. */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
function serve() {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.resolve(ROOT, '.' + p);
    if (!f.startsWith(ROOT + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const PROC = 'Left L5-S1 transforaminal epidural steroid injection';
const TITLE = 'OPERATIVE REPORT - LUMBAR TRANSFORAMINAL EPIDURAL STEROID INJECTION';
/* the doctor's template: one-line dashed title, patient-specific slots, drug
   slots in the [CAPS] shape the drug rule tells the model to keep, and a
   narrative line that carries its own [[level]]/[[side]] slots */
const TPL_SLOTS = [
  TITLE,
  'PATIENT: [[patient_name]]',
  'DATE OF PROCEDURE: [[date_of_procedure]]',
  'PREOPERATIVE DIAGNOSIS: [[pre_operative_diagnosis]]',
  'PROCEDURE: [[procedure]]',
  'ANESTHESIA: Local anesthetic with [LOCAL ANESTHETIC].',
  'INDICATIONS: [[indications]]',
  'CONSENT:',
  'The risks, benefits, and alternatives of the procedure were explained to the patient in detail, all questions were answered, and written informed consent was obtained.',
  'DESCRIPTION OF PROCEDURE:',
  'The patient was brought to the procedure suite and placed prone on the fluoroscopy table. A formal time-out was performed confirming patient identity, procedure, side and level.',
  'Under fluoroscopic guidance a [GAUGE] spinal needle was advanced to the superior aspect of the neural foramen at [[level]] on the [[side]] side.',
  'After negative aspiration, contrast was injected demonstrating epidural spread without vascular uptake, and [STEROID DOSE] was injected.',
  'COMPLICATIONS: None.',
  'DISPOSITION:',
  'The patient tolerated the procedure well and was discharged home in stable condition with written instructions.',
  'SURGEON: [[surgeon_name]]',
].join('\n');
/* a template whose target sentence is FIXED wording (no side/level slot), so a
   side/level the model writes there can only be asked about, never re-filled */
const TPL_FIXED = [
  'OPERATIVE REPORT — LUMBAR TRANSFORAMINAL EPIDURAL STEROID INJECTION',
  'PATIENT: [[patient_name]]',
  'DATE OF PROCEDURE: [[date_of_procedure]]',
  'PREOPERATIVE DIAGNOSIS: [[pre_operative_diagnosis]]',
  'PROCEDURE: [[procedure]]',
  'DESCRIPTION OF PROCEDURE:',
  'The patient was placed prone and a time-out was performed.',
  'The spinal needle was advanced to the target foramen under fluoroscopic guidance.',
  'Contrast confirmed epidural spread without vascular uptake.',
  'COMPLICATIONS: None.',
].join('\n');
/* a right-knee template in fixed wording: a left-knee request adapts it
   (oni-2.13.0), and every sentence that names the knee states the site */
const KNEE_PROC = 'Left knee intra-articular steroid injection';
const TPL_KNEE = [
  'OPERATIVE REPORT - KNEE INJECTION',
  'PATIENT: [[patient_name]]',
  'DATE OF PROCEDURE: [[date_of_procedure]]',
  'PREOPERATIVE DIAGNOSIS: [[pre_operative_diagnosis]]',
  'PROCEDURE: [[procedure]]',
  'INDICATIONS: [[indications]]',
  'DESCRIPTION OF PROCEDURE:',
  'The right knee was prepped with chlorhexidine and draped in sterile fashion.',
  'A 22-gauge needle was advanced into the right knee joint via a superolateral approach and [STEROID DOSE] was injected.',
  'COMPLICATIONS: None.',
].join('\n');

(async () => {
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  let model = null;               /* (user, phase) -> note text */
  const calls = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
    await ctx.route('**/*', async (route) => {
      const u = route.request().url();
      if (u.startsWith('http://127.0.0.1:' + port)) return route.continue();
      let pth = ''; try { pth = new URL(u).pathname; } catch (e) {}
      if (pth === '/api/complete') {
        let body = {}; try { body = JSON.parse(route.request().postData() || '{}'); } catch (e) {}
        const user = String(body.user || '');
        const phase = /\n\nDRAFT TO REPAIR:/.test(user) ? 'repair' : 'initial';
        calls.push({ phase, system: String(body.system || body.sys || ''), user });
        const shown = phase === 'repair'
          ? user.slice(user.indexOf('SELECTED TEMPLATE:\n') + 19, user.indexOf('\n\nDRAFT TO REPAIR:'))
          : user.split('SELECTED TEMPLATE — COPY ITS STRUCTURE AND FIXED WORDING:\n').pop();
        const note = model ? model(shown.trim(), phase, user) : '';
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: JSON.stringify({ note, missing: [] }), model: 'stub', family: 'opnote' }) });
      }
      if (/^https?:\/\//.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 204, body: '' });
    });
    await page.addInitScript(() => { try { localStorage.setItem('sf_bk_token', 'stub.jwt.token'); } catch (e) {} });
    await page.goto(`http://127.0.0.1:${port}/ScribeFlow.html`, { waitUntil: 'load', timeout: 180000 });
    await page.evaluate(() => (typeof window.__mlsEnsureUiBundle === 'function' ? window.__mlsEnsureUiBundle() : null)).catch(() => {});
    await page.waitForFunction(() => !!(window._genOpNote && window._genOpNote.__mlsopWrapped && window.__mlsOpNoteIntegrity &&
      window.__mlsOpNoteIntegrity.installed && window.__mlsOpNoteFill && typeof window.openOpPrepForPatient === 'function'), null, { timeout: 180000 });
    await page.waitForTimeout(4000);
    await page.evaluate(({ a, b, k }) => {
      window.__mlsHarnessAccountEmail = 'opnote-audit@mlsscribe.test';
      setTemplates([
        { id: 'tpl-slots', name: 'Lumbar transforaminal epidural steroid injection', text: a, keywords: ['tfesi', 'transforaminal'], kind: 'op' },
        { id: 'tpl-fixed', name: 'Lumbar TFESI (fixed target sentence)', text: b, keywords: ['tfesi', 'transforaminal'], kind: 'op' },
        { id: 'tpl-knee', name: 'Knee injection', text: k, keywords: ['knee'], kind: 'op' },
      ]);
      localStorage.setItem(uns('useTemplates'), '1');
      /* problems as the app stores them: newline-separated */
      savePatients([
        { id: 'opcli-p1', name: 'Synthetic Tester', dob: '1970-03-04', sex: 'F', mrn: 'SYN-0001', notes: [], visits: [] },
        { id: 'opcli-p2', name: 'Synthetic Chart', dob: '1971-05-06', sex: 'M', mrn: 'SYN-0002', problems: 'Right L4-L5 lumbar radiculopathy; Hypertension', notes: [], visits: [] },
      ]);
    }, { a: TPL_SLOTS, b: TPL_FIXED, k: TPL_KNEE });

    const fill = (shown, v) => shown
      .replace(/\[\[patient_name\]\]/g, v.name || 'Synthetic Tester')
      .replace(/\[\[date_of_procedure\]\]/g, '2026-09-23')
      .replace(/\[\[pre_operative_diagnosis\]\]/g, v.dx != null ? v.dx : 'Left L5-S1 lumbar radiculopathy.')
      .replace(/\[\[procedure\]\]/g, v.proc || PROC)
      .replace(/\[\[indications\]\]/g, v.ind != null ? v.ind : 'Left L5-S1 lumbar radiculopathy.')
      .replace(/\[\[level\]\]/g, v.level || 'L5-S1')
      .replace(/\[\[side\]\]/g, v.side || 'left')
      .replace(v.swapFrom || '\u0000', v.swapTo || '');
    async function draft(pid, tplId, mode, answer, procOverride) {
      model = answer; calls.length = 0;
      const r = await page.evaluate(async ({ pid, tplId, mode, proc }) => {
        localStorage.setItem(uns('opNoteTemplateMode'), mode);
        try { closeOpPrep(); } catch (e) {}
        await openOpPrepForPatient(pid);
        for (let k = 0; k < 50 && !(window._opPrep && window._opPrep[0]); k++) await new Promise((res) => setTimeout(res, 100));
        const row = window._opPrep[0];
        row.tplId = tplId; row.tplManual = true; row.proc = proc; row.dateStr = '2026-09-23';
        row.appt.reason = proc; row.reason = proc; row.edited = false; row._confirmRedraft = false; row._opdbTriage = { verdict: 'needs', code: 'opcli-test' };
        window.__mlsLastOpReconstructed = false;
        await opPrepGenerateOne(0);
        const st = document.getElementById('opPrepStatus');
        return {
          pass: row._genPass === true, err: row._genErr || '', status: st ? st.textContent : '',
          note: row.note || '', genNote: row._genNote || '', missing: (row.missing || []).map((m) => m.key),
          canonicalGen: (window.opNoteBlankTokens(row._genNote || '') || []).map((m) => m.key),
          reconstructed: !!window.__mlsLastOpReconstructed,
        };
      }, { pid, tplId, mode, proc: procOverride || PROC });
      r.calls = calls.map((c) => c.phase);
      r.repairSystem = (calls.find((c) => c.phase === 'repair') || {}).system || '';
      return r;
    }
    const line = (note, rx) => (String(note).split('\n').find((l) => rx.test(l)) || '');
    /* the Fields box ticks only while the op-prep modal is on screen; the
       harness page may still be behind its sign-in shell, so show the modal
       and drive the box's own builder the way its 1s tick does */
    async function settleFields() {
      await page.evaluate(() => {
        const m = document.getElementById('opPrepModal');
        if (m && getComputedStyle(m).display === 'none') { m.classList.add('show'); m.style.setProperty('display', 'flex', 'important'); }
        try { window.__mlsOpNoteFill.tick(); } catch (e) {}
        const ta = document.getElementById('opPrepNote_0');
        try { if (ta) window.__mlsOpNoteFill._buildFillBox(ta); } catch (e) {}
      });
      await page.waitForTimeout(2600);
    }

    /* ===== A. the doctor's one-line title survives, and a faithful copy of it passes on the first call ===== */
    const api = await page.evaluate((t) => {
      const I = window.__mlsOpNoteIntegrity, out = {};
      ['OPERATIVE REPORT - LUMBAR TRANSFORAMINAL EPIDURAL STEROID INJECTION', 'OPERATIVE REPORT — LUMBAR TRANSFORAMINAL EPIDURAL STEROID INJECTION',
        'OPERATIVE REPORT LEFT L5-S1 TFESI', 'PROCEDURE NOTE - GENICULAR NERVE BLOCK'].forEach((title) => {
        const tpl = title + '\nPATIENT: [[patient_name]]\nCOMPLICATIONS: None.';
        const s1 = I.sanitizeTemplate(tpl);
        out[title] = { first: s1.split('\n')[0], idempotent: I.sanitizeTemplate(s1) === s1 };
      });
      const blob = I.sanitizeTemplate('Prior visit text OPERATIVE REPORT  Patient: Example, Prior  Procedure: Left L5-S1 TFESI  Complications: None.');
      out.blob = blob.split('\n');
      out.literal = I.literalHeadings(I.sanitizeTemplate(t));
      return out;
    }, TPL_SLOTS);
    for (const title of Object.keys(api).filter((k) => /^(OPERATIVE|PROCEDURE)/.test(k))) {
      assert.strictEqual(api[title].first, title, 'A: sanitizeTemplate split the one-line title "' + title + '" -> ' + JSON.stringify(api[title].first));
      assert.ok(api[title].idempotent, 'A: sanitizeTemplate is not idempotent on "' + title + '"');
    }
    assert.ok(api.blob.includes('OPERATIVE REPORT') && api.blob.some((l) => /^Patient: \[\[patient\]\]/.test(l)),
      'A: a flat past-note blob is no longer split before its title and labels: ' + JSON.stringify(api.blob));
    assert.strictEqual(api.literal[0], TITLE, 'A: the literal heading list does not start with the title as the template spells it');
    assert.ok(api.literal.includes('PREOPERATIVE DIAGNOSIS:'), 'A: literal heading list lost the template spelling: ' + JSON.stringify(api.literal));

    const faithful = await draft('opcli-p1', 'tpl-slots', 'adapt', (shown) => fill(shown, {}));
    assert.ok(faithful.pass, 'A: a faithful copy of the doctor\'s template did not draft: ' + faithful.err);
    assert.deepStrictEqual(faithful.calls, ['initial'], 'A: a faithful copy of the template still needed a repair round-trip: ' + JSON.stringify(faithful.calls));
    assert.ok(!faithful.reconstructed, 'A: a faithful copy was rebuilt by reanchor');
    assert.strictEqual(faithful.note.split('\n')[0], TITLE, 'A: the note does not open with the doctor\'s one-line title');
    assert.ok(!/^\s*[-—]\s*LUMBAR/m.test(faithful.note), 'A: the note carries a dangling " - LUMBAR ..." title line');
    const emdash = await draft('opcli-p1', 'tpl-fixed', 'strict', (shown) => fill(shown, {}));
    assert.ok(emdash.pass && emdash.calls.length === 1 && /^OPERATIVE REPORT — LUMBAR/.test(emdash.note), 'A: the em-dash title did not survive a faithful strict draft: ' + JSON.stringify({ calls: emdash.calls, first: emdash.note.split('\n')[0], err: emdash.err }));
    /* the repair prompt quotes the template's own heading lines */
    const renamed = await draft('opcli-p1', 'tpl-slots', 'strict', (shown, phase) => phase === 'initial'
      ? fill(shown, {}).replace(TITLE, 'OPERATIVE REPORT\nLUMBAR TFESI') : fill(shown, {}));
    assert.deepStrictEqual(renamed.calls, ['initial', 'repair'], 'A: a renamed title did not trigger the repair');
    assert.ok(renamed.repairSystem.includes(TITLE + ' | PATIENT: | DATE OF PROCEDURE: | PREOPERATIVE DIAGNOSIS:'),
      'A: the repair prompt does not quote the template\'s literal heading lines: ' + renamed.repairSystem.slice(0, 400));
    assert.ok(!/operative report lumbar tfesi/.test(renamed.repairSystem), 'A: the repair prompt still quotes a normalized label the model may rename to');
    assert.ok(renamed.pass && renamed.note.split('\n')[0] === TITLE, 'A: the repaired note lost the doctor\'s title');

    /* ===== B. the status line and row.missing agree with the canonical parser and the Fields box ===== */
    assert.ok(faithful.canonicalGen.length > 0, 'B: fixture must leave fields open (drug slots, surgeon)');
    faithful.canonicalGen.forEach((k) => assert.ok(faithful.missing.includes(k),
      'B: _opReconcileBlanks dropped canonical field "' + k + '" from row.missing: ' + JSON.stringify(faithful.missing)));
    assert.ok(/open fields to fill or check below/.test(faithful.status), 'B: status line does not point at the open fields: ' + faithful.status);
    assert.ok(!/\d+\s+blanks?\s+to confirm/.test(faithful.status), 'B: status line still quotes the narrowed [[key]] count: ' + faithful.status);
    await settleFields();
    const box = await page.evaluate(() => {
      const b = document.querySelector('.onf-fillbox'), h = b && b.querySelector('.onf-h');
      return { header: h ? h.textContent : '', status: (document.getElementById('opPrepStatus') || {}).textContent || '' };
    });
    assert.ok(/to finish this note/.test(box.header), 'B: the Fields box did not render for the drafted note: ' + JSON.stringify(box));
    assert.ok(!/\d/.test(box.status.replace(/2026|L5-S1/g, '')), 'B: the status line states a count the Fields box does not: ' + JSON.stringify(box));

    /* ===== C. side and level conflicts: asked or re-filled, never refused, never silently rewritten ===== */
    /* C1. diagnosis + indication name ONLY the other side -> repair fires, then a visible blank */
    const dxWrong = await draft('opcli-p1', 'tpl-slots', 'adapt', (shown) => fill(shown, { dx: 'Right L4-L5 lumbar radiculopathy.', ind: 'Right-sided L5 radicular leg pain.' }));
    assert.deepStrictEqual(dxWrong.calls, ['initial', 'repair'], 'C1: the first pass did not flag the opposite-side diagnosis (no repair call)');
    assert.ok(/SIDE\/LEVEL FLAGS: The diagnosis names the right side/.test(dxWrong.repairSystem), 'C1: the repair was not told what to fix');
    assert.ok(dxWrong.pass, 'C1: an opposite-side diagnosis refused the whole draft: ' + dxWrong.err);
    const dxLine = line(dxWrong.note, /^PREOPERATIVE DIAGNOSIS:/), indLine = line(dxWrong.note, /^INDICATIONS:/);
    assert.ok(/\[FILL: confirm side - this draft said right\] L4-L5 lumbar radiculopathy/.test(dxLine), 'C1: diagnosis side not surfaced as a confirm blank: ' + dxLine);
    assert.ok(/\[FILL: confirm side - this draft said right\]-sided L5 radicular leg pain/.test(indLine), 'C1: indication side not surfaced as a confirm blank: ' + indLine);
    assert.ok(!/\bLeft L4-L5 lumbar radiculopathy/.test(dxWrong.note), 'C1: the diagnosis side was silently rewritten to the scheduled side');
    await settleFields();
    const asked = await page.evaluate(() => {
      const row = window._opPrep[0], ta = document.getElementById('opPrepNote_0');
      const sel = document.getElementById('onfF_0_confirm_side_this_draft_said_right');
      const ath = Array.from(document.querySelectorAll('#opPrepList button')).filter((x) => /Send to Athena/.test(x.textContent));
      return {
        field: !!sel, tag: sel ? sel.tagName : '', value: sel ? sel.value : null,
        canonical: (window.opNoteBlankTokens(ta ? ta.value : row.note) || []).map((m) => m.key),
        athenaDisabled: ath.length ? ath.every((x) => x.disabled) : null,
      };
    });
    assert.ok(asked.field && asked.tag === 'SELECT', 'C1: the Fields box does not ask to confirm the side: ' + JSON.stringify(asked));
    assert.strictEqual(asked.value, '', 'C1: the Fields box pre-selected a side for the doctor: ' + JSON.stringify(asked));
    assert.ok(asked.canonical.includes('confirm_side_this_draft_said_right'), 'C1: the save/PDF/Athena parser does not count the confirm blank: ' + JSON.stringify(asked.canonical));
    assert.strictEqual(asked.athenaDisabled, true, 'C1: Send to Athena is offered over an unconfirmed side');

    /* C2. narrative targets the other side and an unrequested level in a line whose TEMPLATE carried the slots -> re-filled */
    const narrSlot = await draft('opcli-p1', 'tpl-slots', 'adapt', (shown) => fill(shown, { dx: 'Left L5 lumbar radiculopathy.', ind: 'Left L5 lumbar radiculopathy.', level: 'L4-L5', side: 'right' }));
    assert.deepStrictEqual(narrSlot.calls, ['initial', 'repair'], 'C2: a wrong-side/level narrative passed the first pass with no repair');
    assert.ok(narrSlot.pass, 'C2: the narrative conflict refused the draft: ' + narrSlot.err);
    const nl = line(narrSlot.note, /^Under fluoroscopic guidance/);
    assert.ok(/neural foramen at L5, S1 on the Left side\./.test(nl), 'C2: the slot-bearing narrative line was not re-filled from the requested facts: ' + nl);
    assert.ok(!/L4-L5|\bright\b/i.test(nl), 'C2: the opposite side/unrequested level survived in the narrative: ' + nl);
    assert.match(narrSlot.status, /set from the schedule/, 'C2: the re-fill is a correction the doctor must see, not only a console line: ' + narrSlot.status);

    /* C3. the same conflict in FIXED template wording -> asked, never rewritten */
    const narrFixed = await draft('opcli-p1', 'tpl-fixed', 'adapt', (shown) => fill(shown, {
      dx: 'Left L5-S1 lumbar radiculopathy.', swapFrom: 'advanced to the target foramen', swapTo: 'advanced to the right L4-L5 foramen' }));
    assert.deepStrictEqual(narrFixed.calls, ['initial', 'repair'], 'C3: a reworded wrong-side narrative passed with no repair');
    assert.ok(narrFixed.pass, 'C3: the narrative conflict refused the draft: ' + narrFixed.err);
    const fl = line(narrFixed.note, /^The spinal needle was advanced/);
    assert.ok(/\[FILL: confirm side - this draft said right\] \[FILL: confirm level - this draft said L4-L5\] foramen/.test(fl), 'C3: fixed-wording narrative conflict not surfaced as confirm blanks: ' + fl);

    /* C4. an honest model leaves the diagnosis slot; the chart's only spine problem is the other side */
    const chart = await draft('opcli-p2', 'tpl-slots', 'adapt', (shown) => fill(shown, { name: 'Synthetic Chart', dx: '[[pre_operative_diagnosis]]', ind: '[[indications]]' }));
    assert.ok(chart.pass, 'C4: the chart-problem case did not draft: ' + chart.err);
    const cdx = line(chart.note, /^PREOPERATIVE DIAGNOSIS:/), cind = line(chart.note, /^INDICATIONS:/);
    assert.ok(!/Right|Hypertension/.test(cdx + cind), 'C4: fillChartSlots stamped an opposite-side (or joined unrelated) chart problem: ' + cdx + ' / ' + cind);
    assert.ok(/\[\[pre_operative_diagnosis\]\]/.test(cdx), 'C4: the diagnosis slot did not stay open for the doctor: ' + cdx);
    const chartApi = await page.evaluate((proc) => {
      const I = window.__mlsOpNoteIntegrity, p = getPatients().find((x) => x.id === 'opcli-p2');
      return { problems: I.chartProblems(p, proc), dx: I.chartDiagnosis(p, proc), dxRight: I.chartDiagnosis(p, 'Right L4-L5 TFESI') };
    }, PROC);
    assert.deepStrictEqual(chartApi.problems, ['Right L4-L5 lumbar radiculopathy', 'Hypertension'], 'C4: newline-stored problems were joined into one: ' + JSON.stringify(chartApi.problems));
    assert.strictEqual(chartApi.dx, '', 'C4: an opposite-side problem was offered as the diagnosis');
    assert.strictEqual(chartApi.dxRight, 'Right L4-L5 lumbar radiculopathy', 'C4: a same-side chart problem no longer fills the diagnosis');
    await settleFields();
    const chartBox = await page.evaluate(() => {
      const f = Array.from(document.querySelectorAll('.onf-fillbox select, .onf-fillbox input')).filter((x) => /diagnosis|indications/.test(x.id));
      return f.map((x) => ({ id: x.id, value: x.value }));
    });
    chartBox.forEach((f) => assert.ok(!/Right|Hypertension/.test(f.value), 'C4: the Fields box suggests an opposite-side/unrelated problem: ' + JSON.stringify(f)));

    /* C5. clinically correct notes keep passing on the FIRST call, untouched */
    for (const [label, v] of [
      ['other level in the diagnosis', { dx: 'Left L5 radiculopathy secondary to L4-L5 disc herniation.', ind: 'Left L5 radiculopathy secondary to L4-L5 disc herniation.' }],
      ['bilateral, left worse than right', { dx: 'Bilateral lumbar radiculopathy, left worse than right.', ind: 'Bilateral lumbar radiculopathy, left worse than right.' }],
      ['historical and negated mentions', { dx: 'Left L5 radiculopathy, s/p right L4-5 microdiscectomy.', ind: 'Left leg pain; no right-sided symptoms.' }],
    ]) {
      const ok = await draft('opcli-p1', 'tpl-slots', 'strict', (shown) => fill(shown, v));
      assert.ok(ok.pass, 'C5 (' + label + '): refused: ' + ok.err);
      assert.deepStrictEqual(ok.calls, ['initial'], 'C5 (' + label + '): tripped the side/level check: ' + JSON.stringify(ok.calls));
      assert.ok(!/confirm (side|level)/.test(ok.note), 'C5 (' + label + '): asked about a side/level that was clinically correct');
      assert.ok(ok.note.includes(v.dx), 'C5 (' + label + '): the diagnosis was changed');
    }

    /* C6. the existing PROCEDURE-line gate is not weakened: a wrong procedure side/level still stops the draft */
    const procWrong = await draft('opcli-p1', 'tpl-slots', 'adapt', (shown) => fill(shown, { proc: 'Right L4-L5 transforaminal epidural steroid injection', level: 'L4-L5', side: 'right' }));
    assert.ok(!procWrong.pass && /changed or omitted requested clinical facts \(side, levels\)/.test(procWrong.err), 'C6: a wrong PROCEDURE line no longer stops the draft: ' + JSON.stringify({ pass: procWrong.pass, err: procWrong.err }));

    /* C7 (review). A negation ahead of a real claim no longer hides it; the site is judged where it is prepped; contrast spread is not a target. */
    const icd = await draft('opcli-p1', 'tpl-slots', 'adapt', (shown) => fill(shown, {
      dx: 'Lumbar radiculopathy without myelopathy, right L5 (M54.16).', ind: 'Radicular pain not relieved by physical therapy, right lower extremity.' }));
    assert.ok(icd.pass, 'C7a: the ICD-worded wrong-side diagnosis refused the draft: ' + icd.err);
    assert.deepStrictEqual(icd.calls, ['initial', 'repair'], 'C7a: "without myelopathy, right L5" was not flagged on the first pass');
    assert.ok(/without myelopathy, \[FILL: confirm side - this draft said right\] L5/.test(line(icd.note, /^PREOPERATIVE DIAGNOSIS:/)), 'C7a: the diagnosis side after a negated clause was not asked: ' + line(icd.note, /^PREOPERATIVE DIAGNOSIS:/));
    assert.ok(/physical therapy, \[FILL: confirm side - this draft said right\] lower extremity/.test(line(icd.note, /^INDICATIONS:/)), 'C7a: the indication side after a negated clause was not asked: ' + line(icd.note, /^INDICATIONS:/));
    const noDiff = await draft('opcli-p1', 'tpl-fixed', 'adapt', (shown) => fill(shown, {
      dx: 'Left L5-S1 lumbar radiculopathy.', swapFrom: 'The spinal needle was advanced to the target foramen', swapTo: 'The spinal needle was advanced without difficulty to the right L5-S1 foramen' }));
    assert.ok(noDiff.pass, 'C7b: refused: ' + noDiff.err);
    assert.deepStrictEqual(noDiff.calls, ['initial', 'repair'], 'C7b: "without difficulty to the right L5-S1 foramen" passed the first pass');
    assert.ok(/without difficulty to the \[FILL: confirm side - this draft said right\] L5-S1 foramen/.test(line(noDiff.note, /spinal needle was advanced/)), 'C7b: a wrong-side target after "without difficulty" was not asked: ' + line(noDiff.note, /spinal needle was advanced/));
    const knee = await draft('opcli-p1', 'tpl-knee', 'adapt', (shown) => fill(shown, { dx: 'Left knee osteoarthritis.', ind: 'Left knee pain.', proc: KNEE_PROC,
      swapFrom: 'advanced into the right knee joint', swapTo: 'advanced into the left knee joint' }), KNEE_PROC);
    assert.ok(knee.pass, 'C7c: the adapted knee template was refused: ' + knee.err);
    assert.deepStrictEqual(knee.calls, ['initial', 'repair'], 'C7c: "The right knee was prepped" under a left-knee request passed the first pass');
    assert.ok(/^The \[FILL: confirm side - this draft said right\] knee was prepped/.test(line(knee.note, /knee was prepped/)), 'C7c: the wrong-side prep sentence was not asked: ' + line(knee.note, /knee was prepped/));
    assert.ok(/advanced into the left knee joint/.test(knee.note), 'C7c: the correct needle sentence was changed');
    assert.ok(!/\bright knee\b/i.test(knee.note), 'C7c: a wrong-site knee statement survived: ' + knee.note);
    const spread = await draft('opcli-p1', 'tpl-fixed', 'adapt', (shown) => fill(shown, {
      dx: 'Left L5-S1 lumbar radiculopathy.', swapFrom: 'Contrast confirmed epidural spread without vascular uptake.', swapTo: 'Contrast outlined the exiting L5 nerve root and spread cephalad in the epidural space to L4-L5 without vascular uptake.' }));
    assert.ok(spread.pass && !/confirm (side|level)/.test(spread.note), 'C7d: contrast spreading to a neighbouring level was asked about: ' + line(spread.note, /Contrast outlined/));
    assert.deepStrictEqual(spread.calls, ['initial'], 'C7d: contrast spread tripped the level check');

    /* the reader itself: a nerve-root request accepts its interspace, an interspace request is exact */
    const reader = await page.evaluate(() => {
      const I = window.__mlsOpNoteIntegrity, n = (t) => 'DESCRIPTION OF PROCEDURE:\nThe needle was advanced to the ' + t + ' foramen.';
      const f = (p, t) => I.lateralityConflicts(n(t), p).map((c) => c.field + ':' + c.said);
      return { root: f('Left L5 TFESI', 'left L5-S1'), rootFar: f('Left L5 TFESI', 'left L3-L4'), exact: f('Left L5-S1 TFESI', 'left L4-L5'),
        mbb: f('Left L4-L5 medial branch block', 'left L3'),
        /* sentences that mention a side without stating the target */
        nonTarget: [
          'A right oblique view was obtained and the needle was advanced to the left L5-S1 foramen.',
          'The C-arm was obliqued to the right and the needle was advanced to the left L5-S1 foramen.',
          'An IV was placed in the right hand and the patient was positioned prone.',
          'A grounding pad was placed on the right thigh.',
          'The needle was advanced at a right angle to the skin toward the left L5-S1 foramen.',
          'The C-arm was rotated 20 degrees to the right.',
          'A blood pressure cuff was placed on the right arm.',
          'The patient was placed in the right lateral decubitus position.',
          'A needle was advanced to the left L5-S1 foramen and contrast spread cephalad to L4-L5.',
        ].map((t) => I.lateralityConflicts('DESCRIPTION OF PROCEDURE:\n' + t, 'Left L5-S1 TFESI').length),
        /* a negation, view or C-arm phrase ahead of a real target claim does not hide it */
        claims: [
          'A 22-gauge spinal needle was advanced without difficulty to the right L5-S1 neural foramen.',
          'Without difficulty, a 22-gauge spinal needle was advanced to the right L5-S1 neural foramen.',
          'With no paresthesias, the needle was advanced to the right L5-S1 foramen.',
          'The needle was placed without difficulty in the right neural foramen.',
          'Prior to injection, the needle position at the right L5-S1 foramen was confirmed with contrast.',
          'An oblique view of the right L5-S1 foramen was obtained and the needle was advanced to it.',
          'The C-arm was positioned to visualize the right L5-S1 foramen and a needle was placed there.',
          'IV sedation was given and the needle was advanced to the right L5-S1 foramen.',
          'The skin and subcutaneous tissue over the right L4-L5 level were anesthetized with 1% lidocaine.',
          'A time-out was performed confirming the right side.',
        ].map((t) => I.lateralityConflicts('DESCRIPTION OF PROCEDURE:\n' + t, 'Left L5-S1 TFESI').length),
        kneeClaims: ['The right knee was prepped with chlorhexidine and draped in sterile fashion.', 'A needle was advanced into the right knee joint.']
          .map((t) => I.lateralityConflicts('DESCRIPTION OF PROCEDURE:\n' + t, 'Left knee intra-articular steroid injection').length),
        kneeFine: I.lateralityConflicts('DESCRIPTION OF PROCEDURE:\nA needle was advanced into the left knee joint. The right knee was not injected.', 'Left knee intra-articular steroid injection').length,
        /* diagnosis/indication: a negated clause does not reach past its comma or its phrase */
        dx: [
          ['Lumbar radiculopathy without myelopathy, right L5 (M54.16).', 1],
          ['Radicular pain with no relief from medications, right lower extremity.', 1],
          ['Chronic low back pain without red flags radiating to the right leg.', 1],
          ['Lumbar radiculopathy with absent right ankle reflex.', 1],
          ['Lumbar radiculopathy with no right-sided symptoms.', 0],
          ['Axial low back pain, not radiating to the right leg.', 0],
          ['Lumbar radiculopathy. No left or right-sided weakness.', 0],
          ['Left L5 radiculopathy, s/p right L4-5 microdiscectomy.', 0],
          ['Status post right L4-L5 laminectomy, now left L5 pain.', 0],
        ].map(([t, want]) => [t, want, I.lateralityConflicts('PREOPERATIVE DIAGNOSIS: ' + t, 'Left L5-S1 TFESI').length]),
        facet: I.lateralityConflicts('PREOPERATIVE DIAGNOSIS: Lumbar spondylosis without myelopathy or radiculopathy, right-sided facet arthropathy (M47.816).', 'Left L4-L5 and L5-S1 medial branch block').length };
    });
    assert.deepStrictEqual(reader.root, [], 'reader: an L5 root request refused its L5-S1 foramen');
    assert.deepStrictEqual(reader.rootFar, ['levels:L3-L4'], 'reader: an L5 root request accepted L3-L4');
    assert.deepStrictEqual(reader.exact, ['levels:L4-L5'], 'reader: an L5-S1 request accepted an L4-L5 target');
    assert.deepStrictEqual(reader.mbb, [], 'reader: MBB nerve levels were judged as facet levels');
    assert.deepStrictEqual(reader.nonTarget, [0, 0, 0, 0, 0, 0, 0, 0, 0], 'reader: a view, C-arm turn, IV/cuff site, grounding pad, "right angle", decubitus or contrast spread read as the treated side/level: ' + JSON.stringify(reader.nonTarget));
    reader.claims.forEach((n, i) => assert.strictEqual(n, 1, 'reader: a wrong-side target claim was hidden (case ' + i + '): ' + JSON.stringify(reader.claims)));
    assert.deepStrictEqual(reader.kneeClaims, [1, 1], 'reader: a right-knee prep or needle sentence under a left-knee request was not judged');
    assert.strictEqual(reader.kneeFine, 0, 'reader: "The right knee was not injected." read as a right-knee claim');
    reader.dx.forEach(([t, want, got]) => assert.strictEqual(got, want, 'reader: diagnosis "' + t + '" -> ' + got + ' conflict(s), expected ' + want));
    assert.strictEqual(reader.facet, 1, 'reader: the ICD facet wording naming only the right side was not flagged for a left MBB');

    assert.deepStrictEqual(pageErrors.filter((e) => /opnote|integrity|laterality|opPrep|onf/i.test(e)), [], 'page errors in the op-note path: ' + JSON.stringify(pageErrors));
    console.log('opnote-title-blanks-side-runtime: A title kept + literal repair headings; B status/row.missing canonical; C side/level asked, re-filled or passed; gate intact - PASS');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
