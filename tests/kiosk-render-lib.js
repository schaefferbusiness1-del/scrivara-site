'use strict';
/*
 * THE SHIPPED KIOSK, RENDERED. Nothing here is hand-written markup or hand-written CSS: both
 * are LIFTED OUT OF THE MODULE, because the last three attempts at this defect were reasoned
 * about rather than rendered, and one of them shipped a "one owner" arbitrator for an overlap
 * that is between two DIFFERENT ELEMENTS.
 *   - the stylesheet comes from kioskStyle() by executing it against a fake document and
 *     capturing what it puts on the <style> node
 *   - the markup comes from openKiosk's `root.innerHTML = ...` expression, evaluated verbatim
 * So if either drifts, this harness renders the drift.
 */
const fs = require('fs');
const path = require('path');

function readSource(override) {
  const root = path.resolve(__dirname, '..');
  return fs.readFileSync(override || process.env.AVATAR_SRC_OVERRIDE || path.join(root, 'feat_mls_avatar.js'), 'utf8');
}

/* the stylesheet, exactly as the module installs it */
function liftKioskCss(src) {
  const at = src.indexOf('function kioskStyle()');
  if (at < 0) throw new Error('kioskStyle is gone');
  const end = src.indexOf('\n  }', src.indexOf('appendChild(st)', at));
  const body = src.slice(at, end + 4);
  let captured = '';
  const fn = new Function('capture', `
    var gid = function () { return null; };
    var document = {
      createElement: function () { return { set textContent(v) { capture(v); }, get textContent() { return ''; } }; },
      head: { appendChild: function () {} }, documentElement: { appendChild: function () {} }
    };
    ${body}
    kioskStyle();
  `);
  fn((v) => { captured = v; });
  if (!captured || captured.length < 500) throw new Error('the kiosk stylesheet did not lift');
  return captured;
}

/* the markup, exactly as openKiosk builds it */
function liftKioskHtml(src) {
  const at = src.indexOf('    root.innerHTML =');
  if (at < 0) throw new Error('the kiosk markup template is gone');
  /* the expression ends at the first line that closes it with `;` at column 6+ */
  const lines = src.slice(at).split('\n');
  const out = [];
  for (const ln of lines) {
    out.push(ln);
    if (/';\s*$/.test(ln) || /'\s*;\s*$/.test(ln)) break;
  }
  const expr = out.join('\n').replace('    root.innerHTML =', 'return (') .replace(/;\s*$/, ');');
  const recAt = src.indexOf("var AMBIENT_REC_TEXT = ");
  const recTxt = /var AMBIENT_REC_TEXT = '([^']*)'/.exec(src.slice(recAt, recAt + 400));
  if (!recTxt) throw new Error('AMBIENT_REC_TEXT is gone');
  const html = new Function('AMBIENT_REC_TEXT', expr)(recTxt[1]);
  if (!html || html.indexOf('mlsAvKioskInterim') < 0) throw new Error('the lifted markup has no interim line');
  return html;
}

function page(src) {
  return '<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}' +
    'html,body{height:100%;font-family:system-ui}</style><style>' + liftKioskCss(src) + '</style>' +
    '<div id="host"></div><script>document.getElementById("host").outerHTML=' +
    JSON.stringify('<div id="mlsAvKiosk">' + liftKioskHtml(src).replace(/^\s*/, '') + '</div>') + ';<\/script>';
}

/* ── THE STATES A CHECK-IN ACTUALLY PASSES THROUGH ────────────────────────────────────────
   Every one of these is derived from a real call site: the say text is what kioskSetSay is
   handed, the interim text is what kioskLine('transcript'|'hint'|'alert'|'status') is handed,
   and the root class is what kioskMood/kioskRestShow put there. */
const OPEN_Q = 'Thanks for that. Can you describe the pain for me — where it is, what it feels like, and whether anything makes it better or worse?';
const RAMBLE = 'well it started maybe three weeks ago after i moved some boxes in the garage and at first i thought it was just a pulled muscle but then it started going down my leg and now it wakes me up at night and my wife says i have been limping which i did not even notice myself until she said it';
const STATES = [
  { id: 'A', label: 'emptiest possible screen', cls: '', say: 'Getting ready…', interim: '', progress: '' },
  { id: 'B', label: 'first question, mic listening', cls: 'listening',
    say: 'Hello, I am Ava. I am going to ask you a few short questions before the doctor comes in.',
    interim: '', progress: 'Question 1 of 8' },
  { id: 'C', label: 'long open question while speaking', cls: 'speaking', say: OPEN_Q, interim: '', progress: 'Question 3 of 8' },
  { id: 'D', label: 'ordinary answer being transcribed', cls: 'listening',
    say: 'Is the pain in your back, or in your neck?', interim: 'its more in my lower back on the right side',
    progress: 'Question 4 of 8' },
  { id: 'E', label: 'rambling answer being transcribed', cls: 'listening', say: OPEN_Q, interim: RAMBLE, progress: 'Question 4 of 8' },
  { id: 'F', label: 'staff alert over a long question', cls: 'listening', say: OPEN_Q,
    interim: 'Staff: nothing is being recorded. Allow the microphone for this site.', progress: 'Question 2 of 8' },
  { id: 'G', label: 'typed mode with the hint', cls: 'typed', say: OPEN_Q,
    interim: 'The microphone is off on this screen — type your answer below.', progress: 'Question 2 of 8', typeRow: true },
  { id: 'H', label: 'room capture, recording banner + long transcript', cls: 'ambient',
    say: 'I am listening to the visit and taking notes for the doctor.', interim: RAMBLE, progress: '' },
  /* ⚠️ `resting` IS PART OF THIS STATE NOW. kioskRestShow is the single writer of both the row's
     inline display and the root class (kioskRestReserve), so a rendered state that shows the row
     without the class is a state the module cannot produce - and it would render the wrong layout. */
  { id: 'I', label: 'finished, resting with the hand-off button', cls: 'resting',
    say: 'All set — thank you. Your doctor will be in with you soon.',
    interim: 'Please hand the screen back to the team. Staff: the button below starts listening to the visit; “End interview” leaves.',
    progress: '', rest: true },
  { id: 'J', label: 'worst case: long question, long transcript, listening pill', cls: 'listening speaking',
    say: OPEN_Q, interim: RAMBLE, progress: 'Question 6 of 8' },
  /* ── THE STATES THE OLD HARNESS COULD NOT SEE ─────────────────────────────────────────────
     #mlsAvKioskOrders is an OPAQUE white card at right:16px;bottom:16px, up to 52vh tall, z-index
     6 — painted exactly over the live transcript and the progress line. It was in neither the
     state list nor the measured id list, which is why it survived two rounds of "fix the
     overlapping text". Its markup here mirrors ordersRender's: the same class names, one
     medication action and one proposed order, which is what a real room capture produces. */
  { id: 'K', label: 'room capture with the proposed-actions panel open', cls: 'ambient hasorders',
    say: 'I am listening to the visit and taking notes for the doctor.', interim: RAMBLE, progress: '',
    orders: 2 },
  { id: 'L', label: 'check-in still running with a full actions panel', cls: 'listening hasorders',
    say: OPEN_Q, interim: RAMBLE, progress: 'Question 7 of 8', orders: 4 },
  /* ── THE FOUR STATES THE STYLESHEET STYLED AND NOTHING RENDERED ───────────────────────────────
     Found by asking the stylesheet which root classes it styles and comparing that against this
     list (see the audit in avatar-kiosk-text-is-never-covered.test.js). `caring`, `paused`,
     `saving` and `thinking` were all styled and none of them had ever been rendered or measured —
     the same shape of gap that let an opaque card sit on the patient's words for two rounds. Each
     one below is taken from its real call site. */
  { id: 'M', label: 'between turns: thinking, while the answer is with the server', cls: 'thinking',
    say: OPEN_Q, interim: '', progress: 'Question 5 of 8' },
  { id: 'N', label: 'room capture PAUSED by staff', cls: 'ambient paused',
    say: 'I am listening to the visit and taking notes for the doctor.', interim: RAMBLE, progress: '' },
  { id: 'O', label: 'End visit & review: saving the capture', cls: 'ambient saving',
    say: 'Saving the visit…',
    interim: 'Finishing the recording and writing it to the transcript…', progress: '' },
  /* kioskMood adds `caring` when the line reads as a red flag — the longest and most important
     sentence the avatar ever says, and the one that must never be clipped or covered */
  { id: 'P', label: 'an emergency warning, spoken with the caring face', cls: 'speaking caring',
    say: 'That can be serious, and I do not want you to wait. Please tell the front desk right now, ' +
      'or call 911 if the chest pain gets worse or you feel faint — they will get you seen straight away.',
    interim: 'Staff: the patient reported chest pain and shortness of breath.', progress: 'Question 6 of 8' },
  /* ══ THE COMBINATIONS NOBODY HAD PAIRED — AND WHY THE DETECTOR WAS BLIND (av-6.3.2, defect 3) ══
     ⛔ THE DETECTOR WAS NEVER BROKEN. Measured, before changing a line of it: at 375x812 / 414x896 /
     360x740 / 720x1280 / 320x568 / 721x800, in states K and L, every one of the 49 sampled points
     inside every text box came back as the box itself or an ancestor — 0 occluders — and the control
     script proves the same detector DOES catch the card at those exact viewports (variants B8, B8b,
     B8d, B8e all fail by name on "COVERED"). So the blindness was the STATE POPULATION, on a third
     axis nobody had audited:
       · round 1 of this defect: the measured id list was hand-written and omitted the offender;
       · round 2: the viewport list was hand-written and could not match the narrow media query;
       · round 3 (this one): the STATE list is hand-written and never PAIRED the proposed-actions
         sheet with either of the two other rows the module toggles with an INLINE `display` -
         #mlsAvKioskRest (the hand-off note and button) and #mlsAvKioskTypeRow (the typed answer
         row). The suite audited the root CLASSES against the stylesheet (rootStateClasses) and
         nothing at all audited the inline rows, because a stylesheet cannot see an inline style.
     MEASURED the moment they were paired: #mlsAvKioskRestNote covered by the opaque sheet at 25 of
     25 sampled points (375x812, 414x896, 360x740, 320x568), 10 of 25 at 720x1280, and pushed clean
     off the bottom of the screen at 721x800; #mlsAvKioskSend covered at 10-25 of 25 at every narrow
     size AND at 1024x768, 800x600 and 721x800 - the desktop side too, because #mlsAvKioskTypeRow is
     the one child of the column with a HARD width and it ignored the reserved gutter.
     WHO CHOSE THESE STATES: the module did. inlineDisplayRows() below derives the three rows from
     the source, ROW_PAIRS declares every combination of them the module can actually reach WITH the
     call site that reaches it, and the suite asserts (a) every derived row appears in ROW_PAIRS and
     (b) every pair declared unreachable really is - by finding, in the function that shows one, the
     statement that hides the other. A row added to the module fails this suite until it is paired. */
  { id: 'Q', label: 'ROOM CAPTURE FILED: the sheet open and the hand-off row up (kioskAmbientStop -> ordersRender + kioskRestShow)',
    cls: 'resting hasorders', say: 'All set — thank you. Your doctor will be in with you soon.',
    interim: 'Please hand the screen back to the team. Staff: the button below starts listening to the visit; “End interview” leaves.',
    progress: '', orders: 3, rest: true },
  { id: 'Q2', label: 'the same, with a full sheet and a rambling staff line',
    cls: 'resting hasorders', say: 'All set — thank you. Your doctor will be in with you soon.',
    interim: RAMBLE, progress: '', orders: 4, rest: true },
  { id: 'R', label: 'MIC FAILED MID-VISIT: the sheet open and the typed row up (kioskListen mic===false -> typeRow flex)',
    cls: 'listening typed hasorders', say: OPEN_Q,
    interim: 'The microphone is off on this screen — type your answer below.',
    progress: 'Question 5 of 8', orders: 3, typeRow: true },
  { id: 'R2', label: 'the same, with a full sheet and a rambling transcript',
    cls: 'listening typed hasorders', say: OPEN_Q, interim: RAMBLE,
    progress: 'Question 8 of 8', orders: 4, typeRow: true },
];

/* ── THE ROWS THE MODULE TOGGLES WITH AN INLINE `display`, DERIVED FROM THE SOURCE ─────────────
   An inline style beats every rule in the stylesheet and is invisible to it, so `rootStateClasses`
   cannot see these and the previous round's audit could not either. Resolved PER FUNCTION: inside
   each function body, `var name = gid('mlsAvKioskX')` binds a name, and any `name.style.display =`
   in the same body means that element's visibility is switched by hand.
   Modals are returned separately rather than filtered out silently: they are exempt from the
   overlap measurement (a full-inset overlay is supposed to cover the screen) and the suite verifies
   that exemption against the stylesheet. */
const KIOSK_MODALS = ['mlsAvKioskConsent', 'mlsAvKioskPin', 'mlsAvKioskReview'];
function inlineDisplayRows(src) {
  const found = Object.create(null);
  /* function bodies, split on the module's own two-space `  function name(` declarations */
  const parts = src.split(/\n  (?=function [A-Za-z_$][\w$]*\()/);
  for (const body of parts) {
    const bind = Object.create(null);
    let m;
    const re = /(?:var\s+)?([A-Za-z_$][\w$]*)\s*=\s*gid\('(mlsAv[A-Za-z]+)'\)/g;
    while ((m = re.exec(body))) bind[m[1]] = m[2];
    const re2 = /([A-Za-z_$][\w$]*)\.style\.display\s*=/g;
    while ((m = re2.exec(body))) if (bind[m[1]]) found[bind[m[1]]] = true;
    /* and the direct form, with no variable at all */
    const re3 = /gid\('(mlsAv[A-Za-z]+)'\)\.style\.display\s*=/g;
    while ((m = re3.exec(body))) found[m[1]] = true;
  }
  const all = Object.keys(found).sort();
  return { rows: all.filter((id) => KIOSK_MODALS.indexOf(id) < 0), modals: all.filter((id) => KIOSK_MODALS.indexOf(id) >= 0) };
}

/* ── EVERY COMBINATION OF THOSE ROWS, AND WHAT REACHES IT ──────────────────────────────────────
   `reachable: false` is a CLAIM ABOUT THE MODULE, and the suite proves each one from the source
   rather than believing it: the function named in `by` must contain the statement that hides the
   other row. That is what stops "these two never happen together" from becoming the next blind
   spot. `state` names the rendered state above that covers a reachable combination. */
const ROW_PAIRS = [
  { rows: [], reachable: true, state: 'A', by: 'the first screen of an interview' },
  { rows: ['mlsAvKioskOrders'], reachable: true, state: 'K', by: 'ordersRender during a room capture' },
  { rows: ['mlsAvKioskRest'], reachable: true, state: 'I', by: 'kioskFinish' },
  { rows: ['mlsAvKioskTypeRow'], reachable: true, state: 'G', by: 'kioskListen with kiosk.mic === false' },
  { rows: ['mlsAvKioskOrders', 'mlsAvKioskRest'], reachable: true, state: 'Q',
    by: 'kioskAmbientStop: ordersRender leaves the sheet up and kioskRestShow adds the hand-off row' },
  { rows: ['mlsAvKioskOrders', 'mlsAvKioskTypeRow'], reachable: true, state: 'R',
    by: 'a microphone that fails while a room capture has actions pending' },
  /* the two rows are mutually exclusive, and it is provable: kioskRestShow is only ever reached
     from functions that hide the typed row first, and the ambient start hides the rest row. */
  { rows: ['mlsAvKioskRest', 'mlsAvKioskTypeRow'], reachable: false,
    hides: 'mlsAvKioskTypeRow', by: 'kioskFinish' },
  { rows: ['mlsAvKioskOrders', 'mlsAvKioskRest', 'mlsAvKioskTypeRow'], reachable: false,
    hides: 'mlsAvKioskTypeRow', by: 'kioskFinish' },
];

/* the panel, built with ordersRender's own class names — see ordersCard/ordersRender */
function ordersMarkup(n) {
  const one = (i) => '<div class="mlsAvOrd" data-kind="medication">' +
    '<div class="mlsAvOrdTop"><b>Naproxen 500 mg</b><span class="mlsAvOrdKind">MEDICATION</span></div>' +
    '<div class="mlsAvOrdDet">twice daily with food for ten days</div>' +
    '<div class="mlsAvOrdHeard">heard: "let\'s put you on naproxen five hundred twice a day"</div>' +
    '<div class="mlsAvOrdRow"><button type="button" class="mlsAvOrdGo">Confirm</button>' +
    '<button type="button" class="mlsAvOrdEdit">Edit</button>' +
    '<button type="button" class="mlsAvOrdNo">Dismiss</button></div></div>';
  let body = '';
  for (let i = 0; i < n; i++) body += one(i);
  return '<div class="mlsAvOrdHead"><span class="mlsAvOrdTitle">Proposed actions</span>' +
    '<span class="mlsAvOrdCount">' + n + ' to confirm</span></div>' +
    '<div class="mlsAvOrdList">' + body + '</div>' +
    '<div class="mlsAvOrdFoot">Nothing here is sent anywhere. Confirmed actions go into the visit ' +
    'note for you to place.</div>';
}

/* apply a state EXACTLY the way the module does: consent off, a class on the root, textContent
   on the three text nodes, inline display on the two rows the module toggles inline */
function applyStateScript(st) {
  return `(() => {
    const root = document.getElementById('mlsAvKiosk');
    root.className = ${JSON.stringify(st.cls)};
    document.getElementById('mlsAvKioskConsent').style.display = 'none';
    document.getElementById('mlsAvKioskSay').textContent = ${JSON.stringify(st.say)};
    document.getElementById('mlsAvKioskInterim').textContent = ${JSON.stringify(st.interim)};
    document.getElementById('mlsAvKioskProgress').textContent = ${JSON.stringify(st.progress)};
    document.getElementById('mlsAvKioskTypeRow').style.display = ${st.typeRow ? "'flex'" : "'none'"};
    document.getElementById('mlsAvKioskRest').style.display = ${st.rest ? "'flex'" : "'none'"};
    /* the panel exactly as ordersRender leaves it: inline display:block plus the root class that
       makes the column reserve its area. ordersRender is the single writer of both. */
    const ord = document.getElementById('mlsAvKioskOrders');
    ord.style.display = ${st.orders ? "'block'" : "'none'"};
    ord.innerHTML = ${JSON.stringify(st.orders ? ordersMarkup(st.orders) : '')};
  })()`;
}

/* ── THE MEASUREMENT ──────────────────────────────────────────────────────────────────────
   A SPILL is content painted outside its own box and landing on a sibling. It is measured the
   way the defect is seen: the box rect vs the box's own scroll height, and then elementFromPoint
   at the intersection, because geometry is not visibility - an earlier probe in this lane
   reported 21 false overlaps that were a header sitting BEHIND an opaque card. */
const MEASURE = `(() => {
  const root = document.getElementById('mlsAvKiosk');
  /* ⛔ EVERY ELEMENT UNDER THE ROOT, NOT A HAND-WRITTEN LIST. The list that used to be here was
     the deeper defect of av-6.3.0: it named fifteen ids, and #mlsAvKioskOrders — an OPAQUE white
     card, position:absolute, right:16px bottom:16px, up to 52vh tall, z-index 6, i.e. painted
     directly over the live transcript and the progress line — was not one of them. A harness that
     enumerates what its author remembered cannot find the thing its author forgot, which is
     exactly the class of miss this whole review round is about. So the DOM is asked instead.
     MODALS are declared, not skipped silently: a full-inset overlay with its own backdrop is
     SUPPOSED to cover the screen, and while one is up the patient line is not the subject. They
     are listed by id here and the assertions in the suite verify that each one really is a
     full-inset overlay, so the exemption cannot quietly grow to cover a real offender. */
  const MODALS = ['mlsAvKioskConsent', 'mlsAvKioskPin', 'mlsAvKioskReview'];
  const all = Array.from(root.querySelectorAll('*'));
  const vis = [];
  for (const el of all) {
    const id = el.id || '';
    if (MODALS.indexOf(id) >= 0) continue;
    if (MODALS.some((m) => { const n = document.getElementById(m); return n && n !== el && n.contains(el); })) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    /* THE COMPLAINT IS ABOUT TEXT. #mlsAvKioskFaceWrap's ::after ring is deliberately drawn
       14px OUTSIDE the box (inset:-14px), so its scrollHeight always exceeds its rect - and
       counting that as a spill is exactly the "a better statistic over the wrong pixels" trap:
       my first run of this harness reported 40 overflows, every one of them a decorative ring.
       So a box is measured only if it renders TEXT OF ITS OWN — a direct text node. Now that the
       sweep walks the whole tree, textContent would make every ANCESTOR of a paragraph look like
       a text box and measure its scrollHeight against a rect it does not own.
       (No backticks in this string: it is itself a template literal.) */
    const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
    vis.push({ id, el, r, cs, hasText });
  }
  const overflows = [], spills = [], clipped = [];
  for (const v of vis) {
    if (!v.hasText) continue;
    /* how much of its own content does the box fail to contain? */
    const over = v.el.scrollHeight - Math.ceil(v.r.height);
    /* a box with its own scroller CONTAINS its content by definition - the surplus scrolls
       inside it and cannot be painted on a sibling. That is the whole fix. */
    const owns = (v.cs.overflowY === 'auto' || v.cs.overflowY === 'scroll' || v.cs.overflowY === 'hidden');
    if (over > 1) overflows.push({ id: v.id, over, owns });
    if (over > 1 && !owns) {
      /* where would the escaped text land? */
      const bottom = v.r.bottom + over;
      for (const o of vis) {
        /* ⚠️ COMPARED BY ELEMENT, not by id. The sweep walks the whole tree now and most nodes
           have no id at all, so comparing o.id with v.id matched every id-less element against
           every other one and reported a box spilling into itself. */
        if (o.el === v.el || v.el.contains(o.el) || o.el.contains(v.el)) continue;
        if (o.r.top >= v.r.bottom - 1 && o.r.top < bottom) {
          const x = Math.max(v.r.left, o.r.left) + Math.min(v.r.width, o.r.width) / 2;
          const y = o.r.top + Math.min(6, o.r.height / 2);
          const topmost = document.elementFromPoint(x, y);
          spills.push({ from: v.id || v.el.tagName, into: o.id || o.el.tagName,
            px: Math.round((bottom - o.r.top) * 10) / 10,
            siblingOpaque: getComputedStyle(o.el).backgroundColor !== 'rgba(0, 0, 0, 0)',
            topmost: topmost ? topmost.id || topmost.tagName : null });
        }
      }
    }
    /* AND CLIPPING IS NOT A CURE. The root clips as a last resort, but a question with its
       first line cut off by the top of the screen is the same clinical problem as one with its
       last line hidden under a pill, so it is counted here too.
       ⚠️ EXCEPT INSIDE A SCROLLER, WHICH IS NOT THE SAME THING. Content below the fold of a box
       the reader can scroll is reachable; content below the fold of the SCREEN is not. My first
       run of the whole-tree sweep reported 21 "clipped" boxes, and every one of them was an order
       card sitting further down the proposed-actions panel's own scroll area — a better statistic
       over the wrong pixels again. So an element whose position is a function of some ancestor's
       scroll offset is judged by that ancestor's box, not by the viewport. */
    let sc = v.el.parentElement, inScroller = false;
    while (sc && sc !== root && !inScroller) {
      const pcs = getComputedStyle(sc);
      if (pcs.overflowY === 'auto' || pcs.overflowY === 'scroll') inScroller = true;
      sc = sc.parentElement;
    }
    if (!inScroller && (v.r.top < -1 || v.r.bottom > window.innerHeight + 1)) {
      clipped.push({ id: v.id || v.el.className || v.el.tagName,
        top: Math.round(v.r.top), bottom: Math.round(v.r.bottom),
        sample: (v.el.textContent || '').trim().slice(0, 40) });
    }
  }
  /* ── AND NOTHING MAY BE PAINTED ON TOP OF TEXT ────────────────────────────────────────────
     ⛔ THIS IS THE MEASUREMENT THE PREVIOUS VERSION COULD NOT MAKE, and its absence is why an
     opaque card sat on the patient's words through two "fixes". It used to enumerate a
     hand-written list of ids, require the occluder to have TEXT of its own, require it to be
     position:absolute/fixed, and then probe ONE point at the centre of the rect intersection.
     Every one of those was a way to miss a real occluder. This asks the only question that
     matters, of the browser, at the coordinates of the text itself:
        WHAT IS ACTUALLY PAINTED WHERE THESE WORDS ARE?
     A grid of points inside the text box, elementFromPoint at each, and anything that comes back
     which is neither this element, nor inside it, nor an ancestor of it, is painted over it.
     An ANCESTOR is not an occluder: it is the box these words sit in, and it is behind them.
     This also answers the "geometry is not visibility" trap the old comment named — 21 false
     overlaps in an earlier probe in this lane were rect intersections that nothing was painted
     into — because nothing here is inferred from a rect at all. */
  /* ── AND IT SAYS *WHY* IT IS AN OCCLUDER, WHICH IS THE HONESTY THIS LANE KEEPS NEEDING ────────
     elementFromPoint answers "what is hit here", which is not quite "what is drawn here": a
     positioned box with no background of its own is returned by hit-testing while painting nothing.
     Reporting that as text-being-covered is the "21 false overlaps" direction of this defect, and
     reporting nothing at all is the direction that let an opaque card sit on the words for two
     rounds. So each hit is CLASSIFIED by walking from the hit element up to the nearest common
     ancestor with the text and asking whether anything on the way actually paints - a background
     colour with alpha, a background image, a border, a replaced element, or text of its own:
        kind 'paint'   - something is genuinely drawn over the words, and the reported "by" field
                         names it. (No backticks anywhere in this string: it is a template literal.)
        kind 'pointer' - nothing is drawn, but the point is not reachable either. That is still a
                         defect (a transparent box over "End interview" means staff can SEE the
                         button and cannot press it - measured in this lane as #mlsAvKioskFaceWrap's
                         ::after ring over #mlsAvKioskEnd), so it is still reported and the suite
                         still fails on it. It is merely a different defect, and saying which one it
                         is turns a mystery into an instruction.
     BOTH kinds are counted as covered, so no assertion is weakened by classifying them. */
  const commonAncestor = (p, q) => {
    const up = new Set();
    for (let n = p; n; n = n.parentElement) up.add(n);
    for (let n = q; n; n = n.parentElement) if (up.has(n)) return n;
    return null;
  };
  const paintedBy = (hit, stop) => {
    for (let n = hit; n && n !== stop; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.backgroundImage !== 'none') return n;
      const mm = /rgba?\\(([^)]+)\\)/.exec(c.backgroundColor);
      if (mm) { const p = mm[1].split(',').map(Number); if (p.length < 4 || p[3] > 0.02) return n; }
      if (parseFloat(c.borderTopWidth) > 0.5 || parseFloat(c.borderBottomWidth) > 0.5) return n;
      if (['IMG', 'SVG', 'CANVAS', 'VIDEO'].indexOf(n.tagName) >= 0) return n;
      if (Array.from(n.childNodes).some((k) => k.nodeType === 3 && k.textContent.trim())) return n;
    }
    return null;
  };
  const covered = [];
  const FR = [0.12, 0.3, 0.5, 0.7, 0.88];
  for (const a of vis) {
    if (!a.hasText) continue;
    const hits = {};
    for (const fx of FR) {
      for (const fy of FR) {
        const x = a.r.left + a.r.width * fx, y = a.r.top + a.r.height * fy;
        if (x < 0 || y < 0 || x > window.innerWidth - 1 || y > window.innerHeight - 1) continue;
        const top = document.elementFromPoint(x, y);
        if (!top || top === a.el) continue;
        if (a.el.contains(top) || top.contains(a.el)) continue;
        const owner = top.closest('[id]');
        const key = (owner && owner.id) || top.tagName;
        const painter = paintedBy(top, commonAncestor(top, a.el));
        if (!hits[key]) {
          hits[key] = { points: 0, bg: getComputedStyle(top).backgroundColor,
            kind: painter ? 'paint' : 'pointer',
            by: painter ? (painter.id || painter.className || painter.tagName) : (top.id || top.tagName) };
        }
        /* a single painted point makes the whole hit a paint defect: the words are covered */
        if (painter && hits[key].kind !== 'paint') {
          hits[key].kind = 'paint';
          hits[key].by = painter.id || painter.className || painter.tagName;
        }
        hits[key].points++;
      }
    }
    for (const key of Object.keys(hits)) {
      covered.push({ text: a.id || a.el.className || a.el.tagName, under: key,
        points: hits[key].points, of: FR.length * FR.length, bg: hits[key].bg,
        kind: hits[key].kind, by: hits[key].by,
        sample: (a.el.textContent || '').trim().slice(0, 40) });
    }
  }
  /* ── AND A CLIPPED BOX MUST CLIP BETWEEN LINES, NOT THROUGH THEM ──────────────────────────
     A box that contains its text passes every check above while still LOOKING broken: cap it at
     3.27 lines and the fourth line is sliced horizontally through the glyphs. That is what a
     screenshot showed after the first version of this fix measured clean, and it is the class of
     miss that "a better statistic over the wrong pixels" describes. So: whenever a box is
     actually clipping, its visible height must be a whole number of line boxes. */
  const sliced = [];
  for (const v of vis) {
    if (!v.hasText) continue;
    if (v.el.scrollHeight <= v.el.clientHeight + 1) continue;   /* not clipping: nothing to slice */
    const lh = parseFloat(v.cs.lineHeight);
    if (!lh || !isFinite(lh)) continue;
    const rem = v.el.clientHeight % lh;
    if (Math.min(rem, lh - rem) > 1.5) {
      sliced.push({ id: v.id, clientHeight: Math.round(v.el.clientHeight * 10) / 10,
        lineHeight: Math.round(lh * 10) / 10, lines: Math.round((v.el.clientHeight / lh) * 100) / 100 });
    }
  }
  const cs = getComputedStyle(root);
  return {
    overflows, spills, clipped, covered, sliced,
    columnNatural: root.scrollHeight,
    viewport: window.innerHeight,
    rootOverflowY: cs.overflowY,
    faceW: Math.round(document.getElementById('mlsAvKioskFaceWrap').getBoundingClientRect().width),
    faceH: Math.round(document.getElementById('mlsAvKioskFaceWrap').getBoundingClientRect().height),
    /* ⚠️ WHY THE DISPLAY IS REPORTED TOO: a 0x0 face satisfies "width equals height" perfectly, so
       the circularity assertion alone cannot tell a deliberately hidden face from one that collapsed
       to nothing. The suite reads this to insist that a face with no size is one a RULE removed. */
    faceDisplay: getComputedStyle(document.getElementById('mlsAvKioskFaceWrap')).display,
    interimText: document.getElementById('mlsAvKioskInterim').textContent.length
  };
})()`;

/* ── THE VIEWPORTS, AND WHY THE PORTRAIT ONES ARE NOT OPTIONAL ────────────────────────────────
   ⛔ THIS LIST USED TO BE FIVE LANDSCAPE SIZES, 800-1920px WIDE, and that is the SECOND time the
   test population was the deeper defect in this lane. The first was a hand-written list of fifteen
   element ids that omitted the actual offender; this is the same mistake on the other axis — the
   stylesheet has an `@media (max-width:720px)` branch that NO VIEWPORT HERE COULD MATCH, so the
   whole narrow-screen layout was pinned only as a STRING by a regex and never executed. Measured
   the moment these five were added: #mlsAvKioskOrders covered #mlsAvKioskInterim at 20-25 of 25
   sampled points and #mlsAvKioskProgress at 25 of 25 on EVERY narrow size, the opaque corner pills
   were painted over #mlsAvKioskName, and #mlsAvKioskFaceWrap sat on top of "End interview".
   A RESPONSIVE RULE PINNED AS A STRING IS NOT TESTED. Every branch of the stylesheet must have a
   viewport here that makes it match, and the bottom-sheet layout is a DIFFERENT stacking problem
   from the side card, so the desktop reservation proves nothing about it.
   `matchedMediaBranches` below is the guard on the guard: it asserts this list actually triggers
   every media query the stylesheet declares, so the next branch added cannot be untested either. */
const VIEWPORTS = [
  { w: 1512, h: 982, label: 'MacBook 14"' },
  { w: 1920, h: 1080, label: 'exam-room display' },
  { w: 1366, h: 768, label: 'older clinic laptop' },
  { w: 1024, h: 768, label: 'iPad landscape' },
  { w: 800, h: 600, label: 'the oldest screen a clinic still has' },
  /* ⚠️ 721x800 is the far side of the breakpoint by ONE PIXEL, on purpose: an off-by-one in the
     media query (min-width vs max-width, 720 vs 719) is otherwise invisible. */
  { w: 721, h: 800, label: 'one pixel wide of the 720px breakpoint' },
  { w: 720, h: 1280, label: 'tablet portrait, exactly at the breakpoint' },
  { w: 414, h: 896, label: 'iPhone 11 portrait' },
  { w: 375, h: 812, label: 'iPhone X portrait' },
  { w: 360, h: 740, label: 'Android portrait' },
  { w: 320, h: 568, label: 'the smallest phone still in service' },
];

/* every `@media (...)` condition the shipped stylesheet declares, as written. The suite asserts
   each one is MATCHED by at least one viewport above — a branch nothing renders is a branch
   nothing tests, whatever a regex over the source says about it. */
function mediaConditions(css) {
  const out = [];
  const re = /@media\s*([^{]+)\{/g;
  let m;
  while ((m = re.exec(css))) out.push(m[1].trim());
  return out;
}

/* ── AND THE SAME GUARD ON THE STATE LIST ─────────────────────────────────────────────────────
   STATES below is written by hand, so by the argument this whole file is about it cannot contain
   the state its author forgot. It cannot be derived — the say/interim strings come from real call
   sites and only a human can supply those — but the CLASSES it exercises can be: every root class
   the shipped stylesheet styles must appear in at least one state, or that branch of the layout is
   never rendered by anything in the gate. `.hasorders` is in the list today precisely because the
   round before this one discovered it the hard way. */
function rootStateClasses(css) {
  const out = {};
  const re = /#mlsAvKiosk((?:\.[A-Za-z][\w-]*)+)/g;
  let m;
  while ((m = re.exec(css))) {
    m[1].split('.').filter(Boolean).forEach((c) => { out[c] = true; });
  }
  return Object.keys(out).sort();
}

/* ══ THE DETECTOR IS PROVEN BY MAKING IT FAIL, AND BY MAKING IT REFUSE TO ══════════════════════
   A measurement that has only ever returned "clean" is indistinguishable from a measurement that
   cannot return anything else - which is precisely what happened here: the occlusion sweep was
   green at six viewports while an opaque card sat on the words in a state nobody rendered. So the
   suite constructs three known states and asserts what the detector says about each. All three are
   injected into a RENDERED page and measured by the same MEASURE above, not reasoned about.
     1 KNOWN COVERING ELEMENT  -> must be reported, kind 'paint', naming itself.
     2 KNOWN HARMLESS ELEMENT BEHIND AN OPAQUE CARD -> must NOT be reported. This is the historical
       false positive in this lane: 21 "overlaps" that were a header sitting behind an opaque panel,
       reported from rect intersections alone.
     3 KNOWN TRANSPARENT OVERLAY -> must be reported, but as kind 'pointer', because nothing is
       drawn on the words even though the point is unreachable. It is the direction that separates
       "geometry is not visibility" from "nothing is painted here". */
const PROBE_COVER = `(() => {
  const t = document.getElementById('mlsAvKioskInterim').getBoundingClientRect();
  const d = document.createElement('div');
  d.id = 'mlsAvProbeCover';
  d.style.cssText = 'position:fixed;left:' + t.left + 'px;top:' + t.top + 'px;width:' + t.width +
    'px;height:' + t.height + 'px;background:#fff;z-index:2147483000';
  document.getElementById('mlsAvKiosk').appendChild(d);
  return true;
})()`;
/* BEHIND, not on top: the same coordinates as the opaque proposed-actions card, painted first and
   with a lower stacking order, so hit-testing never returns it. It carries text of its own so the
   sweep really does measure it, and it RETURNS the number of sample points at which its rect
   intersects the card - because the proof is only a proof if the trap is real. A rect-intersection
   detector reports 25 of 25 here; a paint detector must report that this element covers nothing. */
const PROBE_BEHIND = `(() => {
  const card = document.getElementById('mlsAvKioskOrders');
  const p = card.getBoundingClientRect();
  const d = document.createElement('div');
  d.id = 'mlsAvProbeBehind';
  d.textContent = 'a harmless element behind the opaque card';
  d.style.cssText = 'position:fixed;left:' + p.left + 'px;top:' + p.top + 'px;width:' + p.width +
    'px;height:' + Math.min(40, p.height) + 'px;background:#eee;z-index:1;overflow:hidden';
  const root = document.getElementById('mlsAvKiosk');
  root.insertBefore(d, root.firstChild);
  const r = d.getBoundingClientRect();
  const FR = [0.12, 0.3, 0.5, 0.7, 0.88];
  let inCard = 0, hidden = 0;
  for (const fx of FR) for (const fy of FR) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (x >= p.left && x <= p.right && y >= p.top && y <= p.bottom) inCard++;
    const top = document.elementFromPoint(x, y);
    if (top && top !== d && !d.contains(top)) hidden++;
  }
  return { rectPointsInsideCard: inCard, pointsWhereSomethingElseIsHit: hidden, of: FR.length * FR.length };
})()`;
const PROBE_TRANSPARENT = `(() => {
  const t = document.getElementById('mlsAvKioskInterim').getBoundingClientRect();
  const d = document.createElement('div');
  d.id = 'mlsAvProbeGhost';
  d.style.cssText = 'position:fixed;left:' + t.left + 'px;top:' + t.top + 'px;width:' + t.width +
    'px;height:' + t.height + 'px;background:transparent;z-index:2147483000';
  document.getElementById('mlsAvKiosk').appendChild(d);
  return true;
})()`;

module.exports = { readSource, liftKioskCss, liftKioskHtml, page, STATES, applyStateScript, MEASURE,
  VIEWPORTS, mediaConditions, rootStateClasses, inlineDisplayRows, ROW_PAIRS, KIOSK_MODALS,
  PROBE_COVER, PROBE_BEHIND, PROBE_TRANSPARENT };
