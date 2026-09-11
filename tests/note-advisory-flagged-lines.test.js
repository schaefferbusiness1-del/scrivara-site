'use strict';
/* noteadv-1.0.0 control: THE LINES THE DICTATION DID NOT CLEARLY SAY REACH
 * THE DOCTOR, AND NOTHING ELSE CHANGES.
 *
 * Owner ask 2026-09-11. The backend now serves a visit note it used to refuse
 * and says, on the same answer, which sentences the recording did not clearly
 * support. Three things had to be true and none of them were:
 *   (1) aiCallRaw answers with a STRING, so every other field of that answer
 *       was discarded three lines after it arrived;
 *   (2) the visit room paints its whole surface as one innerHTML string, so an
 *       advisory appended after the paint would be torn out on the next tick;
 *   (3) a note that reloads or reopens has to bring its lines back with it.
 *
 * This suite executes the REAL shipped bytes: the shell's noteadv block
 * (_mlsNoteAdvisoryFromQuality / _mlsStampVisitNoteAdvisory /
 * _mlsBeginVisitNoteAdvisoryRun / _mlsVisitNoteAdvisoryRecord /
 * _mlsRestoreVisitNoteAdvisory) and the live visit room's advisoryReceipt /
 * advisoryRows / advisoryHtml, lifted out of 1pScribeFlow.html and
 * 1p-mls-connect.js. Every fixture sentence is invented for this file.
 *
 * OLD BYTES FAIL BY NAME: no _mlsNoteAdvisoryFromQuality, no advisoryRows.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
let checks = 0;
function ok(v, msg) { assert.ok(v, msg); checks += 1; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); checks += 1; }
function read(rel) { return fs.readFileSync(path.join(root, rel.split('/').join(path.sep)), 'utf8'); }

function between(text, a, b, label) {
  const start = text.indexOf(a);
  assert.ok(start >= 0, 'missing span start: ' + (label || a));
  const end = text.indexOf(b, start + a.length);
  assert.ok(end > start, 'missing span end: ' + (label || b));
  return text.slice(start, end);
}

/* The repo's established brace walker: quotes and comments are skipped so a
   brace inside either cannot end the function early. */
function extractFn(text, marker) {
  const at = text.indexOf(marker);
  assert.ok(at >= 0, 'missing shipped function: ' + marker);
  const open = text.indexOf('{', at + marker.length - 1);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i], next = text[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i += 1; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { line = true; i += 1; continue; }
    if (ch === '/' && next === '*') { block = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return text.slice(at, i + 1);
  }
  throw new Error('unbalanced shipped function: ' + marker);
}

const SHELL = read('1pScribeFlow.html');
const CONNECT = read('1p-mls-connect.js');
/* Only the LIVE Easy owner: the four later copies return on their first
   statement, and a pin satisfied by a retired copy proves nothing. */
const LIVE = CONNECT.slice(0, CONNECT.indexOf('Retired historical Easy') > 0
  ? CONNECT.indexOf('Retired historical Easy') : CONNECT.length);
ok(LIVE.indexOf("var VER = '3.7.3';") > 0, 'the live Easy 3.7.3 owner is gone');

const SHELL_BLOCK = between(SHELL,
  '/* ===== noteadv-1.0.0 (owner 2026-09-11) - THE LINES',
  '/* ===== end noteadv-1.0.0 ===== */', 'shell noteadv block');
const ROOM_BLOCK = between(LIVE,
  '/* ===== noteadv-1.0.0 (owner 2026-09-11) - THE LINES THE DICTATION DID NOT',
  '/* ===== vntplpick-1.0.0 (owner 2026-09-11)', 'room noteadv block');

/* ==========================================================================
 * PART A -- THE SHELL KEEPS THE RECEIPT, CLEANS IT, AND CLEARS IT
 * ======================================================================== */
function bootShell() {
  const sandbox = {
    String, Number, Object, Array, RegExp, JSON, Date, Math
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SHELL_BLOCK, sandbox, { filename: 'noteadv-1.0.0-shell.js' });
  return sandbox;
}

const REVIEW_ANSWER = {
  status: 'review',
  issues: ['unsupported_claim', 'garbled_term'],
  flagged: [
    { issue: 'unsupported_claim', sentence: 'Synthetic line one: the left elbow was sore after gardening.', arm: 'display' },
    { issue: 'garbled_term', sentence: 'Synthetic line two: the follow up was set for two weeks.', arm: 'athena' }
  ]
};

(function A1_cleanAnswer() {
  const s = bootShell();
  const adv = s._mlsNoteAdvisoryFromQuality(REVIEW_ANSWER);
  ok(adv, 'a review answer produced no receipt at all');
  eq(adv.status, 'review', 'the review answer did not keep its status');
  eq(adv.flagged.length, 2, 'the two flagged lines did not survive cleaning');
  eq(adv.flagged[0].sentence, REVIEW_ANSWER.flagged[0].sentence, 'the first flagged line came back rewritten');
  eq(adv.flagged[1].arm, 'athena', 'the athena arm was not kept');
  eq(adv.issues.join(','), 'unsupported_claim,garbled_term', 'the issue codes were dropped');
})();

(function A2_rubbishAndCaps() {
  const s = bootShell();
  [null, undefined, 0, '', 'a string', [], {}, { status: 'weird' }].forEach(function (junk) {
    eq(s._mlsNoteAdvisoryFromQuality(junk === undefined ? null : junk), null,
      'a non-answer produced a receipt instead of nothing');
  });
  const many = { status: 'review', issues: [], flagged: [] };
  for (let i = 0; i < 40; i += 1) many.flagged.push({ issue: 'code_' + i, sentence: 'Synthetic line ' + i + '.', arm: 'display' });
  /* noteadv-1.0.1: the server serves at most 24 doubted sentences, so 24 is
     what this side keeps. At 12 a long note showed half its doubts under an
     amber line that said "check the highlighted lines" and said nothing about
     the ones it had dropped. */
  eq(s._mlsNoteAdvisoryFromQuality(many).flagged.length, 24,
    'the flagged list does not keep every sentence the server can serve');
  eq(s._mlsVisitNoteAdvisoryRecord.length, 0, 'the record reader grew an argument');
  s.__mlsLastNoteAdvisory = many;
  s._mlsStampVisitNoteAdvisory();
  eq(s._mlsVisitNoteAdvisoryRecord().flagged.length, 24,
    'the saved record throws away half the doubted lines the screen shows');
  const long = { status: 'review', issues: [], flagged: [{ issue: 'x_code', sentence: 'q'.repeat(4000), arm: 'display' }] };
  eq(s._mlsNoteAdvisoryFromQuality(long).flagged[0].sentence.length, 600, 'a flagged sentence is not capped at 600 characters');
  const bad = { status: 'review', issues: ['<script>', 'ok_code'], flagged: [{ issue: '<b>', sentence: 'Synthetic line.', arm: 'nonsense' }] };
  const cleaned = s._mlsNoteAdvisoryFromQuality(bad);
  eq(cleaned.issues.join(','), 'ok_code', 'an issue code that is not a plain code got through');
  eq(cleaned.flagged[0].issue, '', 'an issue code that is not a plain code got through on a row');
  eq(cleaned.flagged[0].arm, 'display', 'an unknown arm was not narrowed to display');
})();

(function A3_okAndOlderServer() {
  const s = bootShell();
  eq(s._mlsNoteAdvisoryFromQuality({ status: 'ok', issues: [], flagged: [] }).status, 'ok',
    'an ok answer did not stay ok');
  eq(s._mlsNoteAdvisoryFromQuality({ status: 'review', issues: [], flagged: [] }).status, 'ok',
    'a review answer with no lines still claims there is something to check');
  /* THE OLDER SERVER: no quality field at all. Nothing is stamped, and the
     room's own gate below sees nothing to paint. */
  s.__mlsLastNoteAdvisory = null;
  s._mlsStampVisitNoteAdvisory();
  eq(s.window.__mlsVisitNoteAdvisory.status, 'ok', 'an answer with no quality field claimed there are lines to check');
  eq(s.window.__mlsVisitNoteAdvisory.flagged.length, 0, 'an answer with no quality field produced flagged lines');
})();

(function A4_stampScopeAndClear() {
  const s = bootShell();
  s.__mlsLastNoteAdvisory = REVIEW_ANSWER;
  s.__mlsLastGenTemplateContract = { id: 'tpl_visit_1', name: 'Office visit' };
  const first = s._mlsStampVisitNoteAdvisory();
  eq(first.status, 'review', 'the stamped receipt lost its status');
  eq(first.template.id, 'tpl_visit_1', 'the stamped receipt does not name the template that shaped the note');
  eq(first.template.chosen, false, 'an automatic template was recorded as a doctor choice');
  ok(/^adv[a-z0-9]+-\d+$/.test(first.key), 'the receipt key is not a plain counter stamp');
  ok(first.key.indexOf('tpl_visit_1') < 0, 'the receipt key carries something other than a counter');

  /* A NEW RUN CLEARS THE LAST NOTE'S LINES - that is the whole point of the
     entry clear, and it runs after every refusal so a refused press keeps the
     note on screen exactly as it was. */
  s._mlsBeginVisitNoteAdvisoryRun();
  eq(s.window.__mlsVisitNoteAdvisory, null, 'a new generation left the previous note lines on screen');
  eq(s.window.__mlsLastNoteAdvisory, null, 'a new generation left the previous answer parked');

  s.__mlsLastNoteAdvisory = REVIEW_ANSWER;
  const second = s._mlsStampVisitNoteAdvisory();
  ok(second.key !== first.key, 'two generations produced the same receipt key');
})();

(function A5_persistRestore() {
  const s = bootShell();
  s.__mlsLastNoteAdvisory = REVIEW_ANSWER;
  s.__mlsLastGenTemplateContract = { id: 'tpl_visit_1', name: 'Office visit' };
  s.__mlsVisitTplPickUsed = { id: 'tpl_visit_1', plain: false, at: Date.now() };
  s._mlsStampVisitNoteAdvisory();
  const rec = s._mlsVisitNoteAdvisoryRecord();
  ok(rec, 'the receipt does not serialise for the draft and the saved note');
  eq(rec.flagged.length, 2, 'the saved record lost the flagged lines');
  eq(rec.template.chosen, true, 'the saved record forgot that the doctor chose this template');
  eq(Object.keys(rec).sort().join(','), 'at,flagged,issues,key,status,template',
    'the saved record grew a field - it carries the note lines and nothing else');

  const round = JSON.parse(JSON.stringify({ noteAdvisory: rec }));
  s._mlsBeginVisitNoteAdvisoryRun();
  eq(s.window.__mlsVisitNoteAdvisory, null, 'the run clear did not empty the receipt before the restore test');
  const back = s._mlsRestoreVisitNoteAdvisory(round);
  eq(back.status, 'review', 'a reopened note did not bring its lines back');
  eq(back.flagged[0].sentence, REVIEW_ANSWER.flagged[0].sentence, 'a reopened line came back changed');
  eq(back.key, rec.key, 'a reopened note did not keep the receipt it was saved with');
  eq(back.template.id, 'tpl_visit_1', 'a reopened note forgot which template wrote it');

  /* A saved note from before this change carries no field, and restores to
     nothing rather than to somebody else's lines. */
  eq(s._mlsRestoreVisitNoteAdvisory({ soap: 'an older saved note' }), null,
    'a note saved before this change restored lines it never had');
  eq(s.window.__mlsVisitNoteAdvisory, null, 'an older saved note left stale lines published');
})();

(function A6_plainChoiceIsExplicit() {
  const s = bootShell();
  s.__mlsLastNoteAdvisory = null;
  s.__mlsLastGenTemplateContract = null;
  s.__mlsVisitTplPickUsed = null;
  s._mlsStampVisitNoteAdvisory();
  eq(s._mlsVisitNotePlainChosen(), false,
    'a note that simply had no template was read as a deliberate plain-note choice');
  s.__mlsVisitTplPickUsed = { id: '', plain: true, at: Date.now() };
  s._mlsStampVisitNoteAdvisory();
  eq(s._mlsVisitNotePlainChosen(), true, 'an explicit plain-note choice was not recorded');
})();

/* ==========================================================================
 * PART B -- THE VISIT ROOM PAINTS THE AMBER LINE, AND ONLY WHEN IT SHOULD
 * ======================================================================== */
function bootRoom(opts) {
  opts = opts || {};
  const S = { phase: 'note', flagKept: {}, flagKeptKey: '' };
  const note = { value: opts.note == null ? '' : opts.note };
  /* The advisory host the room patches in place, and the Keep buttons that
     carry their own sentence. Both stand in for real nodes only. */
  const host = { innerHTML: '' };
  const buttons = {};
  const sandbox = {
    String, Number, Object, Array, RegExp, JSON, Date, Math,
    S,
    document: {
      getElementById(id) {
        if (id === 'noteBox') return note;
        if (id === 'ez3Advisory') return host;
        return buttons[id] || null;
      }
    }
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    'function $(id){ return document.getElementById(id); }\n' +
    'function safe(fn, d){ try { return fn(); } catch (e) { return d; } }\n' +
    "function esc(s){ return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) {\n" +
    '  return { \'&\': \'&amp;\', \'<\': \'&lt;\', \'>\': \'&gt;\', \'"\': \'&quot;\', "\'": \'&#39;\' }[c]; }); }\n' +
    "function noteText(){ var n = $('noteBox'); return n ? (n.value || '') : ''; }\n" +
    ROOM_BLOCK + '\n' +
    'this.api = { advisoryRows: advisoryRows, advisoryHtml: advisoryHtml, advisoryReceipt: advisoryReceipt,\n' +
    '  advisoryInnerHtml: advisoryInnerHtml, advisoryRepaint: advisoryRepaint, advisoryKeep: advisoryKeep,\n' +
    '  ADV_MAX_ROWS: ADV_MAX_ROWS };',
    sandbox, { filename: 'noteadv-1.0.0-room.js' });
  /* The buttons the room would have painted, exactly as advisoryInnerHtml
     writes them: each carries the sentence it belongs to. */
  function mountButtons() {
    Object.keys(buttons).forEach(function (k) { delete buttons[k]; });
    const html = sandbox.api.advisoryInnerHtml();
    const re = /data-flag="([^"]*)" id="(ez3FlagKeep_\d+)"/g;
    let m;
    while ((m = re.exec(html)) !== null) {
      (function (value, id) {
        buttons[id] = { id: id, getAttribute(name) { return name === 'data-flag' ? value : null; } };
      })(m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'"), m[2]);
    }
    return buttons;
  }
  /* Exactly what the shipped Keep handler does: resolve the button, keep by
     its sentence, repaint only the amber list. */
  function pressKeep(n) {
    mountButtons();
    const btn = buttons['ez3FlagKeep_' + n] || null;
    const changed = sandbox.api.advisoryKeep(btn, n);
    if (changed) sandbox.api.advisoryRepaint();
    return changed;
  }
  return { sandbox, S, note, host, api: sandbox.api, mountButtons, pressKeep,
    texts: function () { return sandbox.api.advisoryRows().map(function (r) { return r.text; }); } };
}

const LINE_A = 'Synthetic line one: the left elbow was sore after gardening.';
const LINE_B = 'Synthetic line two: the follow up was set for two weeks.';
const NOTE_TEXT = 'S: Synthetic opening line.\n' + LINE_A + '\nA: Synthetic assessment.\n' + LINE_B + '\nP: Synthetic plan.';

(function B1_paintsOnReview() {
  const r = bootRoom({ note: NOTE_TEXT });
  r.sandbox.__mlsVisitNoteAdvisory = { status: 'review', key: 'adv1-1', issues: [], flagged: [
    { issue: 'unsupported_claim', sentence: LINE_A, arm: 'display' },
    { issue: 'garbled_term', sentence: LINE_B, arm: 'athena' }
  ] };
  const html = r.api.advisoryHtml();
  ok(html.indexOf('Check the highlighted lines: the dictation did not clearly say them.') > 0,
    'the amber line the owner asked for is not on the note screen');
  ok(html.indexOf('class="ez3-warnbar"') > 0, 'the advisory does not reuse the room\'s own amber bar');
  eq((html.match(/class="ez3-flagline"/g) || []).length, 2, 'the two flagged lines were not shown');
  eq((html.match(/id="ez3FlagKeep_/g) || []).length, 2, 'each flagged line does not carry its own Keep');
  ok(html.indexOf(LINE_A) > 0 && html.indexOf(LINE_B) > 0, 'the flagged lines themselves are not shown');
  /* NOT inside a .ez3-row2 and not inside #ez3StyleChips - both are folded
     away behind "Visit shortcuts" by feat_mls_visit_focus.js. */
  ok(html.indexOf('ez3-row2') < 0 && html.indexOf('ez3StyleChips') < 0,
    'the advisory was placed where the visit-focus fold hides it');
})();

(function B2_silentOnOkAndOnNoReceipt() {
  const r = bootRoom({ note: NOTE_TEXT });
  /* noteadv-1.0.1: the host is always painted so the note editor has somewhere
     to write when the last line is edited away; with nothing to say it is
     empty, and an empty host says nothing. */
  const EMPTY = '<div class="ez3-advisory" id="ez3Advisory"></div>';
  r.sandbox.__mlsVisitNoteAdvisory = { status: 'ok', key: 'adv1-1', issues: [], flagged: [] };
  eq(r.api.advisoryHtml(), EMPTY, 'an ok note still painted an amber line');
  eq(r.api.advisoryInnerHtml(), '', 'an ok note put something inside the amber host');
  r.sandbox.__mlsVisitNoteAdvisory = null;
  eq(r.api.advisoryHtml(), EMPTY, 'a note with no receipt at all still painted an amber line');
  /* A server that sends nothing leaves nothing behind: same screen as before. */
  delete r.sandbox.__mlsVisitNoteAdvisory;
  eq(r.api.advisoryHtml(), EMPTY, 'an older server that sends no quality field changed the screen');
})();

(function B3_editedAwayStopsShowing() {
  const r = bootRoom({ note: NOTE_TEXT });
  r.sandbox.__mlsVisitNoteAdvisory = { status: 'review', key: 'adv1-1', issues: [], flagged: [
    { issue: 'unsupported_claim', sentence: LINE_A, arm: 'display' },
    { issue: 'garbled_term', sentence: LINE_B, arm: 'athena' }
  ] };
  eq(r.api.advisoryRows().length, 2, 'both flagged lines should be shown before any edit');
  r.note.value = NOTE_TEXT.replace(LINE_A, 'Synthetic line one, rewritten by the doctor.');
  const rows = r.texts();
  eq(rows.length, 1, 'a line the doctor edited away is still being flagged');
  eq(rows[0], LINE_B, 'the wrong line survived the edit');
  /* Wrapping and spacing are not an edit: the same words still count. */
  r.note.value = NOTE_TEXT.replace(LINE_B, LINE_B.replace(/ /g, '\n   '));
  ok(r.texts().indexOf(LINE_B) >= 0, 'a re-wrapped line stopped counting as the same line');
})();

/* noteadv-1.0.1: THE LIST FOLLOWS THE TYPING. Nothing else in the room
   repaints from a keystroke, so before this the amber row for a sentence the
   doctor had already deleted sat there until some unrelated press. */
(function B3b_editRepaintsInPlace() {
  const r = bootRoom({ note: NOTE_TEXT });
  r.sandbox.__mlsVisitNoteAdvisory = { status: 'review', key: 'adv1-1', issues: [], flagged: [
    { issue: 'unsupported_claim', sentence: LINE_A, arm: 'display' },
    { issue: 'garbled_term', sentence: LINE_B, arm: 'athena' }
  ] };
  r.host.innerHTML = r.api.advisoryInnerHtml();
  eq((r.host.innerHTML.match(/class="ez3-flagline"/g) || []).length, 2, 'the list did not start with both lines');
  r.note.value = NOTE_TEXT.replace(LINE_A, 'Synthetic line one, rewritten by the doctor.');
  eq(r.api.advisoryRepaint(), true, 'an edit did not repaint the amber list');
  eq((r.host.innerHTML.match(/class="ez3-flagline"/g) || []).length, 1,
    'the line the doctor just deleted is still on screen');
  ok(r.host.innerHTML.indexOf(LINE_A) < 0, 'the deleted line is still painted');
  eq(r.api.advisoryRepaint(), false, 'an unchanged list was rewritten anyway - that is what eats a click');
  /* The last line going away empties the host rather than needing a render. */
  r.note.value = 'S: Synthetic opening line only.';
  eq(r.api.advisoryRepaint(), true, 'clearing the last flagged line did not repaint');
  eq(r.host.innerHTML, '', 'the amber bar stayed up over a note with no flagged line left in it');
})();

(function B4_keepRemovesOneLine() {
  const r = bootRoom({ note: NOTE_TEXT });
  r.sandbox.__mlsVisitNoteAdvisory = { status: 'review', key: 'adv1-1', issues: [], flagged: [
    { issue: 'unsupported_claim', sentence: LINE_A, arm: 'display' },
    { issue: 'garbled_term', sentence: LINE_B, arm: 'athena' }
  ] };
  eq(r.api.advisoryRows().length, 2, 'both lines should start visible');
  /* Exactly what the shipped Keep handler does: press the button, which
     carries its own sentence, and repaint only the amber list. */
  eq(r.pressKeep(0), true, 'pressing Keep on the first line did nothing');
  const left = r.texts();
  eq(left.length, 1, 'Keep did not remove the line it was pressed on');
  eq(left[0], LINE_B, 'Keep removed the wrong line');
  eq(r.note.value, NOTE_TEXT, 'Keep changed a word of the note');
  eq(r.pressKeep(0), true, 'pressing Keep on the remaining line did nothing');
  eq(r.api.advisoryInnerHtml(), '', 'keeping every line still left the amber line on screen');
  eq(r.host.innerHTML, '', 'Keep did not clear the amber list it was pressed in');

  /* A NEW NOTE RESETS WHAT WAS KEPT - a receipt with a different key is a
     different note, and its lines have never been read. */
  r.sandbox.__mlsVisitNoteAdvisory = { status: 'review', key: 'adv2-2', issues: [], flagged: [
    { issue: 'unsupported_claim', sentence: LINE_A, arm: 'display' }
  ] };
  eq(r.api.advisoryRows().length, 1, 'a freshly generated note inherited the last note\'s kept lines');
})();

/* noteadv-1.0.1: KEEP CLEARS THE LINE IT WAS PRESSED ON, NOT THE ONE THAT
   HAPPENS TO SIT AT THAT POSITION NOW. The numbers on the buttons were fixed
   when the list was painted, but the handler re-read the list at click time -
   so an edit that removed an earlier line renumbered it underneath, and Keep
   then cleared a sentence the doctor had never read. */
(function B4b_keepIsByTheSentenceNotByPosition() {
  const LINE_C = 'Synthetic line three: the brace is to be worn at night.';
  const note = 'S: Synthetic opening line.\n' + LINE_A + '\n' + LINE_B + '\n' + LINE_C + '\nP: Synthetic plan.';
  const r = bootRoom({ note: note });
  r.sandbox.__mlsVisitNoteAdvisory = { status: 'review', key: 'adv9-1', issues: [], flagged: [
    { issue: 'unsupported_claim', sentence: LINE_A, arm: 'display' },
    { issue: 'garbled_term', sentence: LINE_B, arm: 'display' },
    { issue: 'unsupported_claim', sentence: LINE_C, arm: 'display' }
  ] };
  /* The list is painted with all three; the buttons carry their own line. */
  const painted = r.mountButtons();
  eq(Object.keys(painted).length, 3, 'the list did not paint a Keep for each line');
  /* Now the doctor deletes the FIRST flagged line without any repaint, and
     then presses the Keep that is still sitting beside the second one. */
  r.note.value = note.replace(LINE_A + '\n', '');
  const btn = painted.ez3FlagKeep_1;
  eq(r.api.advisoryKeep(btn, 1), true, 'Keep beside the second line did nothing');
  const left = r.texts();
  ok(left.indexOf(LINE_B) < 0, 'Keep cleared a different line than the one it was pressed on');
  ok(left.indexOf(LINE_C) >= 0, 'Keep silently cleared the line below the one that was pressed');
  eq(left.length, 1, 'the wrong number of lines survived the press');
})();

/* noteadv-1.0.1: A LINE THE RE-FORMAT COULD NOT FIND AGAIN IS KEPT AND SAYS
   SO. Dropping it would hide a doubt the saved note still carries. */
(function B4c_lostLineStaysListed() {
  const r = bootRoom({ note: NOTE_TEXT });
  r.sandbox.__mlsVisitNoteAdvisory = { status: 'review', key: 'adv8-1', issues: [], flagged: [
    { issue: 'unsupported_claim', sentence: 'Synthetic line that the re-format dissolved.', arm: 'display', lost: true },
    { issue: 'garbled_term', sentence: LINE_B, arm: 'athena' }
  ] };
  const rows = r.api.advisoryRows();
  eq(rows.length, 2, 'a line that could not be re-found was dropped from the list');
  eq(rows[0].lost, true, 'the line that could not be re-found is not marked');
  const html = r.api.advisoryInnerHtml();
  ok(html.indexOf('MLS could not find this line after the note was re-formatted.') > 0,
    'the doctor is not told that a doubted line could not be found again');
  ok(html.indexOf('Read the whole note before you sign it.') > 0,
    'the line that could not be found does not name the one step to take');
  /* And Keep still clears it, because it is the doctor's own line. */
  eq(r.pressKeep(0), true, 'Keep did not work on a line that could not be re-found');
  eq(r.api.advisoryRows().length, 1, 'Keep did not clear the line that could not be re-found');
})();

(function B5_escapedNotInjected() {
  const r = bootRoom({ note: 'A: <b>synthetic</b> "quoted" line & more.' });
  r.sandbox.__mlsVisitNoteAdvisory = { status: 'review', key: 'adv3-1', issues: [], flagged: [
    { issue: 'unsupported_claim', sentence: '<b>synthetic</b> "quoted" line & more.', arm: 'display' }
  ] };
  const html = r.api.advisoryHtml();
  ok(html.indexOf('&lt;b&gt;') > 0, 'a flagged line is put on screen as markup instead of as words');
  ok(html.indexOf('<b>synthetic</b>') < 0, 'a flagged line reached the surface unescaped');
})();

/* ==========================================================================
 * PART C -- THE LINES ARE THE DOCTOR'S OWN WORDS AND GO NOWHERE ELSE
 * ======================================================================== */
ok(SHELL_BLOCK.indexOf('console.') < 0, 'the shell advisory block reaches for console');
ok(ROOM_BLOCK.indexOf('console.') < 0, 'the visit room advisory block reaches for console');
[SHELL_BLOCK, ROOM_BLOCK].forEach(function (blk, i) {
  ok(!/logEvent\s*\(/.test(blk), 'advisory block ' + i + ' logs an event carrying the note lines');
  ok(!/fetch\s*\(/.test(blk), 'advisory block ' + i + ' sends the note lines somewhere');
  ok(!/navigator\s*\./.test(blk), 'advisory block ' + i + ' hands the note lines to the browser');
});
/* The room never puts a flagged line into a toast body: a toast is a fixed
   sentence, the lines belong in the note card. */
ok(ROOM_BLOCK.indexOf('toast(') < 0, 'the advisory rows are announced through a toast');

/* ==========================================================================
 * PART D -- IT IS BUILT INTO THE SURFACE STRING, IN THE NOTE BRANCH
 * ======================================================================== */
ok(LIVE.indexOf("h += '<div class=\"ez3-card ez3-notecard\">' +\n             advisoryHtml() +") > 0,
  'the amber line is not built into the note card the room paints');
const NOTE_BRANCH = between(LIVE, "} else if (S.phase === 'note') {", '} else { /* idle / stopped */', 'note branch');
ok(NOTE_BRANCH.indexOf('advisoryHtml()') > 0, 'the advisory is not inside the drafted-note branch');
eq((LIVE.match(/advisoryHtml\(\)/g) || []).length, 2,
  'advisoryHtml is painted from more than one place - two copies of one advisory is the defect it avoids');

/* Nothing about Review or Send moved. */
ok(LIVE.indexOf("id=\"ez3Sign\"") > 0 && LIVE.indexOf("id=\"ez3Send\"") > 0,
  'the Review and Send controls are no longer rendered');

/* ==========================================================================
 * PART E -- ALL FOUR SHELLS AND ALL THREE CONNECT LANES CARRY THE SAME BYTES
 * ======================================================================== */
['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'].forEach(function (name) {
  const src = read(name);
  eq(between(src, '/* ===== noteadv-1.0.0 (owner 2026-09-11) - THE LINES',
    '/* ===== end noteadv-1.0.0 ===== */', name + ' noteadv'), SHELL_BLOCK,
    name + ': the noteadv block is not byte-identical to 1pScribeFlow.html');
  ok(src.indexOf('try{ window.__mlsLastNoteAdvisory=_mlsNoteAdvisoryFromQuality(') > 0,
    name + ': the answer is no longer caught where it arrives');
  ok(src.indexOf('noteAdvisory: ((typeof _mlsVisitNoteAdvisoryRecord===\'function\')?_mlsVisitNoteAdvisoryRecord():null),') > 0,
    name + ': the saved note record no longer carries the lines to check');
});
['1p-mls-connect.js', 'mls-connect.js', 'cloned-mls-connect.js'].forEach(function (name) {
  const src = read(name);
  const live = src.slice(0, src.indexOf('Retired historical Easy') > 0 ? src.indexOf('Retired historical Easy') : src.length);
  eq(extractFn(live, '  function advisoryRows() {'), extractFn(LIVE, '  function advisoryRows() {'),
    name + ': advisoryRows is not byte-identical to 1p-mls-connect.js');
  eq(extractFn(live, '  function advisoryHtml() {'), extractFn(LIVE, '  function advisoryHtml() {'),
    name + ': advisoryHtml is not byte-identical to 1p-mls-connect.js');
  ['  function advisoryInnerHtml() {', '  function advisoryRepaint() {', '  function advisoryKeep(btn, n) {'].forEach(function (marker) {
    eq(extractFn(live, marker), extractFn(LIVE, marker),
      name + ': ' + marker.trim() + ' is not byte-identical to 1p-mls-connect.js');
  });
  ok(live.indexOf('.ez3-flagline{background:rgba(234,179,8,.14);') > 0,
    name + ': the flagged-line skin no longer reuses the room\'s own amber');
  ok(live.indexOf('safe(function () { return advisoryRepaint(); });') > 0,
    name + ': typing in the note no longer repaints the flagged lines');
});

/* ==========================================================================
 * PART F (noteadv-1.0.1) -- THE RECEIPT DIES WITH THE NOTE IT BELONGS TO,
 * FOLLOWS THE DRAFT THAT IS KEPT, AND SURVIVES THE RE-FORMAT
 * ======================================================================== */

/* F1: A PATIENT SWITCH EMPTIES THE EDITOR, so the lines to check go with it.
   Before this, patient A's doubted sentences were written into patient B's
   draft and saved note the moment B's transcript was touched. */
(function F1_forgetOnANewVisit() {
  const s = bootShell();
  s.__mlsLastNoteAdvisory = REVIEW_ANSWER;
  s.__mlsLastGenTemplateContract = { id: 'tpl_visit_1', name: 'Office visit' };
  s.__mlsVisitTplPickUsed = { id: 'tpl_visit_1', plain: false, at: Date.now() };
  s.__mlsVisitTplPick = { id: 'tpl_visit_2', plain: false, at: Date.now() };
  s._mlsStampVisitNoteAdvisory();
  eq(s._mlsVisitNoteAdvisoryRecord().flagged.length, 2, 'the receipt was not stamped before the forget test');
  s._mlsForgetVisitNoteAdvisory();
  eq(s._mlsVisitNoteAdvisoryRecord(), null,
    'the last patient\'s lines are still written into the next patient\'s draft and saved note');
  eq(s.window.__mlsVisitNoteAdvisory, null, 'the last patient\'s lines are still on screen');
  eq(s.window.__mlsLastNoteAdvisory, null, 'the last answer is still parked for the next note to pick up');
  eq(s.window.__mlsVisitTplPickUsed, null, 'the last note\'s template is still named on the next patient\'s note');
  eq(s.window.__mlsVisitTplPick, null,
    'a template choice armed for a press that never ran survives into the next patient\'s note');
  /* And the restore path still restores - forgetting is not a one-way door. */
  s.__mlsLastNoteAdvisory = REVIEW_ANSWER;
  s._mlsStampVisitNoteAdvisory();
  eq(s._mlsVisitNoteAdvisoryRecord().flagged.length, 2, 'a note generated after a switch carries no lines');
})();

/* F2: and the two places that empty the editor actually call it. */
const NEWVISIT_FN = extractFn(SHELL, 'function newVisit(opts){');
ok(NEWVISIT_FN.indexOf('_mlsForgetVisitNoteAdvisory()') > 0,
  'newVisit() empties the editor but leaves the last patient\'s lines to check standing');
ok(NEWVISIT_FN.indexOf('currentAthenaNote=\'\'') > 0, 'the newVisit reset block moved - re-aim this pin');
ok(SHELL.indexOf('if (!d) { forgetNoteAdvisory(); return false; }') > 0,
  'switching to a patient with no parked work leaves the previous patient\'s lines on screen');
ok(SHELL.indexOf('if (safe(function () { return editorState().any; }, true)) return;') > 0,
  'the parked-work clear would fire over a note that is already on screen');

/* F3: THE LINES BELONG TO THE DRAFT THAT IS KEPT. A note under the quality
   floor is written a SECOND time and the first draft is kept unless the second
   scores higher - but the doubted sentences are parked on one shared spot that
   every answer overwrites, so the note on screen was stamped with the OTHER
   draft's doubts. Runs the REAL shipped repair pass. */
const REPAIR_FN = extractFn(SHELL, 'async function _mlsNoteQualityRepairStructured(');
async function repairRun(opts) {
  const calls = [];
  const sandbox = { String, Number, Object, Array, RegExp, JSON, Date, Math, Promise, calls };
  sandbox.window = sandbox;
  sandbox.__firstAdv = { status: 'review', issues: [], flagged: [{ issue: 'a_code', sentence: 'First draft synthetic line.', arm: 'display' }] };
  sandbox.__secondAdv = { status: 'review', issues: [], flagged: [{ issue: 'b_code', sentence: 'Second draft synthetic line.', arm: 'display' }] };
  sandbox.__throwOnSecond = opts.throwOnSecond === true;
  sandbox.__used = opts.used || 'first';
  vm.createContext(sandbox);
  vm.runInContext(
    'var _mlsGenTplMeasure = null;\n' +
    'async function __mlsNoteQualityEnsure(){ return true; }\n' +
    "function __mlsNoteQualityGrade(text){ return { pass: false, score: String(text).indexOf('SECOND') >= 0 ? 9 : 1 }; }\n" +
    'function __mlsNoteQualityRecord(){ return true; }\n' +
    "function _mlsGenerationTimeoutMs(){ return 90000; }\n" +
    'function _mlsValidateStructuredNoteResult(){ return true; }\n' +
    'function __mlsNoteQualityBetter(aText, aRes, bText, bRes){ return __used === "second" ? { used: "second", res: bRes } : { used: "first", res: aRes }; }\n' +
    'async function _mlsAwaitGeneration(run, p){ return await p; }\n' +
    'async function callOpenAI(transcript, key, options){\n' +
    '  calls.push({ visitTplPick: options && options.visitTplPick, noteqFindings: !!(options && options.noteqFindings) });\n' +
    '  window.__mlsLastNoteAdvisory = __secondAdv;\n' +
    '  if (__throwOnSecond) throw new Error("synthetic second-call failure");\n' +
    '  return { soap: "SECOND draft synthetic note body." };\n' +
    '}\n' +
    REPAIR_FN + '\n' +
    'this.run = function (pick) {\n' +
    '  window.__mlsLastNoteAdvisory = __firstAdv;\n' +
    '  var run = { controller: { signal: null } };\n' +
    '  return _mlsNoteQualityRepairStructured({ soap: "FIRST draft synthetic note body." },\n' +
    '    "synthetic transcript", "k", null, run, null, pick);\n' +
    '};',
    sandbox, { filename: 'noteadv-1.0.1-repair.js' });
  const pick = { id: 'tpl_picked', plain: false, at: Date.now(), pt: '' };
  const result = await sandbox.run(pick);
  return { sandbox, calls, result, adv: sandbox.window.__mlsLastNoteAdvisory, pick };
}

/* F4: THE RE-FORMAT REWRITES THE NOTE AFTER THE LINES WERE STAMPED. */
(function F4_reanchorAfterTheReformat() {
  const s = bootShell();
  const KEPT = 'Synthetic kept line: the splint was refitted today.';
  const MOVED = 'Synthetic moved line: the follow up is in three weeks.';
  const GONE = 'Synthetic vanished line: the old brace was discarded.';
  s.__mlsLastNoteAdvisory = { status: 'review', issues: [], flagged: [
    { issue: 'a_code', sentence: KEPT, arm: 'display' },
    { issue: 'b_code', sentence: MOVED, arm: 'display' },
    { issue: 'c_code', sentence: GONE, arm: 'display' }
  ] };
  s._mlsStampVisitNoteAdvisory();
  /* The templated answer: one line verbatim, one with the punctuation and the
     capitals moved, and one that the re-format simply did not reproduce. */
  const MOVED_NEW = 'Synthetic moved line - the follow up is in three weeks';
  const REFORMATTED = 'PLAN:\n' + KEPT + '\n' + MOVED_NEW + '\nDISPOSITION: routine.';
  const back = s._mlsReanchorVisitNoteAdvisory(REFORMATTED);
  eq(back.flagged.length, 3, 'the re-anchor pass dropped a doubted line');
  eq(back.flagged[0].sentence, KEPT, 'a line that survived the re-format word for word was rewritten');
  eq(back.flagged[0].lost, false, 'a line still in the note was marked as missing');
  eq(back.flagged[1].sentence, MOVED_NEW,
    'a line whose punctuation the re-format changed was not re-attached to its new wording');
  eq(back.flagged[1].lost, false, 'a line that was found again is still marked as missing');
  eq(back.flagged[2].sentence, GONE, 'a line that could not be found was quietly rewritten');
  eq(back.flagged[2].lost, true, 'a line the re-format dissolved was dropped instead of marked');
  /* Every re-attached line is really in the new note, so the room will paint
     it - that is the whole point of re-attaching it. */
  const flat = REFORMATTED.replace(/\s+/g, ' ').trim();
  ok(flat.indexOf(back.flagged[0].sentence) >= 0, 'a re-attached line is not in the note it was attached to');
  ok(flat.indexOf(back.flagged[1].sentence) >= 0, 'a re-attached line is not in the note it was attached to');
  /* And the mark travels with the note. */
  const rec = s._mlsVisitNoteAdvisoryRecord();
  eq(rec.flagged[2].lost, true, 'the saved note forgets that a line could not be found');
  const round = JSON.parse(JSON.stringify({ noteAdvisory: rec }));
  eq(s._mlsRestoreVisitNoteAdvisory(round).flagged[2].lost, true,
    'a reopened note forgets that a line could not be found');
  /* Nothing to re-anchor is not an error. */
  s._mlsForgetVisitNoteAdvisory();
  eq(s._mlsReanchorVisitNoteAdvisory('some other synthetic note'), null,
    'the re-anchor pass invented a receipt where there was none');
})();

ok(SHELL.indexOf('_mlsReanchorVisitNoteAdvisory((typeof currentFormat!==\'undefined\'&&currentFormat===\'insurance\')') > 0,
  'the re-format no longer re-anchors the doubted lines against the note it just rewrote');

(async function tail() {
  const keptFirst = await repairRun({ used: 'first' });
  eq(keptFirst.adv, keptFirst.sandbox.__firstAdv,
    'the note on screen is stamped with the doubted lines of the draft that was thrown away');
  eq(String(keptFirst.result.soap).indexOf('FIRST'), 0, 'the repair pass kept the wrong draft in this fixture');
  eq(keptFirst.calls.length, 1, 'the repair pass did not ask for exactly one second draft');
  eq(keptFirst.calls[0].noteqFindings, true, 'the second draft was asked for without the first draft\'s findings');
  eq(keptFirst.calls[0].visitTplPick, keptFirst.pick,
    'the second draft was written without the template the doctor chose for this note');

  const tookSecond = await repairRun({ used: 'second' });
  eq(tookSecond.adv, tookSecond.sandbox.__secondAdv,
    'the second draft was kept but stamped with the first draft\'s doubted lines');
  eq(String(tookSecond.result.soap).indexOf('SECOND'), 0, 'the repair pass kept the wrong draft in this fixture');

  const blewUp = await repairRun({ used: 'second', throwOnSecond: true });
  eq(blewUp.adv, blewUp.sandbox.__firstAdv,
    'a second draft that failed still left its doubted lines stamped on the first draft');
  eq(String(blewUp.result.soap).indexOf('FIRST'), 0, 'a failed second draft did not leave the first one standing');

  console.log('PASS note-advisory-flagged-lines: ' + checks +
    ' checks - the flagged lines are caught where the answer arrives, cleaned, kept with the note, cleared by the ' +
    'next run and by a patient switch, restored with a reopened note, re-attached after the template re-format (or ' +
    'kept and marked when they cannot be found), stamped from the draft that is actually kept, painted as one amber ' +
    'line plus a pressable list inside the room\'s own surface string, repainted in place as the doctor types, ' +
    'removed by an edit or by a Keep resolved by its own sentence, silent on an ok answer and on an older server, ' +
    'and never logged or sent anywhere');
})().catch(function (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
