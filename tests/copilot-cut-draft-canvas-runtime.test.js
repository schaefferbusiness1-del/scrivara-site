'use strict';
/* cptrunc-1.0.0 (2026-09-24): A COPILOT DRAFT THE SERVER HAD TO CUT NEVER
 * PASSES AS WHOLE ON THE STUDIO CANVAS.
 *
 * /api/copilot holds a draft to 16,000 characters. A longer one now keeps its
 * opening and its end, carries a '[... DRAFT INCOMPLETE ...]' marker where the
 * middle was cut, and says artifact.truncated / artifact.omittedChars. This
 * suite EXECUTES the shipped canvas functions, lifted out of every shell that
 * ships them, and proves:
 *   - a flagged draft shows an amber strip between the head and the draft,
 *     naming the characters cut; the strip softens (and stays) once the
 *     marker is edited out or a Tweak removes it;
 *   - Copy and the email draft ask first (in-app dialog, never a native one)
 *     while the text holds the marker; a cancel, a missing dialog or a failed
 *     dialog does nothing;
 *   - the EMR route refuses a marked draft outright and never falls through
 *     to the copy path;
 *   - AN OLD-SERVER REPLY (no truncated, no omittedChars, no marker) renders
 *     the byte-identical canvas and copies, emails and routes synchronously
 *     with no dialog, exactly as before.
 * Every draft below is invented for this file.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];
let checks = 0;
function ok(v, msg) { assert.ok(v, msg); checks += 1; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); checks += 1; }
function deq(a, b, msg) { assert.deepStrictEqual(a, b, msg); checks += 1; }
const tick = () => new Promise(resolve => setImmediate(resolve));

const MARK = '\n\n[... DRAFT INCOMPLETE: 1,234 characters were cut here because this draft ran past the 16,000-character limit. Ask Copilot for a shorter version, or for the draft in parts, before using it ...]\n\n';
const CUT_TEXT = 'Synthetic referral opening paragraph.' + MARK + 'Synthetic referral closing paragraph.';
const STRIP_LOUD = 'Incomplete draft: 1,234 characters were cut where the text is marked. Ask Copilot for a shorter version or for it in parts before you copy, email or send it.';
const STRIP_SOFT = 'This draft came back incomplete: 1,234 characters were cut. The marker is no longer in the text, so check that nothing needed is missing before you use it.';
const STRIP_LINE = '    +_copilotArtifactWarnHtml(ar,i,ar.content)\n';

function lift(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const start = source.indexOf('function _copilotArtIcon(');
  const end = source.indexOf('/* Turn a Copilot draft into an interactive tool', start);
  assert.ok(start >= 0 && end > start, file + ': the Copilot canvas block is missing');
  const ce = source.match(/^function _ce\(s\)\{.*\}$/m);
  assert.ok(ce, file + ': _ce is missing');
  const block = source.slice(start, end);
  ok(block.split(STRIP_LINE).length === 2, file + ': the strip is no longer rendered between the head and the draft exactly once');
  /* Every native dialog is banned in production scripts; this canvas must ask
     with the in-app one. */
  ok(!/(?:^|[^.\w])(?:window\.)?confirm\(/.test(block.replace(/mlsConfirm\(/g, '')), file + ': the canvas asks with a native confirm()');
  return { ce: ce[0], block };
}

function makeDoc() {
  const nodes = [];
  function node(tag, id) {
    const n = {
      tagName: String(tag || 'div').toUpperCase(), id: id || '', className: '', textContent: '', value: '',
      attrs: {}, style: {}, children: [], parentNode: null, disabled: false,
      setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      insertBefore(child, ref) { const at = this.children.indexOf(ref); if (at < 0) this.children.push(child); else this.children.splice(at, 0, child); child.parentNode = this; return child; },
      appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
      removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parentNode = null; return child; },
      select() {}
    };
    nodes.push(n);
    return n;
  }
  function attached(n) { let p = n; while (p) { if (p === doc.box) return true; p = p.parentNode; } return false; }
  const doc = {
    box: null,
    createElement(tag) { return node(tag); },
    getElementById(id) { return nodes.find(n => n.id === id && attached(n)) || null; },
    execCommand() { return true; },
    node
  };
  doc.box = node('div', 'cArtHost');
  return doc;
}

function boot(lifted, answers) {
  const log = [];
  const doc = makeDoc();
  const ctx = {
    Promise, String, Number, Math, JSON, Object, Array, RegExp, isFinite, setImmediate,
    document: doc, _copilotHistory: [],
    toast(msg, kind) { log.push(['toast', String(msg), kind]); },
    navigator: { clipboard: { writeText(t) { log.push(['clipboard', t]); return Promise.resolve(); } } },
    sendToEMRviaAssist(btn, opts) { log.push(['emr', opts && opts.text]); },
    _copilotOpenEmail(to, subj, body) { log.push(['email', to, subj, body]); },
    mlsConfirm(msg, opts) { log.push(['confirm', msg, opts && opts.okLabel, opts && opts.cancelLabel]); const a = answers.shift(); return a instanceof Error ? Promise.reject(a) : Promise.resolve(a); },
    _copilotSaveHist() {},
    backendMode() { return true; }, bkToken() { return 'synthetic-token'; }, bkBase() { return 'https://synthetic.invalid'; },
    _mlsAiFault() { return ''; },
    fetch() { return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ text: ctx.__nextTweak }) }); }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(lifted.ce + '\n' + lifted.block, ctx, { filename: 'copilot-canvas.js' });
  /* The oracle: the shipped renderer with its one strip line taken out is the
     canvas as it rendered before this change. */
  vm.runInContext(lifted.block.slice(lifted.block.indexOf('function _copilotArtifactHtml(')).split('function _copilotSyncArtifact(')[0]
    .replace('function _copilotArtifactHtml(', 'function __canvasBefore(').replace(STRIP_LINE, ''), ctx, { filename: 'copilot-canvas-before.js' });
  return { ctx, log, doc };
}
function mountDraft(env, i, text) {
  const ta = env.doc.node('textarea', 'cArt_' + i); ta.value = text;
  env.doc.box.appendChild(ta);
  const tw = env.doc.node('input', 'cTw_' + i); env.doc.box.appendChild(tw);
  const btn = env.doc.node('button', 'cTwBtn_' + i); env.doc.box.appendChild(btn);
  return { ta, tw, btn };
}
function kinds(log) { return log.map(row => row[0]); }

(async function () {
  for (const file of SHELLS) {
    const lifted = lift(file);

    /* ---- 1. render ---- */
    {
      const env = boot(lifted, []);
      const oldReply = { role: 'ai', text: 'Here is the referral.', artifact: { kind: 'letter', title: 'Referral', content: 'Synthetic whole referral letter.' } };
      const wholeNew = { role: 'ai', text: 'Here is the referral.', artifact: { kind: 'letter', title: 'Referral', content: 'Synthetic whole referral letter.', truncated: false, omittedChars: 0 } };
      const cutNew = { role: 'ai', text: 'Here is the referral.', artifact: { kind: 'letter', title: 'Referral', content: CUT_TEXT, truncated: true, omittedChars: 1234 } };
      const oldHtml = env.ctx._copilotArtifactHtml(oldReply, 0);
      eq(oldHtml, env.ctx.__canvasBefore(oldReply, 0), file + ': an old-server draft no longer renders the canvas it rendered before');
      ok(!/c-art-warn|cArtWarn_/.test(oldHtml), file + ': an old-server draft shows a cut strip');
      ok(oldHtml.includes('</span></div><textarea id="cArt_0"'), file + ': the head no longer runs straight into the draft for a whole draft');
      eq(env.ctx._copilotArtifactHtml(wholeNew, 0), oldHtml, file + ': a whole draft from the new server renders differently from the same draft before');

      const cutHtml = env.ctx._copilotArtifactHtml(cutNew, 1);
      const strip = '<div class="c-art-warn" id="cArtWarn_1" role="alert">' + STRIP_LOUD + '</div>';
      ok(cutHtml.includes('</span></div>' + strip + '<textarea id="cArt_1"'), file + ': the cut strip is not between the head and the draft, or says the wrong thing:\n' + cutHtml.slice(0, 900));
      eq(cutHtml.replace(strip, ''), env.ctx.__canvasBefore(cutNew, 1), file + ': the cut strip changed more of the canvas than the strip itself');

      /* flag without marker: a soft note; marker without flag: the loud strip */
      const flaggedOnly = env.ctx._copilotArtifactHtml({ artifact: { kind: 'letter', title: 'Referral', content: 'Synthetic edited letter.', truncated: true, omittedChars: 1234, cutClearedByHand: true } }, 2);
      ok(flaggedOnly.includes('<div class="c-art-warn c-art-warn-soft" id="cArtWarn_2" role="note">' + STRIP_SOFT + '</div><textarea id="cArt_2"'), file + ': a flagged draft whose marker the doctor edited out lost its note');
      /* cptrunc-1.1.0: flagged, marker gone, but not by the doctor's hand (a Tweak rewrite): still loud */
      const rewritten = env.ctx._copilotArtifactHtml({ artifact: { kind: 'letter', title: 'Referral', content: 'Synthetic rewritten letter.', truncated: true, omittedChars: 1234 } }, 4);
      ok(/<div class="c-art-warn" id="cArtWarn_4" role="alert">Incomplete draft: 1,234 characters were cut, and a rewrite removed the marker/.test(rewritten), file + ': a flagged draft whose marker a rewrite removed is not loud:\n' + rewritten.slice(0, 600));
      const markedOnly = env.ctx._copilotArtifactHtml({ artifact: { kind: 'letter', title: 'Referral', content: CUT_TEXT } }, 3);
      ok(markedOnly.includes('<div class="c-art-warn" id="cArtWarn_3" role="alert">Incomplete draft: part of it was cut where the text is marked.'), file + ': a draft carrying the marker without the flag shows no strip');

      /* omittedChars is a number or it is not said */
      const counts = [[1, '1 character was cut'], ['2048', '2,048 characters were cut'], [-5, 'part of it was cut'], ['<b>9</b>', 'part of it was cut'], [NaN, 'part of it was cut'], [undefined, 'part of it was cut'], [12.9, '12 characters were cut']];
      for (const [value, words] of counts) {
        const html = env.ctx._copilotArtifactHtml({ artifact: { kind: 'text', content: CUT_TEXT, truncated: true, omittedChars: value } }, 4);
        ok(html.includes('Incomplete draft: ' + words + ' where the text is marked.'), file + ': omittedChars ' + String(value) + ' was not said as "' + words + '"');
        ok(!html.includes('<b>'), file + ': omittedChars reached the page unescaped');
      }
    }

    /* ---- 2. Copy ---- */
    {
      const env = boot(lifted, []);
      env.ctx._copilotHistory.push({ role: 'ai', artifact: { kind: 'letter', content: 'Synthetic whole letter.' } });
      mountDraft(env, 0, 'Synthetic whole letter.');
      env.ctx.copilotCopyArtifact(0);
      deq(env.log, [['clipboard', 'Synthetic whole letter.'], ['toast', 'Copied.', 'ok']], file + ': an old-server draft no longer copies at once with no dialog');
    }
    for (const [answer, copied] of [[false, false], [true, true], [undefined, false], [new Error('dialog failed'), false]]) {
      const env = boot(lifted, [answer]);
      env.ctx._copilotHistory.push({ role: 'ai', artifact: { kind: 'letter', content: CUT_TEXT, truncated: true, omittedChars: 1234 } });
      mountDraft(env, 0, CUT_TEXT);
      env.ctx.copilotCopyArtifact(0);
      eq(kinds(env.log).indexOf('clipboard'), -1, file + ': a marked draft reached the clipboard before the doctor answered');
      await tick(); await tick();
      const ask = env.log.find(row => row[0] === 'confirm');
      ok(ask, file + ': a marked draft was copied without asking');
      eq(ask[1], 'This draft is incomplete: 1,234 characters were cut where the text is marked.\n\nCopy it anyway?', file + ': the copy question does not say what was cut');
      eq(ask[2], 'Copy anyway', file + ': the copy question has the wrong OK label');
      if (copied) deq(env.log.slice(1), [['clipboard', CUT_TEXT], ['toast', 'Copied.', 'ok']], file + ': an accepted copy did not copy the marked text');
      else deq(env.log.slice(1), [['toast', 'Nothing was copied.', '']], file + ': a declined or failed question still copied (' + String(answer) + ')');
    }
    {
      const env = boot(lifted, []);
      delete env.ctx.mlsConfirm;
      env.ctx._copilotHistory.push({ role: 'ai', artifact: { kind: 'letter', content: CUT_TEXT, truncated: true, omittedChars: 1234 } });
      mountDraft(env, 0, CUT_TEXT);
      env.ctx.copilotCopyArtifact(0);
      await tick(); await tick();
      deq(env.log, [['toast', 'Nothing was copied.', '']], file + ': with no in-app dialog a marked draft was copied anyway');
    }

    /* ---- 3. the email draft ---- */
    {
      const env = boot(lifted, []);
      env.ctx._copilotHistory.push({ role: 'ai', artifact: { kind: 'email', title: 'Visit follow-up', to: 'patient@example.test', subject: 'Your visit', content: 'Synthetic whole email.' } });
      mountDraft(env, 0, 'Synthetic whole email.');
      env.ctx.copilotArtifactEmail(0);
      deq(env.log, [['email', 'patient@example.test', 'Your visit', 'Synthetic whole email.']], file + ': an old-server email draft no longer opens at once with no dialog');
    }
    for (const [answer, opened] of [[false, false], [true, true]]) {
      const env = boot(lifted, [answer]);
      env.ctx._copilotHistory.push({ role: 'ai', artifact: { kind: 'email', title: 'Visit follow-up', to: 'patient@example.test', subject: 'Your visit', content: CUT_TEXT, truncated: true, omittedChars: 1234 } });
      mountDraft(env, 0, CUT_TEXT);
      env.ctx.copilotArtifactEmail(0);
      eq(kinds(env.log).indexOf('email'), -1, file + ': a marked email draft opened before the doctor answered');
      await tick(); await tick();
      const ask = env.log.find(row => row[0] === 'confirm');
      ok(ask && /Open it as an email draft anyway\?$/.test(ask[1]) && ask[1].startsWith('This draft is incomplete: 1,234 characters were cut'), file + ': the email question is missing or says the wrong thing');
      if (opened) deq(env.log.slice(1), [['email', 'patient@example.test', 'Your visit', CUT_TEXT]], file + ': an accepted email draft did not open');
      else deq(env.log.slice(1), [['toast', 'The email draft was not opened.', '']], file + ': a declined email draft opened anyway');
    }

    /* ---- 4. the EMR route ---- */
    {
      const env = boot(lifted, []);
      env.ctx._copilotHistory.push({ role: 'ai', artifact: { kind: 'letter', content: 'Synthetic whole letter.' } });
      mountDraft(env, 0, 'Synthetic whole letter.');
      env.ctx.copilotArtifactToEMR(0, null);
      deq(env.log, [['emr', 'Synthetic whole letter.']], file + ': an old-server draft no longer takes the EMR route at once');
      const env2 = boot(lifted, []);
      delete env2.ctx.sendToEMRviaAssist;
      env2.ctx._copilotHistory.push({ role: 'ai', artifact: { kind: 'letter', content: 'Synthetic whole letter.' } });
      mountDraft(env2, 0, 'Synthetic whole letter.');
      env2.ctx.copilotArtifactToEMR(0, null);
      deq(env2.log, [['clipboard', 'Synthetic whole letter.'], ['toast', 'Copied.', 'ok']], file + ': without the EMR bridge an old-server draft no longer falls back to Copy');
    }
    for (const bridge of [true, false]) {
      const env = boot(lifted, [true]);
      if (!bridge) delete env.ctx.sendToEMRviaAssist;
      env.ctx._copilotHistory.push({ role: 'ai', artifact: { kind: 'letter', content: CUT_TEXT, truncated: true, omittedChars: 1234 } });
      mountDraft(env, 0, CUT_TEXT);
      env.ctx.copilotArtifactToEMR(0, null);
      await tick(); await tick();
      eq(env.log.length, 1, file + ': the EMR route did more than refuse a marked draft: ' + JSON.stringify(env.log));
      eq(env.log[0][0], 'toast', file + ': the EMR route did not say why it refused');
      eq(env.log[0][2], 'err', file + ': the EMR refusal is not shown as an error');
      ok(env.log[0][1].startsWith('This draft is incomplete: 1,234 characters were cut where the text is marked, so it does not go to the EMR.'), file + ': the EMR refusal says the wrong thing: ' + env.log[0][1]);
    }

    /* ---- 5. editing and Tweak keep the strip true; the flag stays ---- */
    {
      const env = boot(lifted, []);
      env.ctx._copilotHistory.push({ role: 'ai', artifact: { kind: 'letter', content: 'Synthetic whole letter.' } });
      env.ctx._copilotHistory.push({ role: 'ai', artifact: { kind: 'letter', content: CUT_TEXT, truncated: true, omittedChars: 1234 } });
      mountDraft(env, 0, 'Synthetic whole letter.');
      const one = mountDraft(env, 1, CUT_TEXT);

      env.ctx._copilotSyncArtifact(0, 'Synthetic edited whole letter.');
      eq(env.doc.getElementById('cArtWarn_0'), null, file + ': editing an old-server draft painted a cut strip');
      eq(env.ctx._copilotHistory[0].artifact.content, 'Synthetic edited whole letter.', file + ': editing no longer keeps the draft in the history');

      env.ctx._copilotSyncArtifact(1, CUT_TEXT + ' More.');
      let strip = env.doc.getElementById('cArtWarn_1');
      ok(strip && strip.parentNode === env.doc.box && env.doc.box.children.indexOf(strip) === env.doc.box.children.indexOf(one.ta) - 1, file + ': the strip is not painted right above the draft');
      eq(strip.className, 'c-art-warn', file + ': a marked draft shows a soft strip');
      eq(strip.getAttribute('role'), 'alert', file + ': a marked draft strip is not an alert');
      eq(strip.textContent, STRIP_LOUD, file + ': the live strip differs from the rendered one');

      const edited = 'Synthetic referral opening paragraph. Synthetic completed middle. Synthetic referral closing paragraph.';
      one.ta.value = edited;
      env.ctx._copilotSyncArtifact(1, edited);
      strip = env.doc.getElementById('cArtWarn_1');
      eq(strip.className, 'c-art-warn c-art-warn-soft', file + ': the strip did not soften once the marker was edited out');
      eq(strip.getAttribute('role'), 'note', file + ': the softened strip is still an alert');
      eq(strip.textContent, STRIP_SOFT, file + ': the softened strip says the wrong thing');
      eq(env.ctx._copilotHistory[1].artifact.truncated, true, file + ': editing the marker out cleared the flag');
      env.ctx.copilotCopyArtifact(1);
      deq(env.log, [['clipboard', edited], ['toast', 'Copied.', 'ok']], file + ': a draft whose marker was edited out still asks before copying');

      /* the marker comes back: loud again */
      one.ta.value = CUT_TEXT;
      env.ctx._copilotSyncArtifact(1, CUT_TEXT);
      eq(env.doc.getElementById('cArtWarn_1').className, 'c-art-warn', file + ': the strip did not return to amber when the marker came back');

      /* cptrunc-1.1.0: a Tweak (a model rewrite) that lands without the marker
         keeps the strip amber - the cut middle may have been smoothed over */
      one.tw.value = 'shorter';
      env.ctx.__nextTweak = 'Synthetic shorter whole referral.';
      await env.ctx.copilotTweak(1);
      eq(one.ta.value, 'Synthetic shorter whole referral.', file + ': the Tweak did not land');
      eq(env.doc.getElementById('cArtWarn_1').className, 'c-art-warn', file + ': a Tweak that removed the marker softened the strip');
      eq(env.doc.getElementById('cArtWarn_1').getAttribute('role'), 'alert', file + ': a Tweak that removed the marker lowered the alert');
      eq(env.ctx._copilotHistory[1].artifact.truncated, true, file + ': a Tweak cleared the flag');
      /* the doctor's own edit afterwards is what softens it */
      one.ta.value = 'Synthetic shorter whole referral, checked.';
      env.ctx._copilotSyncArtifact(1, one.ta.value);
      eq(env.doc.getElementById('cArtWarn_1').className, 'c-art-warn c-art-warn-soft', file + ': a hand edit after the Tweak did not soften the strip');

      /* a Tweak on an old-server draft paints nothing */
      const zero = env.doc.getElementById('cTw_0'); zero.value = 'warmer';
      env.ctx.__nextTweak = 'Synthetic warmer whole letter.';
      await env.ctx.copilotTweak(0);
      eq(env.doc.getElementById('cArt_0').value, 'Synthetic warmer whole letter.', file + ': an old-server Tweak did not land');
      eq(env.doc.getElementById('cArtWarn_0'), null, file + ': a Tweak on an old-server draft painted a strip');

      /* neither flag nor marker: a stale strip is removed */
      env.ctx._copilotHistory[1].artifact.truncated = false;
      env.ctx._copilotSyncArtifact(1, 'Synthetic whole again.');
      eq(env.doc.getElementById('cArtWarn_1'), null, file + ': a strip stayed up with neither the flag nor the marker');
    }
  }

  /* The four shells ship the same canvas bytes. */
  const blocks = SHELLS.map(file => lift(file).block);
  for (let i = 1; i < blocks.length; i += 1) eq(blocks[i], blocks[0], SHELLS[i] + ': the Copilot canvas differs from ' + SHELLS[0]);

  console.log('PASS Copilot cut-draft canvas: ' + checks + ' checks across ' + SHELLS.length + ' shells; flagged drafts show the strip and ask before copy/email, the EMR route refuses them, and an old-server reply renders and behaves exactly as before');
})().catch(error => { console.error(error); process.exit(1); });
