'use strict';
/*
 * THE MICROPHONE MAY NOT END THE AVATAR'S SENTENCE
 * =============================================================================
 * Owner: "it litterly never gets out everyhting it wants to say caosue it picks
 *         up its own talking."
 *
 * Eight rounds tried to fix this by rewriting the FILING path — the code that
 * decides which words become the patient's answer — and every one of them broke
 * it. The filing path is not the defect. It gets negation right today:
 * "no pain in my left leg", "not the right one", "never on the left side",
 * "denies chest pain" all survive on live, and Section 1 of this file proves it
 * by execution so that no later round can quietly regress it while "fixing"
 * something else.
 *
 * The defect is a CALL GRAPH fact: a function reachable from a microphone event
 * could reach a speech-stopping call, so the avatar's own voice — arriving back
 * through the recogniser, or merely a routine Chrome `no-speech` error — ended
 * the avatar's own sentence.
 *
 * WHAT EACH SECTION ENUMERATES, AND WHO CHOSE THE POPULATION
 * ---------------------------------------------------------
 * S1  The four negation controls and three real-answer controls named in the
 *     owner/lens brief. CHOSEN BY THE BRIEF, not by this file's author. They are
 *     a regression DETECTOR for the filing path, not a target: they are required
 *     to pass identically before and after any change to this module.
 * S2  Every function reachable from a microphone-derived event, DERIVED by
 *     walking the call graph of the shipped bytes. Nobody chose it: the seeds are
 *     the function expressions installed on the event properties of a value that
 *     traces back to SpeechRecognition plus the analyser closures reading the mic
 *     stream, and the sinks are the functions whose text cancels synthesis,
 *     pauses the tts audio element, or invalidates the utterance sequence.
 *     Three earlier defects in this lane were hand-written populations that
 *     omitted what their author did not think of. There is no list here to omit
 *     from.
 * S3  The three microphone handlers on the interview recogniser, driven with the
 *     avatar's OWN words. Population = whatever S2's walk derived as a seed on
 *     the interview recogniser, so it cannot fall behind the code.
 * S4  Fifty consecutive silence-watchdog ticks against a sentence that never
 *     ends. Fifty is not a threshold to tune — the assertion is that the wait is
 *     UNCAPPED, so any N would do and a cap at any value fails.
 *
 * CONTROL: run with AVATAR_SRC_OVERRIDE pointed at the pre-fix bytes and S2, S3
 * and S4 must fail BY NAME (they name pvListen, kioskTurn and kioskFinish as
 * mic-reachable stops); S1 must still PASS, because the filing path was never
 * the defect.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const SRC_PATH = process.env.AVATAR_SRC_OVERRIDE || path.join(root, 'feat_mls_avatar.js');
const src = fs.readFileSync(SRC_PATH, 'utf8');

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg); pass++; }

/* ═══════════════════════════════════════════════════════════════════════════
   TOOLING: a masker, so nothing below ever mistakes a comment or a string for
   code, and a brace-matching lifter, so every slice is scoped to a FUNCTION
   rather than a byte window. A byte window is how five pins in this repo cried
   wolf, and one of those false alarms trained a real red to be dismissed.
   ═══════════════════════════════════════════════════════════════════════════ */
function maskLiterals(s) {
  const out = s.split('');
  let i = 0, prev = '';
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { let e = s.indexOf('\n', i); if (e < 0) e = s.length; blank(i, e); i = e; continue; }
    if (c === '/' && s[i + 1] === '*') { let e = s.indexOf('*/', i); e = e < 0 ? s.length : e + 2; blank(i, e); i = e; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < s.length) { if (s[j] === '\\') { j += 2; continue; } if (s[j] === c) break; j++; }
      blank(i, Math.min(j + 1, s.length)); i = Math.min(j + 1, s.length); prev = 'x'; continue;
    }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%~^<>'.includes(prev))) {
      let k = i + 1, inClass = false, closed = false;
      while (k < s.length) {
        const ch = s[k];
        if (ch === '\\') { k += 2; continue; }
        if (ch === '\n') break;
        if (inClass) { if (ch === ']') inClass = false; }
        else if (ch === '[') inClass = true;
        else if (ch === '/') { closed = true; break; }
        k++;
      }
      if (closed) { while (k + 1 < s.length && /[a-z]/.test(s[k + 1])) k++; blank(i, k + 1); i = k + 1; prev = 'x'; continue; }
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}
const masked = maskLiterals(src);

function matchPair(m, open, oc, cc) {
  let d = 0;
  for (let i = open; i < m.length; i++) {
    if (m[i] === oc) d++;
    else if (m[i] === cc) { d--; if (d === 0) return i; }
  }
  return -1;
}
/* the whole text of a named function, brace-matched */
function liftFn(name) {
  const at = masked.indexOf('function ' + name + '(');
  assert.ok(at >= 0, 'liftFn: ' + name + ' is gone from this module');
  const po = masked.indexOf('(', at);
  const pc = matchPair(masked, po, '(', ')');
  const bo = masked.indexOf('{', pc);
  const bc = matchPair(masked, bo, '{', '}');
  assert.ok(bc > bo, 'liftFn: could not brace-match ' + name);
  return src.slice(at, bc + 1);
}
/* the source range [startName, endName) — used for contiguous regions */
function liftRegion(startNeedle, endNeedle) {
  const a = masked.indexOf(startNeedle);
  const b = masked.indexOf(endNeedle, a + 1);
  assert.ok(a >= 0 && b > a, 'liftRegion: ' + startNeedle + ' .. ' + endNeedle + ' is gone');
  return src.slice(a, b);
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 1 — THE NEGATION CONTROLS, BYTE-EXACT
   ---------------------------------------------------------------------------
   These four sentences are the reason eight rounds are preserved as
   regressions. Round 7 refused all four as "overlap"; round 8 stripped the
   negation from any answer split by a pause. They are run through the SHIPPED
   recogniser handler (so a change to the echo filter at the source is seen) and
   then through the SHIPPED filing refusal, and what comes out must be the exact
   bytes that went in.
   ⚠️ THIS SECTION IS NOT A TARGET. It passes on the pre-fix bytes and it must
   pass identically afterwards. A red here means the fence is wrong, or the
   filing path has been touched — which this lane's brief forbids.
   ═══════════════════════════════════════════════════════════════════════════ */
{
  /* the question each answer is given to. Deliberately a question that CONTAINS
     the answer's own words, which is the hardest case for any echo filter and
     the shape that made rounds 7 and 8 delete real answers. */
  const NEGATIONS = [
    ['no pain in my left leg', 'do you have any pain in your left leg'],
    ['not the right one', 'is it the right one or the left one'],
    ['never on the left side', 'does it ever happen on the left side'],
    ['denies chest pain', 'have you had any chest pain'],
  ];
  /* the real-answer controls: a gate that refuses everything scores perfectly on
     negation while quietly deleting the interview */
  const REAL_ANSWERS = [
    ['in the morning', 'is it worse in the morning or in the evening'],
    ['the left one', 'is it the right one or the left one'],
    ['yes', 'have you taken anything for it'],
  ];

  /* THE SHIPPED CLASSIFIER, LIFTED VERBATIM. A reimplementation would test the
     copy, not the product. */
  const classifier = liftRegion('var PV_ECHO_TAIL_MS', 'function pvSpeakVoiced(');
  const cls = new Function('QUESTION', 'SPEAKING', `
    var pvSaying = SPEAKING ? QUESTION : '';
    var vgReady = false, vgLoudFrames = 0, vgLevel = 0, vgFloor = 0, vgWhy = '', vgSettings = null;
    var vgStream = null, vgCtx = null, vgNode = null, vgData = null, vgRaf = 0, vgFloorSamples = [], vgQuietFrames = 0;
    var VG_FRAME_MS = 40, VG_ONSET_FRAMES = 4, VG_MARGIN = 2.6;
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function isFn(f) { return typeof f === 'function'; }
    ${classifier}
    /* the AFTER regime: the question has ended, so it lives in the bounded echo
       tail exactly as pvSpeakVoiced's finish() put it there */
    if (!SPEAKING) pvEchoHold(QUESTION);
    return { isSelfEcho: pvIsSelfEcho, novel: pvNovelWordCount, norm: pvNorm,
             saying: function () { return pvSaying; } };
  `);

  /* THE SHIPPED PER-RESULT FILTER, as it runs inside pvListen. The filter moved
     INTO the recogniser handler deliberately (see avatar-listens-while-speaking):
     filtering only in the caller meant the avatar's words entered finalText and
     the whole answer was rejected with them. So the fence must drive the
     handler, not the caller. */
  const listenSrc = liftFn('pvListen');
  ok(/if \(piece && pvIsSelfEcho\(piece\)\) continue;/.test(listenSrc),
    'the per-result echo filter left pvListen — the avatar\'s own words can enter finalText again');

  /* THE SHIPPED FILING REFUSAL, lifted and executed. */
  const rStart = masked.indexOf('if (pvSaying && pvVoiceGateReady()', masked.indexOf('function kioskListen'));
  const rEnd = masked.indexOf('}', masked.indexOf('kiosk.echoRefused', rStart));
  assert.ok(rStart > 0 && rEnd > rStart, 'the filing refusal has no identifiable site in kioskListen');
  const refuseSrc = src.slice(rStart, rEnd + 1);

  const refuse = new Function('finalText', 'pvSaying', 'ready', 'presence', 'novelCount', `
    var kiosk = { echoRefused: 0 };
    var pvVoiceGateReady = function () { return ready; };
    var pvOtherVoiceNow = function () { return presence; };
    var pvNovelWordCount = function () { return novelCount; };
    var refused = false;
    ${refuseSrc.replace(/return;/, 'refused = true;')}
    return refused;
  `);

  /* drive the whole path: one final result carrying the answer, exactly as Chrome
     delivers a completed utterance, through the three shipped stages in order. */
  function fileAnswer(answer, question, speaking) {
    const c = cls(question, speaking);
    /* stage 1 — pvListen's per-result filter (the filter lives at the source) */
    let finalText = '';
    if (!(answer && c.isSelfEcho(answer))) finalText += answer;
    if (!finalText.trim()) return null;
    /* stage 2 — the caller's whole-answer self-echo guard */
    if (c.isSelfEcho(finalText)) return null;
    /* stage 3 — the shipped audio+novelty refusal, executed verbatim, in BOTH
       device states a real answer can arrive in: no echo cancellation available,
       and confirmed AEC with the patient audibly present. */
    const tpl = c.saying();
    const n = c.novel(tpl, finalText);
    if (refuse(finalText, tpl, false, false, n)) return null;
    if (refuse(finalText, tpl, true, true, n)) return null;
    return finalText;
  }

  /* ── THE ORDINARY CASE: the question has ended and the patient answers. Every
     one of the seven controls must arrive byte-exact. ─────────────────────── */
  NEGATIONS.concat(REAL_ANSWERS).forEach(([answer, question]) => {
    const filed = fileAnswer(answer, question, false);
    eq(filed, answer,
      'FILING REGRESSION — the answer "' + answer + '" to "' + question + '" was filed as ' +
      JSON.stringify(filed) + ' instead of byte-exact. This is the defect rounds 7 and 8 shipped: ' +
      'a negation or a short real answer deleted or truncated on the way to the chart. ' +
      'The filing path was CORRECT on live before this change set — if this is red, the change ' +
      'set touched it and must be reverted, not patched.');
  });

  /* ── AND THE HARD CASE: the four negations must survive even while the avatar
     is STILL SAYING the question, which is the aggressive regime and the one
     round 7 failed on all four ("refused as overlap") and round 8 truncated. ── */
  NEGATIONS.forEach(([answer, question]) => {
    const filed = fileAnswer(answer, question, true);
    eq(filed, answer,
      'FILING REGRESSION MID-QUESTION — "' + answer + '" (answered while the avatar was still ' +
      'saying "' + question + '") was filed as ' + JSON.stringify(filed) + '. A patient answering ' +
      'early, during the duplex window the mic deliberately opens WITH the question, had their ' +
      'negation deleted or stripped. Round 7 refused all four of these as "overlap"; round 8 ' +
      'stripped the negation from any answer split by a pause.');
  });

  /* ── THE TWO REGIMES ARE DELIBERATE, so pin them: while the speaker is active a
     contiguous quote of our own sentence IS our own voice, and after it stops the
     same words are far more likely to be the answer. A later round that collapses
     these into one rule breaks one direction or the other, measurably. ─────── */
  {
    const Q = 'is it worse in the morning or in the evening';
    eq(cls(Q, true).isSelfEcho('in the morning'), true,
      'the AGGRESSIVE regime is gone: while the avatar is still saying the question, a ' +
      'contiguous quote of it is no longer treated as its own voice — this is how the avatar ' +
      'came to interview itself and build the summary from its own questions');
    eq(cls(Q, false).isSelfEcho('in the morning'), false,
      'the AFTER regime is gone: once the question has ended, "in the morning" is the ANSWER to ' +
      '"is it worse in the morning or in the evening" and it is being deleted. This is the ' +
      'harm measured at 9 of 12 and 22 of 22 in earlier rounds.');
  }

  /* and the gate must not have become a universal accept, or the eleven controls
     above prove nothing */
  {
    const Q = 'is the pain in your back or in your neck';
    eq(refuse('is the pain in your', Q, true, false, 0), true,
      'A UNIVERSAL ACCEPT PROVES NOTHING: a pure self-echo arriving in a silent room on a device ' +
      'with confirmed echo cancellation is no longer refused, so every control above would pass ' +
      'even with the echo filter deleted');
    eq(cls(Q, true).isSelfEcho('is the pain in your back'), true,
      'the shipped classifier no longer recognises a contiguous quote of the question it is ' +
      'saying — the controls above would pass with no filter at all');
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 2 — THE DERIVED WALK
   ---------------------------------------------------------------------------
   Builds the call graph of the shipped bytes, derives the microphone-reachable
   closure, derives the speech-stopping sinks, and asserts that the set of
   mic-reachable edges into a named stop is EXACTLY the pinned set below.
   Every name in the pinned set carries the reason it is allowed to stay. Adding
   a new one is a failure, so the set cannot be widened silently — and removing
   the guard that makes one of them safe turns S3 or S4 red.
   ═══════════════════════════════════════════════════════════════════════════ */
function buildGraph(pass2Roots) {
  const nodes = [];
  const re = /\bfunction\b/g;
  let m;
  while ((m = re.exec(masked))) {
    let p = m.index + 8;
    while (p < masked.length && /\s/.test(masked[p])) p++;
    let name = '';
    const nm = /^[A-Za-z_$][\w$]*/.exec(masked.slice(p, p + 80));
    if (nm) { name = nm[0]; p += name.length; }
    while (p < masked.length && /\s/.test(masked[p])) p++;
    if (masked[p] !== '(') continue;
    const pc = matchPair(masked, p, '(', ')'); if (pc < 0) continue;
    const params = src.slice(p + 1, pc).split(',').map(s => s.trim()).filter(Boolean);
    let q = pc + 1;
    while (q < masked.length && /\s/.test(masked[q])) q++;
    if (masked[q] !== '{') continue;
    const bc = matchPair(masked, q, '{', '}'); if (bc < 0) continue;
    const before = masked.slice(Math.max(0, m.index - 90), m.index);
    const lbl = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*=\s*$/.exec(before);
    const dv = /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*$/.exec(before);
    nodes.push({
      id: nodes.length, name, params, label: lbl ? lbl[1].replace(/\s+/g, '') : '',
      declName: dv ? dv[1] : name, start: m.index, bodyStart: q, end: bc + 1,
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  nodes.forEach(a => {
    let best = null;
    nodes.forEach(b => { if (b !== a && b.start < a.start && a.end <= b.end && (!best || b.start > best.start)) best = b; });
    a.parent = best ? best.id : null;
    a.children = [];
  });
  nodes.forEach(a => { if (a.parent !== null) nodes[a.parent].children.push(a.id); });

  /* A function EXPRESSION installed on an event property, or handed to
     addEventListener, is not executed by the enclosing function — the event
     source executes it. Everything else nested (safe(), setTimeout(), .then())
     is reachable from the body that wrote it. */
  nodes.forEach(a => {
    a.isHandler = /\.on[a-z]+$/.test(a.label);
    if (!a.isHandler) {
      const pre = masked.slice(Math.max(0, a.start - 200), a.start);
      a.isHandler = /addEventListener\s*\(\s*$/.test(pre) || /addEventListener\s*\([^()]*,\s*$/.test(pre);
    }
    if (pass2Roots[a.start]) a.isHandler = true;
  });
  nodes.forEach(a => {
    const holes = [];
    (function collect(id) {
      nodes[id].children.forEach(c => { if (nodes[c].isHandler) holes.push([nodes[c].start, nodes[c].end]); else collect(c); });
    })(a.id);
    const t = masked.slice(a.bodyStart, a.end).split('');
    holes.forEach(h => { for (let k = h[0]; k < h[1]; k++) { const o = k - a.bodyStart; if (o >= 0 && o < t.length && t[o] !== '\n') t[o] = ' '; } });
    a.own = t.join(''); a.ownOffset = a.bodyStart;
    const it = masked.slice(a.bodyStart, a.end).split('');
    a.children.forEach(c => { for (let k = nodes[c].start; k < nodes[c].end; k++) { const o = k - a.bodyStart; if (o >= 0 && o < it.length && it[o] !== '\n') it[o] = ' '; } });
    a.immediate = it.join('');
  });

  const declCache = {};
  function declsOf(id) {
    const key = String(id);
    if (!declCache[key]) {
      const out = {};
      const kids = id === null ? nodes.filter(x => x.parent === null) : nodes[id].children.map(c => nodes[c]);
      kids.forEach(k => { if (k.declName) out[k.declName] = k.id; });
      declCache[key] = out;
    }
    return declCache[key];
  }
  function resolve(from, ident) {
    let cur = from;
    for (;;) {
      const d = declsOf(cur);
      if (Object.prototype.hasOwnProperty.call(d, ident)) return d[ident];
      if (cur === null) return null;
      cur = nodes[cur].parent;
    }
  }

  nodes.forEach(a => { a.out = {}; a.noEdge = {}; });
  const domRootStarts = {};
  const paramBind = {};
  const bind = (fnId, p, t) => {
    const k = fnId + ':' + p;
    if (!paramBind[k]) paramBind[k] = [];
    if (!paramBind[k].includes(t)) paramBind[k].push(t);
  };

  /* a NAMED function handed to addEventListener is a DOM root, not a callee */
  nodes.forEach(a => {
    const lr = /addEventListener\s*\(/g;
    let lm;
    while ((lm = lr.exec(a.own))) {
      const o = lm.index + lm[0].length - 1;
      const c = matchPair(a.own, o, '(', ')'); if (c < 0) continue;
      const parts = a.own.slice(o + 1, c).split(',');
      if (parts.length < 2) continue;
      const second = parts[1].trim();
      if (!/^[A-Za-z_$][\w$]*$/.test(second)) continue;
      const t = resolve(a.id, second);
      if (t !== null) a.noEdge[t] = true;
    }
  });

  nodes.forEach(a => {
    const ir = /[A-Za-z_$][\w$]*/g;
    let im;
    while ((im = ir.exec(a.own))) {
      if (a.own[im.index - 1] === '.') continue;
      const t = resolve(a.id, im[0]);
      if (t !== null && t !== a.id && !a.noEdge[t]) a.out[t] = true;
    }
    a.children.forEach(c => { if (!nodes[c].isHandler) a.out[c] = true; });
  });

  /* `safe(fn)` invokes fn in its OWN immediate body: the argument runs under the
     caller and the caller->argument edge already models it. Merging a global
     binding for such a parameter would make every function ever passed to safe
     reachable from every other — the whole file. `pvListen(onFinal, …)` invokes
     its callback only from a closure the MICROPHONE drives, and that binding is
     the edge this suite exists to follow. The discriminator is structural. */
  function syncTrampoline(fn, p) {
    const esc = p.replace(/\$/g, '\\$');
    const rx = new RegExp('(^|[^.\\w$])' + esc + '\\s*(\\(|\\.\\s*(call|apply)\\s*\\()');
    if (!rx.test(fn.immediate)) return false;
    return !fn.children.some(c => rx.test(nodes[c].own));
  }
  /* a closure handed to a builder that only wires it to an event is dispatched
     by the USER, not by the builder */
  function handlerOnly(fn, p) {
    const esc = p.replace(/\$/g, '\\$');
    const rx = new RegExp('(^|[^.\\w$])' + esc + '($|[^\\w$])');
    if (rx.test(fn.immediate)) return false;
    let inH = false, inPlain = false;
    (function scan(id, under) {
      nodes[id].children.forEach(c => {
        const h = under || nodes[c].isHandler;
        if (rx.test(nodes[c].immediate)) { if (h) inH = true; else inPlain = true; }
        scan(c, h);
      });
    })(fn.id, false);
    return inH && !inPlain;
  }
  function argSpans(text, offset, open) {
    const close = matchPair(text, open, '(', ')'); if (close < 0) return null;
    let d = 0, last = open + 1;
    const parts = [];
    for (let i = open + 1; i < close; i++) {
      const ch = text[i];
      if ('([{'.includes(ch)) d++;
      else if (')]}'.includes(ch)) d--;
      else if (ch === ',' && d === 0) { parts.push([last, i]); last = i + 1; }
    }
    parts.push([last, close]);
    return parts.map(p => [p[0] + offset, p[1] + offset]);
  }
  nodes.forEach(a => {
    const cr = /([A-Za-z_$][\w$]*)\s*\(/g;
    let cm;
    while ((cm = cr.exec(a.own))) {
      if (a.own[cm.index - 1] === '.') continue;
      const callee = resolve(a.id, cm[1]);
      if (callee === null) continue;
      const spans = argSpans(a.own, a.ownOffset, cm.index + cm[0].length - 1);
      if (!spans) continue;
      const cps = nodes[callee].params;
      spans.forEach((sp, idx) => {
        if (idx >= cps.length) return;
        if (syncTrampoline(nodes[callee], cps[idx])) return;
        const inline = nodes.filter(x => x.start >= sp[0] && x.end <= sp[1] + 1).sort((x, y) => x.start - y.start);
        if (inline.length) {
          bind(callee, cps[idx], inline[0].id);
          if (handlerOnly(nodes[callee], cps[idx])) { delete a.out[inline[0].id]; domRootStarts[inline[0].start] = true; }
          return;
        }
        const raw = src.slice(sp[0], sp[1]).trim();
        if (/^[A-Za-z_$][\w$]*$/.test(raw)) {
          const t = resolve(a.id, raw);
          if (t !== null) bind(callee, cps[idx], t);
        }
      });
    }
  });
  nodes.forEach(a => {
    a.params.forEach(p => {
      const k = a.id + ':' + p;
      if (!paramBind[k]) return;
      const rx = new RegExp('(^|[^.\\w$])' + p.replace(/\$/g, '\\$') + '($|[^\\w$])');
      (function walk(id) {
        if (rx.test(nodes[id].own)) paramBind[k].forEach(x => { nodes[id].out[x] = true; });
        nodes[id].children.forEach(walk);
      })(a.id);
    });
  });
  return { nodes, resolve, domRootStarts };
}
/* TWO PASSES: pass 1 discovers the DOM roots, pass 2 excludes them from their
   parent's text so a repaint does not appear to press the buttons it drew. */
const g = buildGraph(buildGraph({}).domRootStarts);
const N = g.nodes;
const nameOf = n => (n.name || n.label || ('anon@L' + n.line)) + ' @L' + n.line;

/* ── seeds: DERIVED, not listed ───────────────────────────────────────────── */
const recHolders = {};
{
  let changed = true, rounds = 0;
  while (changed && rounds++ < 8) {
    changed = false;
    const ar = /([A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*)\s*=\s*([^;\n]{0,160})/g;
    let am;
    while ((am = ar.exec(masked))) {
      const lhs = am[1].replace(/\s+/g, '');
      const rhs = am[2];
      const rhsSrc = src.slice(am.index + am[1].length, am.index + am[0].length);
      let isRec = /SpeechRecognition/.test(rhsSrc);
      if (!isRec) {
        const nw = /\bnew\s+([A-Za-z_$][\w$]*)\s*\(/.exec(rhs);
        if (nw && recHolders[nw[1]]) isRec = true;
        const pl = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(rhs);
        if (pl && recHolders[pl[1]]) isRec = true;
      }
      if (isRec && !recHolders[lhs]) { recHolders[lhs] = true; changed = true; }
    }
  }
}
ok(recHolders.rec && recHolders.pvRec,
  'the walk can no longer find the SpeechRecognition instances — every assertion below would ' +
  'pass vacuously. Derived holders: ' + Object.keys(recHolders).join(', '));

const seeds = {}, seedWhy = {};
N.forEach(n => {
  if (!n.isHandler) return;
  const base = n.label.replace(/\.on[a-z]+$/, '');
  if (recHolders[base]) { seeds[n.id] = true; seedWhy[n.id] = 'installed on ' + n.label; }
});
N.forEach(n => {
  if (!/createMediaStreamSource/.test(n.immediate)) return;
  n.children.forEach(c => { if (!seeds[c]) { seeds[c] = true; seedWhy[c] = 'analyser closure over the microphone stream'; } });
});
const seedIds = Object.keys(seeds).map(Number);
ok(seedIds.length >= 6,
  'the derived microphone seed set collapsed to ' + seedIds.length + ' functions (' +
  seedIds.map(i => nameOf(N[i])).join(', ') + '). Every reachability assertion below is only as ' +
  'strong as this set, so a collapse here is a silent pass and must fail loudly instead.');
/* every recogniser event property in the file must be represented, so a handler
   added later (onnomatch, onspeechend, onaudioend) cannot slip past the seeds */
{
  const props = new Set();
  const hr = /\b(?:rec|pvRec|ambRec)\s*\.\s*(on[a-z]+)\s*=/g;
  let hm;
  while ((hm = hr.exec(masked))) props.add(hm[1]);
  const covered = new Set(seedIds.map(i => (N[i].label.match(/\.(on[a-z]+)$/) || [])[1]).filter(Boolean));
  props.forEach(p => {
    ok(covered.has(p),
      'the recogniser event `' + p + '` is assigned in this module but the derived seed set does ' +
      'not contain it, so nothing below inspects what it can reach. This is exactly the ' +
      'hand-written-population failure this suite is built to avoid.');
  });
}

/* ── sinks: DERIVED from what the code does, not from a list of names ─────── */
const sinks = {}, sinkWhy = {};
N.forEach(n => {
  const r = [];
  if (/speechSynthesis\s*\.\s*cancel\s*\(/.test(n.own)) r.push('speechSynthesis.cancel()');
  if (/ttsAudio\w*\s*\.\s*pause\s*\(/.test(n.own)) r.push('tts audio pause()');
  if (/\bpvSpeakSeq\s*\+\+/.test(n.own)) r.push('pvSpeakSeq++ invalidates the utterance in flight');
  if (r.length) { sinks[n.id] = true; sinkWhy[n.id] = r.join(' + '); }
});
['pvStopVoice', 'pvStopSpeechOnly'].forEach(nm => {
  const node = N.filter(x => x.name === nm)[0];
  ok(node && sinks[node.id],
    nm + ' is no longer detected as a speech-stopping function. Either it was renamed (and this ' +
    'suite now guards nothing) or it stopped cancelling speech.');
});

/* ── the walk ─────────────────────────────────────────────────────────────── */
const seen = {};
{
  const q = seedIds.slice();
  q.forEach(i => { seen[i] = true; });
  while (q.length) {
    const cur = q.shift();
    Object.keys(N[cur].out).forEach(nx => { if (!seen[nx]) { seen[nx] = true; q.push(+nx); } });
  }
}
const reach = Object.keys(seen).map(Number);
ok(reach.length > 100,
  'the microphone-reachable closure is only ' + reach.length + ' functions — the walk has stopped ' +
  'following the call graph, so "no mic path reaches a stop" would be true by blindness');

/* THE PINNED SET. Each entry is a mic-reachable caller of a named stop that is
   allowed to remain, with the reason it is safe. A caller not on this list is a
   failure; that is what makes the set impossible to widen quietly. */
const ALLOWED = {
  /* the kiosk is being DISMANTLED — its DOM is removed and the mic light must go
     out, so audio has to stop. Reachable only through kioskStopBounded, which is
     itself behind the uncapped speech wait proven in S4. An existing pin
     (avatar-doctor-runtime) requires pvStopVoice to stay here. */
  kioskClose: 'teardown: the overlay is removed, so the voice must stop with it',
  /* the client giving up honestly after three failed finish turns. Behind the
     same uncapped wait: while pvSaying is set the watchdog never reaches it. */
  kioskStopBounded: 'bounded give-up, gated by the uncapped speech wait (S4)',
  /* the silence watchdog itself. Its three stop calls sit AFTER the uncapped
     `kiosk.heard || pvSaying` wait, so none of them is reachable while a
     sentence is in flight. S4 proves that by execution over 50 ticks. */
  kioskWatchdog: 'all three stops sit after the uncapped speech wait (S4)',
  /* ambient room mode. pvSpeakVoiced returns before starting any audio when
     kiosk.ambient is set, so there is provably never a sentence to cut here —
     asserted just below. */
  kioskAmbientStop: 'ambient mode is silent by construction (asserted below)',
};
/* the barge-in edge is pinned SEPARATELY because three existing assertions in
   avatar-listens-while-speaking and avatar-finishes-its-sentences require it to
   stay exactly where it is. It is the patient's voice interrupt, and it is
   evidence-gated so our own audio cannot forge it (see the novel-word rule). */
const ALLOWED_SPEECH_ONLY_CALLERS = 1;

{
  const offenders = [];
  ['pvStopVoice', 'pvStopSpeechOnly'].forEach(nm => {
    const t = N.filter(x => x.name === nm)[0];
    if (!t) return;
    reach.forEach(i => {
      if (!N[i].out[t.id]) return;
      const caller = N[i];
      if (nm === 'pvStopSpeechOnly') return;    /* counted separately below */
      if (ALLOWED[caller.name]) return;
      const rx = new RegExp('(^|[^.\\w$])' + nm + '\\s*\\(', 'g');
      const at = [];
      let cm;
      while ((cm = rx.exec(caller.immediate))) at.push(src.slice(0, caller.ownOffset + cm.index).split('\n').length);
      offenders.push(nameOf(caller) + ' -> ' + nm + (at.length ? ' at line(s) ' + at.join(', ') : ' (via a nested closure)'));
    });
  });
  eq(offenders.length, 0,
    'A MICROPHONE-DERIVED HANDLER CAN END THE AVATAR\'S SENTENCE.\n' +
    'The derived walk found ' + offenders.length + ' mic-reachable path(s) into a speech-stopping ' +
    'call that are not on the pinned safe list:\n    ' + offenders.join('\n    ') + '\n' +
    'Each one means the avatar\'s own voice, or a routine Chrome recogniser error, can cut off ' +
    'the sentence it is in the middle of saying. Sever the edge (route the caller at the ' +
    'microphone teardown instead of the voice teardown); do not add a condition, because a ' +
    'later round can invert a condition.');

  /* the barge-in edge, counted so it cannot multiply */
  const so = N.filter(x => x.name === 'pvStopSpeechOnly')[0];
  const callers = reach.filter(i => N[i].out[so.id]);
  eq(callers.length, ALLOWED_SPEECH_ONLY_CALLERS,
    'the patient\'s voice interrupt now has ' + callers.length + ' mic-reachable call sites (' +
    callers.map(i => nameOf(N[i])).join(', ') + '). With more than one, nothing can reason about ' +
    'what is able to cut a question off.');
}

/* the ambient claim in ALLOWED, asserted rather than asserted-about */
{
  const spoke = liftFn('pvSpeakVoiced');
  ok(/kiosk\.ambient\) \{ if \(then\) safe\(then\); return; \}/.test(spoke),
    'ambient room mode is no longer silent at the one place a voice can start, so ' +
    'kioskAmbientStop\'s presence on the pinned safe list is no longer justified — either ' +
    'restore the ambient guard in pvSpeakVoiced or sever kioskAmbientStop too');
}

/* the interrupt the patient can still use must be a VISIBLE CONTROL: an
   untrusted event cannot press a button, so our own audio cannot forge it */
{
  ok(/getElementById\('mlsAvKioskMute'\)|querySelector\('#mlsAvKioskMute'\)/.test(src),
    'the visible pause control #mlsAvKioskMute is gone — with the microphone no longer able to ' +
    'end speech, this button is the interrupt the patient is left with');
  const openSrc = liftFn('openKiosk');
  ok(/#mlsAvKioskMute'\)\.addEventListener\('click', kioskPauseToggle\)/.test(openSrc),
    'the pause button is no longer wired to kioskPauseToggle by a real click listener');
  const pause = liftFn('kioskPauseToggle');
  ok(/pvStopVoice\(\)/.test(pause),
    'the visible pause control no longer stops the voice — the patient has no interrupt left at all');
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 3 — EXECUTED: THE SENTENCE SURVIVES ITS OWN ECHO
   ---------------------------------------------------------------------------
   Lifts the real stop functions and the real pvListen, opens a recogniser, and
   drives every derived microphone handler with the avatar's OWN words while a
   sentence is in flight. Nothing may cancel synthesis, pause the audio element,
   or bump the utterance sequence.
   ═══════════════════════════════════════════════════════════════════════════ */
function speechHarness() {
  /* ONE contiguous region, so the stop functions are lifted exactly once. Lifting
     them a second time would leave a duplicate declaration in the harness, and a
     duplicate is how a harness comes to test the copy it happened to evaluate
     last rather than the shipped code. */
  const region = liftRegion('function pvVoiceUsable(v)', 'function pvSpeakVoiced(');
  const listen = liftFn('pvListen');
  const body = `
    var report = { cancels: 0, pauses: 0, faceStops: 0, filed: [] };
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function isFn(f) { return typeof f === 'function'; }
    var pvVoice, pvWantMale = null, pvHeld = [], pvRec = null, pvWatchdog = null;
    var pvSpeakSeq = 0;
    var ttsAudioNow = { onended: null, onerror: null, pause: function () { report.pauses++; } };
    function faceTalkStop() { report.faceStops++; }
    var window = {
      speechSynthesis: { cancel: function () { report.cancels++; }, getVoices: function () { return []; },
                         speak: function () {}, addEventListener: function () {} },
      SpeechRecognition: FakeRec, webkitSpeechRecognition: FakeRec,
      AudioContext: null, webkitAudioContext: null,
    };
    var vgStream = null, vgCtx = null, vgNode = null, vgData = null, vgRaf = 0;
    var vgReady = false, vgWhy = '', vgLevel = 0, vgFloor = 0;
    var vgFloorSamples = [], vgLoudFrames = 0, vgQuietFrames = 0, vgSettings = null;
    var VG_FRAME_MS = 40, VG_ONSET_FRAMES = 4, VG_MARGIN = 2.6, VG_SPEECH_FRAMES = 18;
    function requestAnimationFrame() { return 0; }
    function cancelAnimationFrame() {}
    var _timers = [];
    function setTimeout(fn, ms) { _timers.push({ fn: fn, ms: ms, dead: false }); return _timers.length; }
    function clearTimeout(h) { if (_timers[h - 1]) _timers[h - 1].dead = true; }
    ${region}
    ${listen}
    return {
      report: report,
      say: function (t) { pvSaying = pvNorm(t); },
      hold: function (t) { pvEchoHold(pvNorm(t)); },
      saying: function () { return pvSaying; },
      seq: function () { return pvSpeakSeq; },
      listen: function (onFinal, onInterim, onDead) { return pvListen(onFinal, onInterim, onDead); },
      rec: function () { return pvRec; },
      fire: function () { _timers.forEach(function (t) { if (!t.dead) { t.dead = true; t.fn(); } }); },
      /* ZERO THE INSTRUMENTS AFTER THE MICROPHONE IS ALREADY OPEN, so every stop
         counted afterwards is provably caused by a microphone event and not by
         the harness setting the scene. */
      reset: function () { report.cancels = 0; report.pauses = 0; report.faceStops = 0; pvSpeakSeq = 0; },
      stopMicPresent: typeof pvStopMic === 'function',
    };
  `;
  /* a recogniser that records the teardown instead of performing it */
  function FakeRec() { this.onresult = null; this.onerror = null; this.onend = null; }
  FakeRec.prototype.start = function () { this.started = true; };
  FakeRec.prototype.stop = function () { this.stopped = true; };
  return new Function('FakeRec', body)(FakeRec);
}
{
  /* the harness can only OBSERVE a stop if the stop functions are inside the
     lifted region — checked once, here, rather than on every construction */
  ok(/function pvStopVoice\(\)/.test(liftRegion('function pvVoiceUsable(v)', 'function pvSpeakVoiced(')) &&
     /function pvStopSpeechOnly\(\)/.test(liftRegion('function pvVoiceUsable(v)', 'function pvSpeakVoiced(')),
    'the speech-stop functions are no longer inside the region S3 lifts, so S3 would drive a ' +
    'recogniser with no way to observe a stop at all — a silent pass');
  const h = speechHarness();
  ok(h.stopMicPresent,
    'pvStopMic does not exist in this module, so every microphone re-open still runs the full ' +
    'voice teardown: the avatar cannot finish a sentence while the microphone is open. This is ' +
    'the pre-fix state.');

  /* the sentence in flight, and the microphone already open on it — the duplex
     state the kiosk is in for most of every turn */
  const SENTENCE = 'Is the pain in your back, or in your neck?';
  const filed = [];
  h.say(SENTENCE);
  /* onDead re-opens the microphone, which is what kioskListen's dead-path
     callback does (a 400ms timer, then kioskListen -> pvListen). Modelled here
     because the recogniser handler cannot re-open itself. */
  const reopen = () => h.listen(v => filed.push(v), () => {}, reopen);
  const opened = reopen();
  ok(opened, 'the harness could not open a recogniser — S3 would pass vacuously');
  eq(h.saying().length > 0, true, 'the harness lost the sentence in flight before driving anything');
  h.reset();

  /* THE MICROPHONE DELIVERS THE AVATAR'S OWN WORDS. Interims first, exactly as
     Chrome streams them, then the final. */
  const echoPieces = ['is the pain', 'is the pain in your', 'is the pain in your back or in your neck'];
  echoPieces.forEach((p, i) => {
    h.rec().onresult({
      resultIndex: 0,
      results: [{ 0: { transcript: p }, isFinal: i === echoPieces.length - 1 }],
    });
  });
  /* and the two lifecycle events Chrome fires constantly on a network-backed
     recogniser: a `no-speech` error and a spontaneous end. Both go through the
     caller's onDead, which re-opens the microphone. */
  h.rec().onerror({ error: 'no-speech' });
  h.rec().onend();
  h.fire();

  const r = h.report;
  eq(r.cancels, 0,
    'THE MICROPHONE CANCELLED SPEECH SYNTHESIS ' + r.cancels + ' time(s) while the avatar was ' +
    'mid-sentence, driven by nothing but the avatar\'s own words and Chrome\'s ordinary ' +
    'recogniser lifecycle. This is the owner\'s report: "it litterly never gets out everyhting ' +
    'it wants to say caosue it picks up its own talking."');
  eq(r.pauses, 0,
    'THE MICROPHONE PAUSED THE AVATAR\'S AUDIO ELEMENT ' + r.pauses + ' time(s) while it was ' +
    'still speaking — the sentence is cut off mid-word by its own echo');
  eq(r.faceStops, 0,
    'the microphone stopped the talking face ' + r.faceStops + ' time(s) mid-sentence, so the ' +
    'avatar visibly freezes while its own voice is still playing');
  eq(h.saying().length > 0, true,
    'the echo template pvSaying was CLEARED by a microphone event while the sentence was still ' +
    'playing. That is worse than a cut: the filing path loses the template it needs, and the ' +
    'question\'s own words become fileable as the patient\'s answer.');
  eq(filed.length, 0,
    'the avatar\'s own sentence was filed as the patient\'s answer (' + JSON.stringify(filed) + ')');
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 3b — THE NEGATION CONTROLS THROUGH THE REAL RECOGNISER HANDLER
   ---------------------------------------------------------------------------
   Section 1 executes the classifier and the filing refusal, but it re-states one
   line of pvListen's per-result loop rather than running it. That is exactly the
   gap that lets a suite go green over a live defect, so the four controls are
   driven a second time through the SHIPPED rec.onresult — the real accumulation
   into finalText, the real quiet timer, the real submit — and what reaches
   onFinal must be the same bytes Chrome delivered.
   Population: the same four negation sentences from the brief, in both regimes
   (mid-question and after the question ends).
   ═══════════════════════════════════════════════════════════════════════════ */
{
  const CASES = [
    ['no pain in my left leg', 'do you have any pain in your left leg'],
    ['not the right one', 'is it the right one or the left one'],
    ['never on the left side', 'does it ever happen on the left side'],
    ['denies chest pain', 'have you had any chest pain'],
  ];
  [true, false].forEach(speaking => {
    CASES.forEach(([answer, question]) => {
      const h = speechHarness();
      if (speaking) h.say(question); else { h.say(''); h.hold(question); }
      const got = [];
      ok(h.listen(v => got.push(v), () => {}, () => {}), 'the harness could not open a recogniser');
      /* Chrome delivers a completed utterance as one final result */
      h.rec().onresult({ resultIndex: 0, results: [{ 0: { transcript: answer }, isFinal: true }] });
      h.fire();   /* the 1.3s quiet timer submits */
      eq(got.join('|'), answer,
        'FILING REGRESSION THROUGH THE REAL HANDLER — "' + answer + '" ' +
        (speaking ? 'answered while the avatar was still saying' : 'answered just after') +
        ' "' + question + '" reached the caller as ' + JSON.stringify(got) + ' instead of the ' +
        'exact bytes. This is the path that actually files the patient\'s answer to the chart.');
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   SECTION 4 — EXECUTED: THE SILENCE FENCE HAS NO CAP
   ---------------------------------------------------------------------------
   Fifty consecutive watchdog ticks against a sentence that never ends. The
   assertion is that the wait is uncapped: no tick may stop the voice, start a
   turn, nudge over the question, or fall through to the bounded stop.
   ═══════════════════════════════════════════════════════════════════════════ */
{
  const arm = liftFn('kioskArmWatchdog');
  const dog = liftFn('kioskWatchdog');
  const TICKS = 50;
  const h = new Function(`
    var report = { stops: 0, turns: 0, bounded: 0, spoke: 0, rearms: 0, listens: 0 };
    var pvSaying = 'is the pain in your back or in your neck';
    var NUDGE_LINE = 'take your time';
    var kiosk = { open: true, busy: false, completed: false, ambient: false, mic: true,
                  heard: false, silent: 0, finishTries: 0, nudgedFor: null, lastSay: 'a question',
                  nudgeTimer: null };
    function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
    function clearTimeout() {}
    function setTimeout(fn) { report.rearms++; return 1; }
    function pvStopVoice() { report.stops++; }
    function pvStopMic() {}
    function kioskTurn() { report.turns++; }
    function kioskStopBounded() { report.bounded++; }
    function kioskMood() {}
    function kioskListen() { report.listens++; }
    function pvSpeakShaped() { report.spoke++; }
    ${arm}
    ${dog}
    return { report: report, tick: kioskWatchdog,
             endSentence: function () { pvSaying = ''; } };
  `)();

  for (let i = 0; i < TICKS; i++) h.tick();
  const r = h.report;
  eq(r.stops, 0,
    'THE SILENCE WATCHDOG CUT THE SENTENCE ' + r.stops + ' time(s) in ' + TICKS + ' ticks while ' +
    'the avatar was still speaking. The wait is CAPPED: after three windows it falls through to ' +
    'pvStopVoice and the avatar is cut off mid-word by its own silence clock. A sentence in ' +
    'flight must be waited for with no cap, exactly as `kiosk.heard` already is.');
  eq(r.turns, 0,
    'the watchdog started ' + r.turns + ' turn(s) while the avatar was still speaking — the ' +
    'auto-finish fires over the question it has not finished asking');
  eq(r.bounded, 0,
    'the watchdog fell through to the bounded stop ' + r.bounded + ' time(s) while the avatar ' +
    'was still speaking — the interview gives up mid-sentence');
  eq(r.spoke, 0,
    'the watchdog spoke the silence nudge ' + r.spoke + ' time(s) OVER the question still ' +
    'playing. Two voices at once is the same defect as a cut: pvSpeakShaped bumps pvSpeakSeq ' +
    'and the question dies.');
  eq(r.rearms, TICKS,
    'the watchdog re-armed ' + r.rearms + ' times in ' + TICKS + ' ticks — a tick that neither ' +
    'acts nor re-arms has silently disarmed the only timer that can revive the question');

  /* AND IT MUST STILL BE ABLE TO ACT once the sentence actually ends, or the
     fix above is a feature deletion dressed as a fix — the same mistake round 7
     made when it refused all four negation controls as "overlap". */
  h.endSentence();
  h.tick(); h.tick(); h.tick();
  const r2 = h.report;
  ok(r2.spoke + r2.turns + r2.stops > 0,
    'with the sentence finished, three silent windows produced no nudge, no turn and no stop: ' +
    'the self-end watchdog has been disabled outright, so an abandoned interview never ends and ' +
    'never produces a summary');

  /* ── WHAT THE UNCAPPED WAIT DEPENDS ON ────────────────────────────────────
     An uncapped wait on `pvSaying` is only safe because pvSaying is guaranteed
     to clear. If a speak route could ever leave it set, the interview would wait
     for ever and never produce a summary — the wedge this suite must not create.
     So pin the guarantee itself, at every route out: the empty-text path, the
     fetch guard, the browser-speech path and the audio-element path each end at
     the one `finish` that clears it. */
  {
    const spoke = liftFn('pvSpeakVoiced');
    ok(/function finish\(\)[\s\S]{0,400}pvEchoHold\(pvSaying\);\s*\n\s*pvSaying = '';/.test(spoke),
      'pvSpeakVoiced\'s finish() no longer clears pvSaying. The silence watchdog now waits on ' +
      'pvSaying with no cap, so a template that is never cleared wedges the interview for ever: ' +
      'no nudge, no self-end, no summary.');
    ok(/if \(!t\.trim\(\)\) \{ finish\(\); return; \}/.test(spoke),
      'the empty-text path no longer completes, so pvSaying can be left set by a blank turn');
    ok(/pvWatchdog = setTimeout\(function \(\)/.test(spoke),
      'pvSpeakVoiced lost its fetch guard — a hung TTS request would leave pvSaying set for ever');
    const synth = liftFn('pvSpeakSynth');
    ok(/pvWatchdog = setTimeout\(finish,/.test(synth),
      'the browser-speech path lost its watchdog: speech that never fires onend leaves pvSaying set');
    const play = liftFn('ttsPlayUrl');
    ok(/a\.onended = finish; a\.onerror = finish;/.test(play) &&
       /pvWatchdog = setTimeout\(finish,/.test(play) &&
       /p\.catch\(function \(\) \{ finish\(\); \}\)/.test(play),
      'the audio-element path lost one of its three completion routes (ended/error, the ' +
      'duration watchdog, or the rejected play() promise). pvSaying would survive the sentence ' +
      'and the uncapped silence wait would never end the interview.');
  }
}

console.log('mic-cannot-end-the-avatars-sentence: ' + pass + ' assertions passed (' + path.basename(SRC_PATH) + ')');
