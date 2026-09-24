'use strict';
/* THE /api/templates/split CONTRACT, FOR THE SITE'S TESTS (tplsort-1.3.0,
   2026-09-24).

   The browser never cuts a template. It sends one whole file or one whole
   paste; the server numbers its lines, the model answers the line each
   template STARTS on (plus goes / why / name / insurance - never text), and
   the server cuts the document itself. This is that server, line for line,
   so the site's tests answer exactly what the backend answers:
   backend src/routes/templateSplit.js - templateSplitDocument,
   parseTemplateSplit, cutTemplateSplit, wholeDocument and the route's
   too-long refusal. The backend's own tests/template-split-route.test.js
   pins the same behaviour against the real route.

   A test scripts only the MODEL: model(doc, lines) -> the model's JSON (an
   object, or a raw string). respond(text, model) -> { status, body }.
   startsOf(doc, pieces) turns pieces of the document (each one's text, or
   its first line) into the start lines a correct model would name. */

const MAX_INPUT = 40000;
const MAX_TEMPLATES = 30;
const MAX_COVER = 1500;
const TITLE_BLOCK_LINES = 6;
const GOES = ['visit', 'hpi', 'ros', 'exam', 'assessment', 'plan', 'op', 'letter', 'unsure'];

function doc(value) {
  return String(value == null ? '' : value)
    .replace(/\r\n?/g, '\n')
    .replace(/^(?:[ \t\f\v]*\n)+/, '')
    .trimEnd();
}
const blankLine = (line) => !String(line).trim();
const RULE_LINE = /^(?:[-=*_~#.•·–—]\s*){3,}$/;
const ruleLine = (line) => RULE_LINE.test(String(line).trim());
const nonSpaceLength = (s) => String(s || '').replace(/\s+/g, '').length;
function cleanLine(value, max) {
  let text = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > max) {
    const cut = text.slice(0, max - 1);
    const sp = cut.lastIndexOf(' ');
    text = (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '') + '…';
  }
  return text;
}
function lineNumber(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? v : NaN;
  if (typeof v === 'string' && /^\s*\d{1,7}\s*$/.test(v)) return Number(v);
  return NaN;
}
function parse(raw) {
  const text = String(raw == null ? '' : raw).trim().replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch (e) {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch (e2) { parsed = null; } }
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.templates)) return null;
  return {
    templates: parsed.templates.map((t) => {
      const item = (t && typeof t === 'object' && !Array.isArray(t)) ? t : {};
      const g = typeof item.goes === 'string' ? item.goes.trim().toLowerCase() : '';
      const goes = GOES.includes(g) ? g : 'unsure';
      return { start: lineNumber(item.start), name: cleanLine(item.name, 120), goes, why: cleanLine(item.why, 140),
        insurance: goes === 'letter' && (item.insurance === true || item.insurance === 'true') };
    })
  };
}
function whole(d, reason) {
  return { templates: [{ start: 1, name: '', text: String(d), goes: 'unsure', why: '', insurance: false }], splitRefused: reason };
}
function sliceLines(lines, a, b) {
  while (a < b && blankLine(lines[a])) a++;
  while (b > a && blankLine(lines[b - 1])) b--;
  if (a >= b) return null;
  return { from: a + 1, text: lines.slice(a, b).join('\n') };
}
function cut(d, templates) {
  const lines = String(d).split('\n');
  const n = lines.length;
  const list = Array.isArray(templates) ? templates : [];
  if (!list.length) return { refused: 'bad-answer' };
  if (list.length > MAX_TEMPLATES) return { refused: 'too-many' };
  const starts = list.map((t) => lineNumber(t && t.start));
  for (let k = 0; k < starts.length; k++) {
    const s = starts[k];
    if (!Number.isInteger(s) || s < 1 || s > n) return { refused: 'bad-answer' };
    if (k > 0 && s <= starts[k - 1]) return { refused: 'bad-answer' };
  }
  let cover = '', unsureFirst = false;
  const first = starts[0] - 1;
  const before = sliceLines(lines, 0, first);
  if (before) {
    let f = first;
    while (f < n && blankLine(lines[f])) f++;
    const apart = f > 0 && (blankLine(lines[f - 1]) || ruleLine(lines[f - 1]));
    const size = nonSpaceLength(before.text), total = nonSpaceLength(d);
    const small = size <= MAX_COVER && size * 3 < total;
    const words = /[\p{L}\p{N}]/u.test(before.text);
    const headed = before.text.split('\n').some((l) => /:\s*$/.test(l));
    if (words && apart && small && !headed) cover = before.text;
    else {
      starts[0] = 1;
      const heldLines = before.text.split('\n').filter((l) => !blankLine(l)).length;
      if (words && (apart || heldLines > TITLE_BLOCK_LINES || size > MAX_COVER)) unsureFirst = true;
    }
  }
  const out = [];
  for (let k = 0; k < starts.length; k++) {
    const a = starts[k] - 1;
    const b = k + 1 < starts.length ? starts[k + 1] - 1 : n;
    const piece = sliceLines(lines, a, b);
    if (!piece) return { refused: 'bad-answer' };
    const t = (k === 0 && unsureFirst) ? { goes: 'unsure' } : (list[k] || {});
    out.push({ start: piece.from, name: t.name || '', text: piece.text, goes: t.goes || 'unsure', why: t.why || '', insurance: !!t.insurance });
  }
  return { templates: out, cover };
}
/* The route: one whole text in, the server's answer out. */
function respond(text, model) {
  const d = doc(text);
  if (!d.trim()) return { status: 400, body: { error: 'No template text provided.' } };
  if (d.length > MAX_INPUT) return { status: 200, body: Object.assign({ ok: true }, whole(d, 'too-long')) };
  const lines = d.split('\n');
  const answer = model ? model(d, lines) : { templates: [{ start: 1, goes: 'unsure', why: '' }] };
  const parsed = parse(typeof answer === 'string' ? answer : JSON.stringify(answer));
  const c = parsed ? cut(d, parsed.templates) : { refused: 'bad-answer' };
  if (c.refused) return { status: 200, body: Object.assign({ ok: true }, whole(d, c.refused)) };
  return { status: 200, body: Object.assign({ ok: true, templates: c.templates }, c.cover ? { cover: c.cover } : {}) };
}
/* The start line (1-based) of each piece, in order: a piece is its text (its
   first non-blank line is looked for) or { first: '<first line>' }. Every
   piece must be found, after the one before it. */
function startsOf(d, pieces) {
  const lines = doc(d).split('\n');
  let from = 0;
  return pieces.map((p) => {
    const first = String((p && p.first) || String((p && p.text) || '').split('\n').find((l) => l.trim()) || '').trim();
    let at = -1;
    for (let i = from; i < lines.length; i++) if (lines[i].trim() === first) { at = i; break; }
    if (at < 0) throw new Error('template-split fixture: the piece starting "' + first.slice(0, 60) + '" is not in the document');
    from = at + 1;
    return at + 1;
  });
}
/* A correct model's answer for these pieces: each one's start line, and the
   goes / why / name / insurance it was given. */
function modelFor(pieces) {
  return (d) => {
    const starts = startsOf(d, pieces);
    return { templates: pieces.map((p, k) => ({ start: starts[k], name: p.name || '', goes: p.goes || 'unsure', why: p.why || '', insurance: !!p.insurance })) };
  };
}

module.exports = { MAX_INPUT, MAX_TEMPLATES, doc, parse, cut, whole, respond, startsOf, modelFor };
