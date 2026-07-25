/* MLS Calm Shell — calm-1.0.0
 *
 * UI_CHARTER_CALM_SHELL_2026-07-24.md, all five layers in one module:
 *   dock (option 9) · right-now bar (8) · stages (3) · heads-down (7) · Ask (2)
 *
 * ARCHITECTURE — read this before changing anything.
 *
 * This shell owns PRESENTATION ONLY. It never becomes a second writer:
 *   - Dock items click the real rail tab (#nav_visit etc). The rail stays the
 *     single owner of navigation; it is hidden with CSS, never removed.
 *   - Right-now actions click the real button that already exists in the view.
 *     If the real control is absent, the action is absent. Nothing is
 *     reimplemented, so nothing can drift out of sync with the app.
 *   - Ask resolves a typed phrase to a real control and clicks it.
 *   - showView() is NOT wrapped. View state is read by observing which .navtab
 *     carries .on — the rail keeps updating even while hidden. One observer.
 *
 * That is why this file can add a whole new shell without touching clinical
 * logic: every action still runs through the control the app already trusts.
 *
 * Escape hatch: ?ui=classic, or Tools -> "Classic layout". One click, no reload.
 */
(function () {
  'use strict';

  if (window.__mlsCalmShell) return;

  var VERSION = 'calm-1.0.0';

  /* Dock destinations. The coverage suite asserts this list matches
     tests/fixtures/ui-reach-map.json so the shipped dock and the reach
     contract cannot drift apart. */
  var CONTRACT = { MLS_DOCK_DEST: ['day', 'patient', 'review', 'tools', 'visit'] };

  var W = window;
  var D = document;
  var STORE_KEY = 'mlsCalmShell';
  var HEADSDOWN_KEY = 'mlsCalmHeadsDown';

  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function qs(sel, root) { return safe(function () { return (root || D).querySelector(sel); }); }
  function qsa(sel, root) {
    return safe(function () { return Array.prototype.slice.call((root || D).querySelectorAll(sel)); }) || [];
  }
  function visible(el) {
    if (!el) return false;
    if (el.hidden || el.disabled) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }
  function normLabel(t) {
    return String(t || '').replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ')
      .replace(/[←-⯿☀-➿️‍＋]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }
  function textOf(el) {
    return normLabel((el && (el.textContent || el.getAttribute('title') || el.getAttribute('aria-label'))) || '');
  }

  /* A control's label is NOT its textContent.
     Owner, 2026-07-24, on the right-now bar: "i ahte this patient banner like
     wtf is this its aweful". The bar was showing "Linda S Bledsoe9:40 AM".

     The ez3 buttons put the patient in a block-level <small> with NO separator
     in the markup, which is correct in that shell - .ez3-big small is
     display:block, so it renders on its own line. textContent has no concept of
     that line break, so flattening the button into this bar's plain-text label
     welds the surname onto the time. It reads as a typo in the patient's NAME,
     which is the worst place on a clinical screen to have one.

     The bug is real but it is NOT a CSS problem: this bar assigns
     b.textContent = ..., so it contains no <small> element to style, and a
     '#mlsRightNow button small' rule cannot fire. The separator has to be put
     back where the label is derived.

     Live probe of #ptPullAthenaBtn showed the problem is bigger than a missing
     separator. Its textContent is four things welded together:
       "📥 Pull from Athena"                     the actual label
       span.mlsac-sub    display:none            a hidden sub-label
       span.mlsac-tag    inline-block, after <br>  "READ-ONLY"
       span.mlsactip-pop visibility:hidden;opacity:0;role=tooltip
     so the bar was publishing a hover tooltip and a hidden element as part of
     a button's name: "Pull from AthenaOpens this patient's chart in your
     signed-in Athena tab (read-on...". Hidden text in a label is worse than a
     missing separator - it is text the doctor never chose to read, and because
     the Ask index and the control inventory match on these labels, it pollutes
     search results too.

     So: drop anything the element itself hides, break on block-level children
     and <br>, and join what remains with a separator.

     Visibility is judged from each child's OWN computed style, never from
     rects or offsetParent - measured live, every child reports width 0 and
     offsetParent null purely because an ancestor view is hidden, so a
     rect-based test would call every label empty. */
  function labelHidden(n) {
    if (n.getAttribute && n.getAttribute('role') === 'tooltip') return true;
    var cs = null;
    try { cs = W.getComputedStyle(n); } catch (e) { return false; }
    if (!cs) return false;
    return cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0';
  }
  function labelBlocky(n) {
    var cs = null;
    try { cs = W.getComputedStyle(n); } catch (e) { cs = null; }
    var d = cs && cs.display;
    if (d) return /^(block|flex|grid|list-item|table)/.test(d);
    return /^(SMALL|DIV|P|LI|SECTION)$/.test(n.tagName || '');
  }
  /* RECURSIVE, and that is the whole point. The first version flushed at a block
     child and pushed `n.textContent` — the raw flattened text of that child's
     ENTIRE subtree — so it separated exactly one level and re-welded everything
     below it. Measured live at b581 on the patient header, which is two levels
     deep:

       .mlsctx-id[role=button]
         span.mlsctx-av      flex   "SO"                    <- avatar initials
         span.mlsctx-idtext  flex
           span.mlsctx-name  block  "Sample Patient One"
           span.mls-age-chip none   "Age 51 yrs"            <- hidden
           span.mlsctx-meta  block  "51y F · DOB …"

     One level of separation yields
       "SO · Sample Patient OneAge 51 yrs51y F · DOB 01/15/1975 · MRN …"
     which welds the patient's surname to a hidden chip and then to their sex —
     in the patient header, announced to every screen-reader user. Recursing
     gives "SO · Sample Patient One · 51y F · DOB …" and drops the hidden chip,
     because the hidden test is applied at every depth rather than only the top.

     The inline branch also guards its own boundary: an inline child whose text
     abuts the preceding text with no whitespace in the markup ("8:10 AM" +
     "Sample O.") is the same collision in a shape that never reaches the block
     branch. A single space is the minimum honest repair there — these render on
     one line, so ' · ' would claim a break the eye does not see.

     Depth is capped so a pathological tree cannot recurse without bound; at the
     cap it falls back to flattened text, which is what it always did. */
  function controlLabel(el, depth) {
    if (!el || !el.childNodes || !el.childNodes.length) return textOf(el);
    if (depth > 6) return normLabel(el.textContent);
    var segs = [], cur = '';
    function flush() { var s = normLabel(cur); if (s) segs.push(s); cur = ''; }
    for (var i = 0; i < el.childNodes.length; i++) {
      var n = el.childNodes[i];
      if (n.nodeType === 3) { cur += n.nodeValue; continue; }
      if (n.nodeType !== 1) continue;
      if ((n.tagName || '') === 'BR') { flush(); continue; }
      if (labelHidden(n)) continue;
      if (labelBlocky(n)) { flush(); var t = controlLabel(n, (depth || 0) + 1); if (t) segs.push(t); continue; }
      var inlineText = String(n.textContent || '');
      if (/\S$/.test(cur) && /^\S/.test(inlineText)) cur += ' ';
      cur += inlineText;
    }
    flush();
    if (!segs.length) return textOf(el);
    return segs.join(' · ');
  }

  /* ---------------------------------------------------------------- enable */

  function enabled() {
    var q = String(location.search || '');
    if (/[?&]ui=classic/i.test(q)) { safe(function () { localStorage.setItem(STORE_KEY, '0'); }); return false; }
    if (/[?&]ui=calm/i.test(q)) { safe(function () { localStorage.setItem(STORE_KEY, '1'); }); return true; }
    var stored = safe(function () { return localStorage.getItem(STORE_KEY); });
    if (stored === '0') return false;
    return true;
  }

  /* ------------------------------------------------------------------- css */

  /* Apple's standard easing curve. Everything moves on transform/opacity only —
     no layout-animating properties, so a mid-clinic machine never janks. */
  var CSS = [
    ':root{--mls-spring:cubic-bezier(.32,.72,0,1);--mls-fast:180ms;--mls-base:260ms;--mls-slow:380ms}',
    /* feat_mls_redesign.js relocates the rail into #mlsRdNav inside the header and
       pins it with `#mlsRdNav .mainnav{display:flex!important}`. An ID beats two
       classes, so the plain `body.mls-calm .mainnav` rule lost and b533 shipped
       with BOTH the dock and the old rail on screen. Verified live, fixed by
       out-specifying every container the rail is known to live in. */
    'html body.mls-calm .mainnav,',
    'html body.mls-calm #mlsRdNav .mainnav,',
    'html body.mls-calm #appHeader .mainnav,',
    'html body.mls-calm #appWrap .mainnav{display:none!important}',

    /* Hiding the rail left its CONTAINER behind: #mlsRdNav is a fixed 236px
       column (logo, the now-hidden rail, a Settings/Sign out footer) and
       `body.mls-rd-shell{padding-left:var(--rail-w)}` indents the whole app to
       clear it. So the app sat pushed right by a near-empty sidebar. Take the
       column out and give the width back. Nothing is lost: Settings and Sign out
       are in the Tools menu, which the coverage suite enforces. */
    'html body.mls-calm #mlsRdNav{display:none!important}',
    'html body.mls-calm.mls-redesign.mls-rd-shell{padding-left:0!important}',
    /* The other rail layout: an #appWrap grid whose first column exists only to
       hold .mainnav. With the rail hidden that column is dead space. */
    'html body.mls-calm.mls-nav-left #appWrap{display:block!important}',
    /* A 24px full-width strip that renders nothing. :empty is deliberate — the
       moment any module puts content in it the selector stops matching and it
       comes back, so this can never hide something real. */
    'html body.mls-calm #mlsEz3Head:empty{display:none!important}',
    'body.mls-calm #appHeader .tools .btn-white{display:none!important}',
    'body.mls-calm #appHeader .tools .btn-white.mls-calm-keep{display:inline-flex!important}',
    'body.mls-calm{padding-bottom:96px}',

    /* dock */
    '#mlsDock{position:fixed;left:50%;bottom:18px;transform:translateX(-50%) translateY(0);z-index:920;',
    'display:flex;align-items:center;gap:4px;padding:6px;border-radius:22px;',
    'background:rgba(255,255,255,.72);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);',
    'border:1px solid rgba(0,0,0,.06);box-shadow:0 12px 34px rgba(20,35,28,.16),0 2px 6px rgba(20,35,28,.08);',
    /* The resting transform lives HERE, never in the animation. Two @keyframes
       once shared the name mlsDockIn (one per breakpoint); flipping the media
       query re-resolved them, the entrance animation restarted and never
       settled, and the dock sat frozen mid-slide 10px below the screen edge on
       mobile. Distinct names per breakpoint, and the resting position holds even
       if the animation never runs at all. */
    'opacity:0;animation:mlsDockInD var(--mls-slow) var(--mls-spring) forwards}',
    '@keyframes mlsDockInD{from{opacity:0;transform:translateX(-50%) translateY(18px) scale(.96)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}',
    '#mlsDock .mls-dock-pill{position:absolute;top:6px;left:6px;height:calc(100% - 12px);border-radius:16px;background:#D6E7DC;',
    'box-shadow:0 1px 2px rgba(20,35,28,.14),inset 0 0 0 1px rgba(32,64,52,.10);',
    'transition:transform var(--mls-base) var(--mls-spring),width var(--mls-base) var(--mls-spring);pointer-events:none;z-index:0}',
    '#mlsDock button{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:2px;',
    'min-width:64px;padding:8px 12px 7px;border:0;background:transparent;border-radius:16px;cursor:pointer;',
    'font:500 11.5px/1.1 inherit;color:#5B6B62;transition:color var(--mls-fast) var(--mls-spring),transform var(--mls-fast) var(--mls-spring)}',
    '#mlsDock button:hover{color:#204034}',
    '#mlsDock button:active{transform:scale(.93)}',
    '#mlsDock button.on{color:#173026;font-weight:700}',
    '#mlsDock button svg{transition:transform var(--mls-base) var(--mls-spring)}',
    '#mlsDock button.on svg{transform:translateY(-1px) scale(1.08)}',
    '#mlsDock button svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}',
    '#mlsDock .mls-dock-count{position:absolute;top:3px;right:9px;min-width:15px;height:15px;padding:0 4px;border-radius:8px;',
    'background:#2E6A4B;color:#fff;font:500 10px/15px inherit;text-align:center;transform:scale(0);',
    'transition:transform var(--mls-base) var(--mls-spring)}',
    '#mlsDock .mls-dock-count.show{transform:scale(1)}',
    '#mlsDockAskWrap{position:relative;z-index:1;display:flex;align-items:center;margin-left:4px;padding-left:8px;border-left:1px solid rgba(0,0,0,.07)}',
    '#mlsDockAsk{width:150px;height:34px;padding:0 12px;border:0;border-radius:14px;background:rgba(0,0,0,.045);',
    'font:400 13px inherit;color:#1A211C;outline:0;transition:width var(--mls-base) var(--mls-spring),background var(--mls-fast) linear}',
    '#mlsDockAsk:focus{width:250px;background:rgba(0,0,0,.075)}',
    '#mlsDockAsk::placeholder{color:#8C978F}',
    '#mlsAskResults{position:absolute;bottom:46px;right:0;width:340px;max-height:320px;overflow:auto;',
    'background:rgba(255,255,255,.92);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);border:1px solid rgba(0,0,0,.07);',
    'border-radius:16px;box-shadow:0 16px 40px rgba(20,35,28,.18);padding:6px;display:none;',
    'transform-origin:bottom right;animation:mlsPop var(--mls-base) var(--mls-spring)}',
    '@keyframes mlsPop{from{opacity:0;transform:scale(.94) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}',
    '#mlsAskResults .r{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:11px;cursor:pointer;font-size:13.5px;color:#1A211C}',
    '#mlsAskResults .r:hover,#mlsAskResults .r.sel{background:#EAF1EE}',
    '#mlsAskResults .r small{margin-left:auto;color:#8C978F;font-size:11.5px}',
    '#mlsAskResults .r.danger{color:#A32D2D}',
    '#mlsAskResults .none{padding:12px;color:#68736B;font-size:13px}',

    /* Three floating pills - MLS Copilot Voice, MLS Assistant, Dictate - stacked
       over the bottom of every screen and all led to the same assistant. One
       Copilot button in the dock replaces them; the mic lives inside the Copilot
       card, which is where a mic belongs. */
    'body.mls-calm #mlsCopVoiceBtn,body.mls-calm #mlsAsstFab,',
    'body.mls-calm #mlsDaDock{display:none!important}',
    'body.mls-calm #mls-ask-btn{display:none!important}',
    /* vis-1.0.0 - the Visit screen was 1307px tall before anything below it.
       Measured on the live page: an empty transcript panel spending 252px to
       say "0 words captured", and a 56px bar showing the current time on a
       device that already shows the time. Neither is a control; both sit
       between the doctor and the record button. The transcript comes back the
       instant it has a word, so nothing is lost - it just stops reserving a
       quarter of the screen to report that it is empty. */
    /* mlsRdStyle already declares
         body.mls-redesign #ez3Wrap > .ez3-clockbar{display:flex!important}
       which is (1,2,1) against a plain body.mls-calm .ez3-clockbar at (0,2,1).
       Both carry !important, so the ID wins and the plain rule was inert -
       parsed, matched, and beaten. Same trap as #mlsRdNav. Out-specify it
       rather than pile on another !important, which would change nothing. */
    'body.mls-calm.mls-redesign #ez3Wrap > .ez3-clockbar,body.mls-calm .ez3-clockbar{display:none!important}',
    /* The day strip wrapped to 243px because it carried two SETTINGS beside
       the day navigation: where pulls run, and whether to fetch full visit
       notes. Neither is part of working a day - they are configured once and
       then sit above every screenful of actual work. Both move to Tools,
       where available() still finds them because the WRAPPER is hidden by
       class and the controls keep no inline display. Day nav and the pull
       action stay exactly where they are. */
    'body.mls-calm #mlsDsStrip > #mlsPdpWrap,body.mls-calm #mlsDsStrip > #mlsDsVisitTgl{display:none!important}',
    /* Two visible controls on the Visit screen carried the SAME label,
       'Advanced visit workspace': .ez3fl-openws inside the record block, and
       #ez3Adv in its own row. They are not two features - openWorkspace()
       literally does adv.click() on #ez3Adv and then focuses the note card, so
       the standalone row is a second door to the same room, 44px tall, sitting
       under a duplicate name.
       The ROW is hidden, not the button: openWorkspace() still calls
       #ez3Adv.click() programmatically, which works on a CSS-hidden element,
       and hiding by class (never inline) keeps available() true so nothing
       loses its reach. The richer control - the one that also brings the note
       card into view - is the one that stays visible. */
    'body.mls-calm .ez3-advrow{display:none!important}',
    /* On a phone, opening a patient showed the profile AND kept the whole
       patient list underneath it - 1664px of profile stacked on 808px of list,
       so the doctor scrolled through a directory they had already used to get
       where they were. Master-detail, not master-AND-detail.
       The list folds only while a profile is open, only under 700px, and it
       comes straight back on :focus-within of the search row - so the primary
       way to switch patients still works with one tap and needs no new
       control. The dock's Patient button is the second route. Verified live:
       503px -> 0 while reading, 0 -> 503px the moment search takes focus. */
    '@media (max-width:700px){',
    'body.mls-calm #ptSplitWrap.px-has-profile #ptList{display:none!important}',
    'body.mls-calm #ptSplitWrap.px-has-profile .pt-search:focus-within ~ #ptList{display:block!important}',
    '}',
    'body.mls-calm .ez3fl-transcript.mls-empty{display:none!important}',
    /* pt-2.0.0 - the patient card measured 4,005px: five phone screens for one
       patient. The single largest duplication is the prep summary. prepRows()
       already parses it into compact labelled rows and inserts them ABOVE the
       box, and then the raw 499px body renders again underneath - the same
       content twice, the second copy unreadable. The raw body folds away once
       the rows exist; the rows carry the full text in title=, and the box
       keeps its own Copy control. Nothing is lost, ~500px is.
       The problem list is capped rather than folded - it is the one block a
       doctor scans mid-visit, so it stays visible and scrolls internally
       instead of pushing everything below it off the screen. */
    'body.mls-calm #mlsEpSummaryBox .body.mls-dup{display:none!important}',
    'body.mls-calm .prof-grid{max-height:340px;overflow:auto;-webkit-overflow-scrolling:touch}',
    'body.mls-calm .prof-grid::-webkit-scrollbar{width:6px}',
    'body.mls-calm .prof-grid::-webkit-scrollbar-thumb{background:rgba(32,64,52,.18);border-radius:3px}',
    '#mlsDock #mlsDockCopilot{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;',
    'gap:2px;min-width:64px;padding:8px 12px 7px;border:0;background:transparent;border-radius:16px;cursor:pointer;',
    'font:500 11.5px/1.1 inherit;color:#5B6B62;',
    'transition:color var(--mls-fast) var(--mls-spring),transform var(--mls-fast) var(--mls-spring)}',
    '#mlsDock #mlsDockCopilot svg{width:20px;height:20px;fill:currentColor;stroke:none}',
    '#mlsDock #mlsDockCopilot:hover{color:#2E6A4B}',
    '#mlsDock #mlsDockCopilot:active{transform:scale(.93)}',

    /* The patient context bar: keep its controls, make them read as one row.
       Consistent gaps, wrapping instead of overflow, and a shared baseline so a
       tall chip cannot shove its neighbours out of line. */
    'body.mls-calm #patientBar,body.mls-calm #mlsCtxBar{display:flex;align-items:center;',
    'flex-wrap:wrap;gap:8px 10px;row-gap:8px}',
    'body.mls-calm #patientBar>*,body.mls-calm #mlsCtxBar>*{min-width:0}',
    'body.mls-calm #patientBar button,body.mls-calm #mlsCtxBar button{white-space:nowrap}',

    /* QUIETED, NOT HIDDEN. display:none broke every control that anchors UI to
       itself: Snapshot positions its popover from its own getBoundingClientRect,
       and a hidden button measures 0x0, so "Tools > Snapshot" opened a panel
       off-screen and looked like nothing happened. Share/Export and the export
       menus have the same shape. So these stay laid out and measurable - just
       small and muted, so one primary action can lead without anything losing
       the position its own behaviour depends on. */
    'body.mls-calm #profileCard .mls-moved,',
    'body.mls-calm #patientBar .mls-moved,',
    'body.mls-calm #mlsCtxBar .mls-moved{font-size:12px!important;padding:5px 9px!important;',
    'opacity:.5;font-weight:400!important;box-shadow:none!important;',
    'transition:opacity var(--mls-fast) linear}',
    'body.mls-calm #profileCard .mls-moved:hover,body.mls-calm #patientBar .mls-moved:hover,',
    'body.mls-calm #mlsCtxBar .mls-moved:hover,body.mls-calm .mls-moved:focus-visible{opacity:1}',

    /* The patient list showed 150 names and 300 buttons, so it read as a wall of
       controls rather than a list of people. The row controls stay present and
       full-size - touch targets are untouched, nothing is hover-only - they are
       just quiet until the row is hovered, focused or active. Names lead. */
    'body.mls-calm #ptList .pt-row button,body.mls-calm #ptList li button{opacity:.42;',
    'transition:opacity var(--mls-fast) linear}',
    'body.mls-calm #ptList .pt-row:hover button,body.mls-calm #ptList li:hover button,',
    'body.mls-calm #ptList .pt-row:focus-within button,body.mls-calm #ptList li:focus-within button,',
    'body.mls-calm #ptList .pt-row.on button,body.mls-calm #ptList li.on button{opacity:1}',
    'body.mls-calm #ptList button:focus-visible{opacity:1;outline:2px solid #2E6A4B;outline-offset:2px}',

    /* patient screen: reference blocks fold to one line */
    'body.mls-calm #profileCard .mls-fold{border:1px solid #EDEBE4;border-radius:12px;margin:8px 0;background:#fff}',
    'body.mls-calm #profileCard .mls-fold:not(.mls-open) > *:not(:first-child){display:none!important}',
    'body.mls-calm #profileCard .mls-fold > .mls-fold-hd{margin:0;padding:12px 14px;cursor:pointer;',
    'display:flex;align-items:center;gap:9px;font:500 13.5px/1.3 inherit;color:#4A5B51;border:0;background:none}',
    'body.mls-calm #profileCard .mls-fold > .mls-fold-hd:hover{background:#F6FAF8;border-radius:12px}',
    'body.mls-calm #profileCard .mls-fold > .mls-fold-hd::after{content:"";margin-left:auto;width:7px;height:7px;',
    'border-right:1.6px solid #9AA69E;border-bottom:1.6px solid #9AA69E;transform:rotate(-45deg);',
    'transition:transform var(--mls-base) var(--mls-spring)}',
    'body.mls-calm #profileCard .mls-fold.mls-open > .mls-fold-hd::after{transform:rotate(45deg)}',
    'body.mls-calm #profileCard .mls-fold:not(.mls-open) > .mls-fold-hd button{display:none!important}',
    'body.mls-calm #profileCard .mls-fold.mls-open > *:not(:first-child){animation:mlsViewIn var(--mls-base) var(--mls-spring)}',

    /* prep summary rows */
    '#mlsPrepRows{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:0 22px;margin:2px 0 6px}',
    '#mlsPrepRows .r{display:flex;align-items:baseline;gap:10px;padding:8px 0;min-width:0;',
    'border-bottom:1px solid rgba(0,0,0,.05)}',
    '#mlsPrepRows .k{flex:0 0 88px;font:500 11px/1.4 inherit;letter-spacing:.4px;text-transform:uppercase;color:#8C978F}',
    /* Clamped to two lines. A prep summary is a glance, not a note: LAST VISIT
       carries a whole SOAP note and rendered a 313px wall of text in one row.
       The full value is on the title attribute, and the untouched raw block
       below still holds everything for Copy. */
    '#mlsPrepRows .v{flex:1 1 auto;min-width:0;font:400 13.5px/1.5 inherit;color:#1A211C;overflow-wrap:anywhere;',
    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '#mlsPrepRows .v.none{color:#B4BDB7}',
    /* Below ~430px the fixed label column starved the value; stack instead. */
    '@media (max-width:430px){',
    '#mlsPrepRows .r{flex-direction:column;gap:1px;padding:7px 0}',
    '#mlsPrepRows .k{flex:0 0 auto}}',
    /* Clipped, NOT display:none — the Copy button reads rendered text, and a
       display:none block would silently start copying less than it used to. */
    '.mls-raw-clipped{position:absolute!important;width:1px;height:1px;overflow:hidden;',
    'clip-path:inset(50%);white-space:pre-wrap!important;pointer-events:none}',

    /* tools menu */
    '#mlsToolsMenu{position:fixed;z-index:930;min-width:224px;padding:6px;border-radius:16px;',
    'background:rgba(255,255,255,.94);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);',
    'border:1px solid rgba(0,0,0,.07);box-shadow:0 16px 40px rgba(20,35,28,.18);',
    'transform-origin:bottom left;animation:mlsPop var(--mls-base) var(--mls-spring)}',
    '#mlsToolsMenu .r{padding:9px 12px;border-radius:11px;font-size:13.5px;color:#1A211C;cursor:pointer}',
    '#mlsToolsMenu .r:hover,#mlsToolsMenu .r:focus{background:#EAF1EE;outline:0}',
    '#mlsToolsMenu .sep{height:1px;margin:5px 8px;background:rgba(0,0,0,.07)}',
    '#mlsToolsMenu .r.classic{color:#68736B}',

    /* right-now bar */
    '#mlsRightNow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px;padding:10px 12px;',
    'background:rgba(255,255,255,.86);border:1px solid #E7E5DD;border-radius:16px;',
    'box-shadow:0 1px 2px rgba(20,35,28,.04)}',
    /* idc-1.0.0 — the patient card that used to be a button label. Reads as
       information: no border that suggests pressing it, no hover state. */
    'body.mls-calm .mls-idcard{margin:0 0 8px;padding:11px 14px;border-radius:14px;',
    'background:#F4F7F5;border:1px solid #E4EAE6;text-align:left}',
    'body.mls-calm .mls-idname{font:650 17px/1.25 inherit;color:#1A211C;letter-spacing:-.01em;',
    'overflow-wrap:anywhere}',
    'body.mls-calm .mls-idmeta{margin-top:3px;font:500 13px/1.35 inherit;color:#5B6B62}',
    /* The action shrinks back to an action once the identity leaves it. */
    'body.mls-calm .ez3-big{line-height:1.25}',
    '#mlsRightNow .lbl{font:500 12px inherit;color:#8C978F;margin-right:2px}',
    '#mlsRightNow button{border:1px solid #DFE5E1;background:#fff;color:#204034;border-radius:12px;padding:9px 15px;',
    'font:500 13.5px inherit;cursor:pointer;opacity:0;transform:translateY(4px);',
    'animation:mlsRise var(--mls-base) var(--mls-spring) forwards;',
    'transition:transform var(--mls-fast) var(--mls-spring),box-shadow var(--mls-fast) linear,background var(--mls-fast) linear}',
    '#mlsRightNow button:hover{background:#F6FAF8;box-shadow:0 2px 8px rgba(20,35,28,.08)}',
    '#mlsRightNow button:active{transform:scale(.96)}',

    /* mdl-1.0.0 - give the popups the dock's motion.
       Owner: "I love that bottom bar make sure to add cool animations to
       everything". Every major modal in the app - ez2, ez3, Settings,
       Templates, Add patient, Op-note prep, Share, Countersign - had ZERO
       animation rules and jump-cut into place, which is why they feel like a
       different product from the shell.
       Deliberately opacity + a small translate on the CARD only, never on the
       fixed-position container: transforming a fixed ancestor re-parents its
       positioned children and would break centring and any nested popover.
       Under body.mls-calm only, so teardown removes it with the stylesheet. */
    '@keyframes mlsMdlIn{from{opacity:0}to{opacity:1}}',
    '@keyframes mlsMdlCard{from{opacity:0;transform:translateY(14px) scale(.985)}to{opacity:1;transform:none}}',
    'body.mls-calm .ez2-modal,body.mls-calm #mlsMPmodal,body.mls-calm #mlsAddPtModal,',
    'body.mls-calm #settingsModal,body.mls-calm #templatesModal,body.mls-calm #opPrepModal,',
    'body.mls-calm #shareModal,body.mls-calm #countersignModal,body.mls-calm #detailModal,',
    'body.mls-calm #docModal,body.mls-calm #helpModal,body.mls-calm #patientModal',
    '{animation:mlsMdlIn .18s ease both}',
    'body.mls-calm .ez3-modal-card,body.mls-calm .ez2-modal>*,body.mls-calm #settingsModal>*,',
    'body.mls-calm #templatesModal>*,body.mls-calm #opPrepModal>*,body.mls-calm #patientModal>*',
    '{animation:mlsMdlCard .26s cubic-bezier(.2,.7,.3,1) both}',
    '@media (prefers-reduced-motion:reduce){',
    'body.mls-calm .ez2-modal,body.mls-calm .ez3-modal-card,body.mls-calm #settingsModal,',
    'body.mls-calm #templatesModal,body.mls-calm #opPrepModal,body.mls-calm #patientModal,',
    'body.mls-calm .ez2-modal>*,body.mls-calm #settingsModal>*,body.mls-calm #templatesModal>*',
    '{animation:none!important}}',
    /* A '#mlsRightNow button small' rule lived here and was removed, not
       restyled. The symptom it targeted is real - the bar showed
       'Bledsoe9:40 AM' - but the rule could never fire: this bar does not
       reuse or re-render the ez3 button, it builds a new one and assigns
       b.textContent, so there is no <small> element in it to style. Verified
       live: #mlsRightNow contains zero <small> and zero .ez3-big.
       The collision comes from textContent welding the block-level <small>
       onto the name when the label is flattened, so the fix is a separator at
       label-derivation time - see controlLabel(). Do not add this rule back. */
    '#mlsRightNow button.primary{background:#2E6A4B;border-color:#2E6A4B;color:#fff}',
    '#mlsRightNow button.primary:hover{background:#357855}',
    /* .tools{margin-left:auto} lived here for the bar's own Tools chip, which
       b582 removed as a duplicate of the dock's. Out-specifies the base
       #mlsRightNow{display:flex} at (1,1,0) vs (1,0,0) — no !important, per the
       rule that a second !important never wins a specificity race. */
    '#mlsRightNow.empty{display:none}',
    '@keyframes mlsRise{to{opacity:1;transform:translateY(0)}}',
    '#mlsRightNow .note{font-size:12.5px;color:#8C978F}',
    '#mlsRightNow .seg{display:inline-flex;padding:3px;border-radius:12px;background:rgba(0,0,0,.045);gap:2px;margin-right:6px}',
    '#mlsRightNow .seg .segbtn{border:0;background:transparent;color:#5B6B62;border-radius:10px;padding:6px 12px;',
    'font:500 12.5px inherit;cursor:pointer;opacity:1;transform:none;animation:none}',
    '#mlsRightNow .seg .segbtn.on{background:#fff;color:#204034;box-shadow:0 1px 3px rgba(20,35,28,.10)}',
    '#mlsRightNow .seg .segbtn:hover{color:#204034;background:rgba(255,255,255,.6)}',

    /* stages */
    '#mlsStages{display:flex;align-items:center;gap:0;margin:0 0 14px;padding:2px}',
    '#mlsStages .st{display:flex;align-items:center;gap:7px;color:#9AA69E;font:500 12.5px inherit}',
    '#mlsStages .st .dot{width:15px;height:15px;border-radius:50%;border:1.6px solid #D6DED9;background:#fff;',
    'transition:transform var(--mls-base) var(--mls-spring),background var(--mls-base) linear,border-color var(--mls-base) linear}',
    '#mlsStages .st.done .dot{background:#2E6A4B;border-color:#2E6A4B;transform:scale(1.05)}',
    '#mlsStages .st.now .dot{border-color:#2E6A4B;box-shadow:0 0 0 4px rgba(46,106,75,.14);transform:scale(1.15)}',
    '#mlsStages .st.now{color:#204034}',
    '#mlsStages .st.done{color:#4A5B51}',
    '#mlsStages .bar{flex:1;height:1.6px;background:#E7E5DD;margin:0 9px;border-radius:2px;overflow:hidden}',
    '#mlsStages .bar i{display:block;height:100%;width:0;background:#2E6A4B;transition:width var(--mls-slow) var(--mls-spring)}',

    /* activity bar — honest: it shows work in flight, it never claims a result */
    '#mlsBusy{position:fixed;top:0;left:0;right:0;height:2.5px;z-index:960;pointer-events:none;opacity:0;',
    'transition:opacity var(--mls-base) linear}',
    '#mlsBusy.on{opacity:1}',
    /* The sweep runs ONLY while the bar is on. Leaving an infinite animation on a
       transparent element keeps the compositor awake for the whole clinic day and
       stops a laptop ever reaching an idle frame rate. */
    '#mlsBusy i{display:block;height:100%;width:38%;border-radius:0 2px 2px 0;',
    'background:linear-gradient(90deg,rgba(46,106,75,0),#2E6A4B 45%,#5FAF87)}',
    '#mlsBusy.on i{animation:mlsSweep 1.15s var(--mls-spring) infinite}',
    '@keyframes mlsSweep{0%{transform:translateX(-100%)}100%{transform:translateX(365%)}}',

    /* heads-down */
    'body.mls-headsdown #mlsRightNow,body.mls-headsdown #mlsStages,body.mls-headsdown #appHeader,',
    'body.mls-headsdown #mlsDock{opacity:.12;transform:translateY(2px);transition:opacity var(--mls-slow) var(--mls-spring),transform var(--mls-slow) var(--mls-spring)}',
    'body.mls-headsdown #mlsDock{transform:translateX(-50%) translateY(6px)}',
    '#mlsHeadsDownHint{position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:915;',
    'padding:7px 14px;border-radius:14px;background:rgba(26,33,28,.82);color:#fff;font:400 12.5px inherit;',
    'opacity:0;pointer-events:none;transition:opacity var(--mls-base) linear}',
    'body.mls-headsdown #mlsHeadsDownHint{opacity:1}',

    /* Clearance for surfaces that were already pinned to the bottom before this
       shell existed: the b532 resumable-pull countdown (#mlsPullResumeCard) and
       the recording backup badge (#_backupBadge). Both mount bottom-left with
       inline styles, and the dock spans the full width on narrow screens, so
       they are lifted rather than left to be covered. A stylesheet !important
       beats a non-important inline style, which is how these reach over their
       own positioning without either module writing to the other. */
    'body.mls-calm #mlsPullResumeCard{bottom:104px!important}',
    'body.mls-calm #_backupBadge{bottom:172px!important}',

    '#mlsNote{position:fixed;left:50%;bottom:96px;transform:translateX(-50%) translateY(6px);z-index:940;',
    'max-width:min(430px,88vw);padding:10px 15px;border-radius:14px;background:rgba(26,33,28,.9);color:#fff;',
    'font:400 12.5px/1.45 inherit;opacity:0;pointer-events:none;',
    'transition:opacity var(--mls-base) linear,transform var(--mls-base) var(--mls-spring)}',
    '#mlsNote.on{opacity:1;transform:translateX(-50%) translateY(0)}',

    /* view transition */
    'body.mls-calm .view-enter{animation:mlsViewIn var(--mls-base) var(--mls-spring)}',
    '@keyframes mlsViewIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}',

    '@media (prefers-reduced-motion: reduce){',
    '#mlsDock,#mlsRightNow button,#mlsAskResults,body.mls-calm .view-enter{animation-duration:1ms!important}',
    '#mlsBusy i{animation-duration:2s!important}',
    '*{transition-duration:1ms!important}}',

    '@keyframes mlsDockInM{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}',
    '@media (max-width:760px){',
    '#mlsDock{left:8px;right:8px;bottom:8px;transform:none;width:auto;animation-name:mlsDockInM}',
    '#mlsDock button{min-width:0;flex:1;padding:8px 4px 7px;font-size:10.5px}',
    /* Scoped by the dock id so it cannot lose a specificity tie to the base rule. */
    '#mlsDock #mlsDockAsk,#mlsDock #mlsDockAsk:focus{width:96px;flex:1 1 auto}',
    '#mlsDock #mlsDockAskWrap{flex:1 1 auto;min-width:0}',
    '#mlsDock #mlsDockClassic{padding:7px 8px;font-size:10.5px}',
    '#mlsAskResults{width:min(340px,86vw)}}'
  ].join('');

  function injectCss() {
    if (qs('#mlsCalmShellCss')) return;
    var s = D.createElement('style');
    s.id = 'mlsCalmShellCss';
    s.textContent = CSS;
    (D.head || D.documentElement).appendChild(s);
  }

  /* ------------------------------------------------------------------ icons */

  var ICON = {
    day: '<path d="M4 6.5A1.5 1.5 0 015.5 5h13A1.5 1.5 0 0120 6.5v12a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18.5z"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>',
    patient: '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 20a7.4 7.4 0 0114.4 0"/>',
    visit: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3"/>',
    review: '<path d="M6 3.8h9L19 8v12.2H6z"/><path d="M14.6 3.8V8H19M9 12.5h7M9 16h5"/>',
    tools: '<circle cx="12" cy="12" r="2.6"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4L6 18M18 18l-1.6-1.6M7.6 7.6L6 6"/>'
  };

  /* `targets` is tried in order and the first one the APP still offers wins.
     A rail tab the app gated off (inline display:none via navFeatOn, hidden,
     disabled) is never clicked — .click() fires on hidden elements, so routing
     the dock through a gated tab would quietly hand out a feature the account
     is not entitled to. A destination with nothing available hides itself. */
  var DEST = [
    { id: 'day', label: 'Day', targets: ['nav_calendar'] },
    { id: 'patient', label: 'Patient', targets: ['nav_patients', 'nav_history'], count: 'navPtCount' },
    { id: 'visit', label: 'Visit', targets: ['nav_visit'] },
    { id: 'review', label: 'Review', targets: ['nav_orders', 'nav_recs'], count: 'navOrdCount' },
    { id: 'tools', label: 'Tools', targets: ['nav_studio'], menu: true }
  ];

  /* Every target the app still offers for this destination. A destination that
     covers more than one view (Patient = chart + history, Review = orders +
     recommendations) renders them as a segmented row, because the reach map
     promises those views are reachable from the dock — and a promise the UI
     does not keep is exactly the feature loss this whole shell is guarding. */
  function destTargets(d) {
    return (d.targets || []).map(function (id) { return D.getElementById(id); })
      .filter(available);
  }

  function destTarget(d) {
    return destTargets(d)[0] || null;
  }

  /* Which rail tabs each destination covers — used to light the right dock item
     when navigation happens from somewhere else (a link, Ask, a module). */
  var DEST_TABS = {
    day: ['nav_calendar'],
    patient: ['nav_patients', 'nav_history'],
    visit: ['nav_visit'],
    review: ['nav_orders', 'nav_recs'],
    tools: ['nav_studio', 'nav_analysis', 'nav_team', 'nav_admin', 'nav_legalreq', 'nav_help', 'nav_staffpull']
  };

  /* ------------------------------------------------------------------- dock */

  var dockEl = null;

  function buildDock() {
    if (qs('#mlsDock')) return;
    var nav = D.createElement('nav');
    nav.id = 'mlsDock';
    nav.setAttribute('aria-label', 'Main');

    var pill = D.createElement('div');
    pill.className = 'mls-dock-pill';
    nav.appendChild(pill);

    DEST.forEach(function (d) {
      var b = D.createElement('button');
      b.type = 'button';
      b.setAttribute('data-dest', d.id);
      b.setAttribute('aria-label', d.label);
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[d.id] + '</svg><span>' + d.label + '</span>' +
        (d.count ? '<span class="mls-dock-count" data-count="' + d.count + '">0</span>' : '');
      b.addEventListener('click', function () { go(d.id); });
      nav.appendChild(b);
    });

    /* ONE Copilot button, replacing three floating pills (MLS Copilot Voice,
       MLS Assistant, Dictate) that stacked over the bottom of every screen.
       Nothing is lost: this opens the SAME Copilot those pills led to, and that
       card already contains its own mic (#copilotMicBtn), so voice and dictation
       live inside it rather than as two more things hovering over the app. */
    var cop = D.createElement('button');
    cop.id = 'mlsDockCopilot';
    cop.type = 'button';
    cop.title = 'MLS Copilot — ask anything, or use the mic inside';
    cop.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M12 3.6l1.9 4.7 4.7 1.9-4.7 1.9L12 16.8l-1.9-4.7L5.4 10.2l4.7-1.9z"/>' +
      '<path d="M18.4 15.6l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg><span>Copilot</span>';
    cop.addEventListener('click', openCopilot);
    nav.appendChild(cop);

    var askWrap = D.createElement('div');
    askWrap.id = 'mlsDockAskWrap';
    askWrap.innerHTML = '<input id="mlsDockAsk" type="text" autocomplete="off" spellcheck="false" ' +
      'placeholder="Ask or find anything" aria-label="Ask or find anything">' +
      '<div id="mlsAskResults" role="listbox" aria-label="Results"></div>';
    nav.appendChild(askWrap);

    /* No Classic control in the dock: this is the UI now, not a preview sitting
       next to the old one, and a permanent "go back" button is exactly the kind
       of button this shell exists to remove. The way out still exists for
       recovery - ?ui=classic, and the Classic layout entry at the bottom of the
       Tools menu - it just does not occupy the dock. */

    (D.body || D.documentElement).appendChild(nav);
    dockEl = nav;
    wireAsk();
    D.body.classList.add('mls-calm');
    syncDock();
  }

  /* ------------------------------------------------------------ tools menu */

  /* The shell hides the header buttons and the overflow rail tabs. Every one of
     them reappears here, clicking the real control. Without this menu those
     controls would be reachable only by typing their name in Ask, which the
     charter (and the coverage suite) forbid. */
  var TOOLS_SOURCES = [
    { id: 'nav_studio' }, { id: 'nav_analysis' }, { id: 'nav_team' },
    { id: 'nav_legalreq' }, { id: 'nav_admin' }, { id: 'nav_staffpull' }, { id: 'nav_help' },
    /* askCopilotHdrBtn is deliberately absent: Copilot now has its own dock
       button, and listing it here as well is the duplication we are removing. */
    /* "Patient intake" and "New patient" are DIFFERENT things and read as the
       same thing, so a doctor reaching for one lands in the other's UI. Named
       here for what each actually does; adding a patient stays a single flow,
       reached from Patients > New patient. */
    { id: 'mls-ask-btn', as: 'Ask your data' },
    /* b560 folded three floating pills into the dock's Copilot button and
       hid #mlsCopVoiceBtn, #mlsAsstFab and #mlsDaDock. That was right about the
       clutter and wrong about the reach: the dock's Copilot opens
       askCopilotHdrBtn, which is a DIFFERENT surface from Copilot Voice, the
       Assistant panel, and dictate-into-the-transcript. Their only remaining
       route was the ez3 chips on the Visit screen, so on every other screen
       three capabilities had no reach at all. The coverage suite never caught
       it because these ids are not in the inventory.
       Reading the chip handlers is what surfaced this - I had been about to
       fold the chips as duplicates, which would have stranded all three. */
    { id: 'mlsCopVoiceBtn', as: 'Copilot Voice' },
    { id: 'mlsAsstFab', as: 'MLS Assistant' },
    { id: 'mlsDaDock', as: 'Dictate' },
    { id: 'mlsPdpSel', as: 'Where pulls run' },
    { id: 'mlsDsVisitBodies', as: 'Full visit notes' },
    { id: 'intakeBtn', as: 'Pre-visit intake forms' },
    { id: 'customWidgetHdrBtn' },
    { label: /^templates$/i, within: '#appHeader' },
    { label: /^settings$/i, within: '#appHeader' },
    { label: /^log out$/i, within: '#appHeader' },
    /* Relocated off the patient header — see PT_MOVED. */
    { label: /^schedule$/i, within: '#profileCard' },
    { label: /^draft op note$/i, within: '#profileCard' },
    { label: /^share \/ export$/i, within: '#profileCard' },
    { label: /^export everything for emr$/i, within: '#profileCard' },
    { label: /^verify saved data$/i, within: '#profileCard' },
    { label: /^copy every visit from athenaone$/i, within: '#profileCard' },
    { label: /^add a visit$/i, within: '#profileCard' },
    /* Only Snapshot is relocated off the context bar — see CTX_MOVED. After-visit
       summary and Patient portal stay on the bar, so they are deliberately NOT
       listed here; offering them in both places is the duplication this removes. */
    { label: /^snapshot$/i, within: '#patientBar,#mlsCtxBar' }
  ];

  /* ------------------------------------------------ trusted-gesture controls */

  /* Some controls may only be operated by a REAL human gesture. `isTrusted` is
     set by the browser and cannot be forged — that is the entire point — so a
     shell that delegates with el.click() can never drive them:
       ScribeFlow.html:16617  startPhoneMic        refuses SILENTLY
       mls-connect.js         startPhoneMicFromEasy refuses SILENTLY
       feat_mls_exact_encounter_verify.js:554       refuses audibly
     The fix is architectural, not a workaround: these are SHOWN, never fired.
     Never synthesize an event and never weaken a guard to make a proxy work —
     the guards exist so that nothing scripted can start a recording or drive a
     clinical action. Treat anything that starts a recording, verifies an
     encounter, or writes to Athena as gated even if it is not yet, because the
     guard may be added later and would silently break a proxy. */
  var TRUSTED_GATED_IDS = ['phoneMicBtn', 'phoneMicStopBtn', 'mlsSyncVerifyNow'];
  var TRUSTED_GATED_LABEL = /record on phone|phone mic|exact encounter|verify (this )?encounter/i;

  function trustedGated(el) {
    if (!el) return false;
    if (el.id && TRUSTED_GATED_IDS.indexOf(el.id) !== -1) return true;
    if (TRUSTED_GATED_LABEL.test(textOf(el))) return true;
    if (el.closest && el.closest('#phoneMicPanel')) return true;
    return false;
  }

  function spotlight(el) {
    if (!el) return;
    safe(function () { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    safe(function () {
      var prev = el.style.boxShadow;
      el.style.boxShadow = '0 0 0 3px rgba(46,106,75,.55)';
      setTimeout(function () { el.style.boxShadow = prev; }, 2400);
    });
  }

  function note(msg) {
    var n = qs('#mlsNote');
    if (!n) {
      n = D.createElement('div');
      n.id = 'mlsNote';
      n.setAttribute('role', 'status');
      n.setAttribute('aria-live', 'polite');
      (D.body || D.documentElement).appendChild(n);
    }
    n.textContent = msg;
    n.classList.add('on');
    if (n.__t) clearTimeout(n.__t);
    n.__t = setTimeout(function () { n.classList.remove('on'); }, 5000);
  }

  /* One place, so the bar, the Tools menu and Ask cannot drift apart. Returns
     true when it handled the control itself (gated -> shown, not fired). */
  function runControl(el) {
    if (!el) return true;
    if (trustedGated(el)) {
      spotlight(el);
      note('That one has to be pressed directly — the app only accepts a real click there. It is highlighted for you.');
      return true;
    }
    busyMaybe(textOf(el));
    spotlight(el);
    el.click();
    setTimeout(function () { safe(syncDock); safe(renderRightNow); safe(renderStages); }, 280);
    return true;
  }

  /* Availability, not visibility: these are hidden BY THIS SHELL, so offsetWidth
     would report every one of them as gone. What matters is whether the app
     itself gated them (inline display:none, hidden, disabled). */
  function available(el) {
    if (!el) return false;
    if (el.hidden || el.disabled) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    if (el.style && el.style.display === 'none') return false;
    return true;
  }

  function toolsItems() {
    var out = [];
    TOOLS_SOURCES.forEach(function (spec) {
      var el = null;
      if (spec.id) {
        el = D.getElementById(spec.id);
      } else {
        var root = qs(spec.within);
        if (root) {
          qsa('button,.navtab', root).some(function (b) {
            if (!available(b) || !spec.label.test(textOf(b))) return false;
            el = b;
            return true;
          });
        }
      }
      if (available(el) && textOf(el)) out.push({ el: el, label: spec.as || controlLabel(el) });
    });
    return out;
  }

  var toolsClose = null;

  function openTools(anchorBtn) {
    if (toolsClose) { toolsClose(); return; }
    var existing = qs('#mlsToolsMenu');
    if (existing && existing.parentNode) { existing.parentNode.removeChild(existing); return; }
    var anchor = anchorBtn || qs('#mlsDock button[data-dest="tools"]') || dockEl;
    if (!anchor) return;
    var menu = D.createElement('div');
    menu.id = 'mlsToolsMenu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Tools');
    var items = toolsItems();
    menu.innerHTML = items.map(function (it, i) {
      return '<div class="r" role="menuitem" tabindex="0" data-i="' + i + '">' +
        it.label.replace(/[<>&]/g, '') + '</div>';
    }).join('') + '<div class="sep"></div>' +
      '<div class="r classic" role="menuitem" tabindex="0" data-classic="1">Classic layout</div>';
    (D.body || D.documentElement).appendChild(menu);

    var rect = anchor.getBoundingClientRect();
    menu.style.left = Math.max(10, Math.min(rect.left - 40, W.innerWidth - menu.offsetWidth - 10)) + 'px';
    menu.style.bottom = (W.innerHeight - rect.top + 10) + 'px';

    function close() {
      if (menu.parentNode) menu.parentNode.removeChild(menu);
      D.removeEventListener('click', away, true);
      toolsClose = null;
    }
    toolsClose = close;
    /* contains(), not identity: the click lands on the icon or the label inside
       the button, so `e.target !== anchorBtn` closed the menu and the same click
       then reopened it — the Tools button could never toggle itself shut. */
    function away(e) { if (!menu.contains(e.target) && !anchor.contains(e.target)) close(); }
    function esc(e) { if (e.key === 'Escape') { close(); safe(function () { anchor.focus(); }); } }
    setTimeout(function () { D.addEventListener('click', away, true); }, 0);
    menu.addEventListener('keydown', esc);
    safe(function () { var first = qs('.r', menu); if (first) first.focus(); });

    qsa('.r', menu).forEach(function (row) {
      row.addEventListener('click', function () {
        if (row.getAttribute('data-classic')) {
          safe(function () { localStorage.setItem(STORE_KEY, '0'); });
          close();
          teardown();
          /* Offer the way back in the same gesture. Not inside teardown(),
             which also runs on the boot error path, where re-offering the
             shell that just threw would invite a loop. */
          safe(mountReturn);
          return;
        }
        var it = items[parseInt(row.getAttribute('data-i'), 10)];
        close();
        if (!it) return;
        runControl(it.el);
      });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
      });
    });
  }

  /* Opens the canonical Copilot by clicking the control the app already owns,
     falling back to the global opener only if that control is absent. We call
     openCopilotDock, we never WRAP it - wrapping it has caused re-entrancy
     trouble in this app before. */
  function openCopilot() {
    var btn = D.getElementById('askCopilotHdrBtn');
    if (available(btn)) { runControl(btn); return; }
    safe(function () { if (typeof W.openCopilotDock === 'function') W.openCopilotDock(); });
  }

  /* Navigation delegates to the real rail tab. The rail is the single owner. */
  function go(destId) {
    if (destId === 'tools') {
      openTools(qs('#mlsDock button[data-dest="tools"]'));
      return;
    }
    var d = null;
    DEST.forEach(function (x) { if (x.id === destId) d = x; });
    if (!d) return;
    var tab = destTarget(d);
    if (!tab) return;
    tab.click();
    markViewEnter();
    /* Re-run AFTER the view has actually switched. The document-level click hook
       fires in capture phase - before showView() reveals the new view - so a
       screen that produces no further mutations (a loaded patient profile is
       static) would never get its first pass. Two delayed passes cover the
       switch and anything that fills in just after it; schedule() coalesces to
       one rAF and every renderer skips unchanged work. */
    safe(schedule);
    setTimeout(function () { safe(schedule); }, 140);
    setTimeout(function () { safe(schedule); }, 600);
  }

  /* Every rail tab, by id. Scoping the "which view am I on" read to
     `.mainnav .navtab.on` was wrong: modules relocate individual tabs out of the
     rail (b521 folded History out; #nav_orders lives elsewhere), so the dock lit
     nothing and the right-now bar reported "Nothing to do here yet" on a screen
     full of actions. Ask the tabs directly, wherever they have been moved to. */
  var ALL_NAV_IDS = ['nav_calendar', 'nav_patients', 'nav_visit', 'nav_orders', 'nav_recs',
    'nav_history', 'nav_studio', 'nav_analysis', 'nav_team', 'nav_admin', 'nav_legalreq',
    'nav_help', 'nav_staffpull'];

  function currentTabId() {
    var found = '';
    ALL_NAV_IDS.some(function (id) {
      var el = D.getElementById(id);
      if (el && el.classList && el.classList.contains('on')) { found = id; return true; }
      return false;
    });
    if (!found) { var on = qs('.navtab.on'); found = on ? on.id : ''; }
    return found;
  }

  function currentDest() {
    var tab = currentTabId();
    var found = '';
    Object.keys(DEST_TABS).forEach(function (dest) {
      if (DEST_TABS[dest].indexOf(tab) !== -1) found = dest;
    });
    return found;
  }

  function syncDock() {
    if (!dockEl) return;
    var active = currentDest();
    var pill = qs('.mls-dock-pill', dockEl);
    var activeBtn = null;
    qsa('button[data-dest]', dockEl).forEach(function (b) {
      var id = b.getAttribute('data-dest');
      var d = null;
      DEST.forEach(function (x) { if (x.id === id) d = x; });
      /* Tools is a menu over whatever is still offered, so it never disappears;
         a navigation destination disappears when the app gated its view off. */
      var offered = d && (d.menu || destTarget(d));
      b.style.display = offered ? '' : 'none';
      var on = offered && id === active;
      b.classList.toggle('on', !!on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
      if (on) activeBtn = b;
    });
    if (pill && activeBtn) {
      pill.style.width = activeBtn.offsetWidth + 'px';
      pill.style.transform = 'translateX(' + (activeBtn.offsetLeft - 6) + 'px)';
      pill.style.opacity = '1';
    } else if (pill) {
      pill.style.opacity = '0';
    }
    qsa('.mls-dock-count', dockEl).forEach(function (c) {
      var src = D.getElementById(c.getAttribute('data-count'));
      var n = src ? parseInt(textOf(src), 10) : 0;
      if (!isFinite(n) || n <= 0) { c.classList.remove('show'); return; }
      c.textContent = n > 99 ? '99+' : String(n);
      c.classList.add('show');
    });
  }

  function markViewEnter() {
    var v = qsa('#appWrap > div').filter(function (el) {
      return /View$/.test(el.id || '') && visible(el);
    })[0];
    if (!v) return;
    v.classList.remove('view-enter');
    void v.offsetWidth;
    v.classList.add('view-enter');
  }

  /* -------------------------------------------------------- right-now bar */

  /* Per-destination action priority. Each entry names a real control: by id, or
     by a label pattern scoped to a container. Absent control -> absent action,
     which is the charter rule (illegal actions are absent, not disabled). */
  var ACTIONS = {
    /* With a patient open, the one thing a doctor is here to do is start the
       visit. Everything else that used to crowd the profile header moves to the
       Tools menu. With no patient open, the list actions are what matter. */
    patient: [
      { label: /^start visit$/i, within: '#profileCard', primary: true, moved: true },
      { id: 'ptNewBtn', primary: true },
      { id: 'ptPullAthenaBtn' },
      { id: 'ptIntakeBtn' }
    ],
    /* Applying a date range turns the calendar into a flat list of every
       appointment in it - 600 rows - and the way back is a button labelled
       "Clear", fifth in a row of eight. That is how you get stuck on a screen
       with no visible exit. The exit now comes first, and says where it goes.
       Refresh is deliberately NOT here: it was what this bar used to offer, and
       it is the least useful control on the screen. */
    day: [
      { label: /^clear$/i, within: '#calendarView', as: 'Back to the calendar', primary: true },
      { label: /^\+?\s*new appointment$/i, as: 'New appointment' },
      { label: /^pull plan$/i, within: '#calendarView' },
      { label: /^check in to the office$/i, within: '#calendarView', as: 'Check in' },
      { id: 'ptBoardBtn' }
    ],
    visit: [
      { label: /^(start|record|begin)/i, within: '#visitView', primary: true },
      { label: /\bstop\b/i, within: '#visitView', primary: true },
      { label: /^(pause|resume)/i, within: '#visitView' },
      { label: /^generate/i, within: '#visitView', primary: true },
      { label: /^(sign|save to athena|send to athena)/i, within: '#visitView', primary: true }
    ],
    review: [
      { label: /^(add|new) order/i, within: '#ordersView', primary: true },
      { label: /^(review|place)/i, within: '#ordersView' },
      { label: /^(print|pdf|save as pdf)/i, within: '#ordersView' }
    ],
    tools: [
      { label: /^(new|create)/i, within: '#studioView', primary: true }
    ]
  };

  /* `moved` means THIS SHELL hid the control (PT_MOVED), so visibility is not
     the right test - availability is. Without it, relocating a control off the
     patient header would also delete it from the bar that now owns it. It is
     never used to surface something the APP gated off. */
  function findControl(spec) {
    var ok = spec.moved ? available : visible;
    if (spec.id) {
      var el = D.getElementById(spec.id);
      return ok(el) ? el : null;
    }
    var root = spec.within ? qs(spec.within) : D;
    if (!root) return null;
    var hit = null;
    qsa('button,.btn-primary,.btn-ghost,.btn-green', root).some(function (b) {
      if (!ok(b)) return false;
      if (!spec.label.test(textOf(b))) return false;
      hit = b;
      return true;
    });
    return hit;
  }

  function ensureRightNow() {
    var bar = qs('#mlsRightNow');
    if (bar) return bar;
    var wrap = qs('#appWrap');
    if (!wrap) return null;
    bar = D.createElement('div');
    bar.id = 'mlsRightNow';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Right now');
    var anchor = qs('#patientBar') || qs('.mainnav');
    if (anchor && anchor.parentNode === wrap) wrap.insertBefore(bar, anchor.nextSibling);
    else wrap.insertBefore(bar, wrap.firstChild);
    return bar;
  }

  var lastRnSig = '';

  function renderRightNow() {
    if (!W.__mlsCalmShell.active) return;
    var bar = ensureRightNow();
    if (!bar) return;
    var dest = currentDest() || 'patient';
    var specs = ACTIONS[dest] || [];
    var picked = [];
    specs.forEach(function (spec) {
      if (picked.length >= 3) return;
      var el = findControl(spec);
      if (!el) return;
      var dup = picked.some(function (p) { return p.el === el; });
      /* spec.as re-labels a control for the bar without touching the control
         itself. "Clear" is accurate in its own row and meaningless out of it. */
      if (!dup) picked.push({ el: el, primary: !!spec.primary, as: spec.as || '' });
    });

    var destDef = null;
    DEST.forEach(function (x) { if (x.id === dest) destDef = x; });
    var sibs = destDef ? destTargets(destDef) : [];

    /* Re-render only when the bar would actually change. The visit view mutates
       continuously while a transcript streams in, and rebuilding on every one of
       those would restart each button's entrance animation 60 times a second —
       a flickering toolbar in front of a doctor mid-recording. */
    var sig = dest + '|' +
      sibs.map(function (t) { return t.id + (t.classList.contains('on') ? '*' : ''); }).join(',') + '|' +
      picked.map(function (p) { return (p.as || controlLabel(p.el)) + (p.primary ? '!' : ''); }).join(',');
    if (sig === lastRnSig && bar.childNodes.length) return;
    lastRnSig = sig;

    /* Rebuilding the bar destroys whatever the keyboard was on and drops focus
       to <body>. A keyboard user who presses Enter on "Start recording" would
       lose their place the moment the label set changes. Remember and restore. */
    var hadFocus = (D.activeElement && bar.contains(D.activeElement)) ? textOf(D.activeElement) : null;

    bar.innerHTML = '';

    /* b582: with no actions AND no segmented tabs, this bar still rendered 59px
       of chrome whose entire content was the word "Right now", the sentence
       "Nothing to do here yet", and a Tools button that opened the very same
       menu as the dock's Tools. An empty strip is not information. It hides,
       and returns the moment an action exists. Segments are navigation, so a
       bar that still has tabs keeps rendering even with no actions. */
    var empty = !picked.length && sibs.length <= 1;
    bar.classList.toggle('empty', empty);
    if (empty) return;

    if (sibs.length > 1) {
      var seg = D.createElement('span');
      seg.className = 'seg';
      seg.setAttribute('role', 'tablist');
      sibs.forEach(function (tab) {
        var s = D.createElement('button');
        s.type = 'button';
        s.className = 'segbtn' + (tab.classList.contains('on') ? ' on' : '');
        s.setAttribute('role', 'tab');
        s.setAttribute('aria-selected', tab.classList.contains('on') ? 'true' : 'false');
        s.textContent = controlLabel(tab).replace(/\s*\d+$/, '');
        s.addEventListener('click', function () {
          tab.click();
          markViewEnter();
          setTimeout(function () { safe(syncDock); safe(renderRightNow); safe(renderStages); }, 60);
        });
        seg.appendChild(s);
      });
      bar.appendChild(seg);
    }

    var lbl = D.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = 'Right now';
    bar.appendChild(lbl);

    if (!picked.length) {
      var note = D.createElement('span');
      note.className = 'note';
      note.textContent = 'Nothing to do here yet';
      bar.appendChild(note);
    }

    picked.forEach(function (p, i) {
      var b = D.createElement('button');
      b.type = 'button';
      b.textContent = p.as || controlLabel(p.el);
      /* controlLabel, not textOf: `as` re-labels the button, and this tooltip is
         the only place the doctor is told which real control it runs. textOf
         would put the welded string back into the one surface that exists to
         explain the button — "Runs "Pull from AthenaOpens this patient's chart
         in your signed-in Athena tab (read-on..." — hidden text and all. */
      if (p.as) b.title = 'Runs "' + controlLabel(p.el) + '" on this screen';
      if (p.primary && i === 0) b.className = 'primary';
      b.style.animationDelay = (i * 45) + 'ms';
      b.addEventListener('click', function () { runControl(p.el); });
      bar.appendChild(b);
    });

    /* The Tools chip that lived here was removed in b582. It was appended
       unconditionally and called the same openTools() as the dock's Tools
       button, so every screen in every mode carried two visible controls with
       an identical label and identical behaviour — measured live at b581 as the
       one remaining duplicate visible label. The dock's Tools is persistent and
       is now the single route to that menu; nothing became unreachable. */

    if (hadFocus) {
      qsa('button', bar).some(function (b) {
        if (textOf(b) !== hadFocus) return false;
        safe(function () { b.focus(); });
        return true;
      });
    }
  }

  /* ---------------------------------------------------- prep summary rows */

  /* The doctor prep summary printed a wall of pre-wrap text under the cards:
     ALLERGIES / PROBLEMS / MEDICATIONS / VITALS / HISTORY / LAST VISIT. That
     text is NOT redundant - it is the only place those fields appear - so it is
     rendered as rows instead of hidden.

     Two rules it enforces:
     - An empty field is "—", never "None recorded". The app cannot tell "the
       chart says none" from "we never read that card", and printing a clinical
       negative it cannot back is the same defect that lost patient rows.
     - The raw text stays in the DOM (clipped, not display:none) so the existing
       Copy button, which reads rendered text, keeps producing exactly what it
       always did. Nothing here rewrites another module's output. */
  var PREP_LABELS = ['ALLERGIES', 'PROBLEMS', 'MEDICATIONS', 'VITALS', 'HISTORY', 'LAST VISIT'];
  var PREP_EMPTY = /^(none recorded|not recorded|none flagged|none|n\/a|unknown|-|—)?$/i;

  function prepRows() {
    var box = qs('#mlsEpSummaryBox .body');
    if (!box) return;
    var raw = box.textContent || '';
    if (raw.indexOf('PREP SUMMARY') === -1) return;

    /* Parse by label boundary, NOT by line. textContent returns this block with
       no newlines at all - the labels run straight together, e.g.
       "...Sample follow-upALLERGIES: No sample allergies documentedPROBLEMS:..."
       so an anchored ^LABEL:...$ per line matched nothing on real data. Each
       value therefore runs until the next known label or the end of the text. */
    var NEXT = PREP_LABELS.concat(['KEY RISKS / REMINDERS', 'KEY RISKS'])
      .map(function (l) { return l.replace(/\//g, '\\/').replace(/ /g, '\\s*'); }).join('|');
    var found = [];
    PREP_LABELS.forEach(function (label) {
      var re = new RegExp(label.replace(/ /g, '\\s*') + '\\s*:\\s*([\\s\\S]*?)(?=(?:' + NEXT + ')\\s*:|$)', 'i');
      var m = re.exec(raw);
      if (!m) return;
      var v = (m[1] || '').replace(/\s+/g, ' ').trim();
      /* LAST VISIT carries an entire note - 'SAMPLE NOTE ... Subjective: ...
         Objective: ... Assessment: ...' - which rendered as a 313px wall of
         text inside a summary row. A summary shows the first line and offers
         the rest on hover; the full text stays in the raw block for Copy. */
      var full = v;
      if (v.length > 150) v = v.slice(0, 150).replace(/\s+\S*$/, '') + '…';
      found.push({ label: label, value: v, full: full });
    });
    /* Fallback by construction: if the generated format ever changes and we
       cannot read at least three fields, leave the original display alone. */
    if (found.length < 3) return;

    var host = qs('#mlsPrepRows');
    var sig = found.map(function (f) { return f.label + '=' + f.value; }).join('|');
    if (host && host.getAttribute('data-sig') === sig) return;
    if (!host) {
      host = D.createElement('div');
      host.id = 'mlsPrepRows';
      box.parentNode.insertBefore(host, box);
    }
    host.setAttribute('data-sig', sig);
    /* The rows now carry this content in a readable shape, so the raw block
       underneath is the same text a second time - about 500px of it. Marked
       rather than removed: the box keeps its own Copy control, the rows keep
       the full text in title=, and teardown drops the class with the shell. */
    if (found.length) box.classList.add('mls-dup');
    host.innerHTML = found.map(function (f) {
      var empty = PREP_EMPTY.test(f.value);
      var val = empty
        ? '<span class="v none" title="Not captured. This does not mean the chart is empty - re-pull to check.">—</span>'
        : '<span class="v" title="' + String(f.full || f.value).replace(/[<>&"]/g, '').slice(0, 600) +
          '">' + f.value.replace(/[<>&]/g, '') + '</span>';
      return '<div class="r"><span class="k">' + f.label.toLowerCase() + '</span>' + val + '</div>';
    }).join('');

    box.classList.add('mls-raw-clipped');
  }

  /* ------------------------------------------------------- patient screen */

  /* The patient profile stacked FOURTEEN fully-expanded blocks - prep summary,
     visit context, risks, problems, insurance, documents, outside records,
     timeline, export, trend chart - all open, all competing. Before walking into
     a room a doctor needs four things: who this is, why they are here, what is
     dangerous, and what is wrong with them. Everything else is real, but it is
     reference: it becomes one quiet line that opens on demand.
     Nothing is removed - every folded block keeps its own heading as the click
     target, so its controls stay one click away and keep their 'panel' reach. */
  var PT_KEEP_OPEN = ['mlsEpTopBox', 'mlsEpRisksBox', 'mlsEpSummaryBox'];
  var PT_KEEP_OPEN_TEXT = /problem list/i;

  function foldTitle(block) {
    var head = block.children[0];
    return head ? textOf(head).slice(0, 60) : '';
  }

  /* Eight actions competed at the top of one patient. These move: Start visit
     becomes the right-now bar's primary, the rest go to the Tools menu (which
     matches on availability, so a control hidden by THIS shell is still
     offered). Marked with a class rather than a blanket CSS rule so only the
     controls actually relocated are hidden - anything new that appears in that
     header keeps showing until someone decides where it belongs. */
  var PT_MOVED = /^(start visit|schedule|draft op note|share \/ export|export everything for emr|verify saved data|copy every visit from athenaone|add a visit)$/i;

  /* ONLY Snapshot moves. It is not broken - it renders real patient data - it
     is a duplicate of the bar it sits on: that bar already names the patient
     Snapshot would describe, and both of its actions (Open chart, Start visit)
     are already on screen.
     After-visit summary and Patient portal STAY. They are distinct features a
     doctor reaches for, and burying a real feature in a menu reads as deleting
     it. Thinning a busy bar is not the same as removing what it is for. */
  var CTX_MOVED = /^snapshot$/i;

  function contextBar() {
    if (!W.__mlsCalmShell.active) return;
    var bar = qs('#patientBar,#mlsCtxBar');
    if (!bar) return;
    qsa('button,.btn-ghost,.btn-white', bar).forEach(function (b) {
      if (!CTX_MOVED.test(textOf(b))) return;
      b.classList.add('mls-moved');
    });
  }

  function patientScreen() {
    if (!W.__mlsCalmShell.active) return;
    var card = qs('#profileCard');
    if (!card || !visible(card)) return;

    qsa('button,.btn-primary,.btn-ghost,.btn-green', card).forEach(function (b) {
      if (b.closest && b.closest('#mlsPrepRows,#mlsRightNow')) return;
      if (!PT_MOVED.test(textOf(b))) return;
      b.classList.add('mls-moved');
    });

    wireFolds();

    /* Re-assert the click target on blocks already folded, in case they
       re-rendered their heading since the last pass. */
    qsa('.mls-fold', card).forEach(markFoldHead);

    qsa(':scope > div, :scope > section', card).forEach(function (block) {
      if (block.id === 'mlsPrepRows') return;
      if (PT_KEEP_OPEN.indexOf(block.id) !== -1) return;
      if (PT_KEEP_OPEN_TEXT.test(foldTitle(block))) return;
      if (block.children.length < 2) return;          /* nothing to fold */
      if (block.classList.contains('mls-fold')) return;
      var title = foldTitle(block);
      if (!title) return;

      block.classList.add('mls-fold');
      markFoldHead(block);
    });
  }

  /* Re-applied every pass, because blocks like Visit history and the trend chart
     re-render themselves and REPLACE their heading. The class alone is not the
     problem - the CSS keeps hiding the body either way - the danger is losing
     the click target, which would leave a block collapsed and un-openable. */
  function markFoldHead(block) {
    var head = block.children[0];
    if (!head || head.classList.contains('mls-fold-hd')) return;
    head.classList.add('mls-fold-hd');
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.setAttribute('aria-expanded', block.classList.contains('mls-open') ? 'true' : 'false');
  }

  /* ONE delegated listener on the card, not one per heading, so a re-rendered
     heading is still clickable without re-binding anything. */
  function wireFolds() {
    var card = qs('#profileCard');
    if (!card || card.__mlsFoldWired) return;
    card.__mlsFoldWired = true;
    card.addEventListener('click', function (e) {
      var head = e.target.closest && e.target.closest('.mls-fold-hd');
      if (!head) return;
      var block = head.parentElement;
      if (!block || !block.classList.contains('mls-fold')) return;
      /* The block's own controls keep working normally. */
      if (e.target.closest('button,a,input,select,textarea')) return;
      var open = block.classList.toggle('mls-open');
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    card.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var head = e.target.closest && e.target.closest('.mls-fold-hd');
      if (!head) return;
      e.preventDefault();
      head.click();
    });
  }

  /* ----------------------------------------------------------------- stages */

  var STAGES = ['Prep', 'Record', 'Review', 'Sign', 'Send'];

  /* Stage is READ from the view, never assumed. A stage never advances on a
     guess: if the app has not produced the evidence for a stage, we do not
     claim it. */
  function stageNow() {
    var visit = qs('#visitView');
    if (!visit || !visible(visit)) return -1;
    /* Not anchored: the live control reads "Recording… Stop Visit", so `^stop`
       never matched and the Record stage — and with it heads-down — could never
       be detected at all. */
    var stopping = findControl({ label: /\bstop\b/i, within: '#visitView' });
    if (stopping) return 1;
    var signable = findControl({ label: /^(sign|save to athena|send to athena)/i, within: '#visitView' });
    var noteText = '';
    var ta = qsa('textarea,[contenteditable="true"]', visit).filter(visible)[0];
    if (ta) noteText = (ta.value || ta.textContent || '').trim();
    if (signable && noteText.length > 40) return 3;
    if (noteText.length > 40) return 2;
    return 0;
  }

  function ensureStages() {
    var visit = qs('#visitView');
    if (!visit) return null;
    var el = qs('#mlsStages');
    if (!el) {
      el = D.createElement('div');
      el.id = 'mlsStages';
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', 'Visit progress');
      el.setAttribute('aria-live', 'polite');
    }
    /* POSITION, not just parentage. The old guard was
         if (el && el.parentNode === visit) return el;
       which is satisfied by a rail sitting anywhere inside the view - and
       #mlsEz3 inserts itself at the top AFTER we mount, so the measured live
       order was #mlsEz3 (1255px tall) and only THEN "Prep - Record - Review -
       Sign". A progress rail 1,255 pixels below the fold is not a progress
       rail. Owner: "THE PREP RECORD REVIEW THING ON THE VIST PAGE IS COMPLETLY
       IN THE WRONG SPOT AS THE TOP EAYS PARTY IS THE MOVE."
       Re-asserted every pass, because ez3 re-inserts itself on its own
       schedule and winning the race once is not the same as staying first. */
    if (visit.firstElementChild !== el) visit.insertBefore(el, visit.firstElementChild);
    return el;
  }

  var lastStage = -2;

  function renderStages() {
    if (!W.__mlsCalmShell.active) return;
    var visit = qs('#visitView');
    var el = qs('#mlsStages');
    if (!visit || !visible(visit)) { if (el) el.style.display = 'none'; return; }
    el = ensureStages();
    if (!el) return;
    el.style.display = 'flex';
    var now = stageNow();
    if (now === lastStage && el.childNodes.length) return;
    lastStage = now;

    var parts = [];
    STAGES.forEach(function (name, i) {
      var cls = i < now ? 'done' : (i === now ? 'now' : '');
      parts.push('<span class="st ' + cls + '"><span class="dot"></span>' + name + '</span>');
      if (i < STAGES.length - 1) {
        parts.push('<span class="bar"><i style="width:' + (i < now ? 100 : 0) + '%"></i></span>');
      }
    });
    el.innerHTML = parts.join('');
    if (now >= 0) el.setAttribute('aria-label', 'Visit progress: ' + STAGES[now]);
  }

  /* ------------------------------------------------------------- heads-down */

  var idleTimer = null;

  function headsDownOn() {
    return safe(function () { return localStorage.getItem(HEADSDOWN_KEY) !== '0'; }) !== false;
  }

  function ensureHint() {
    if (qs('#mlsHeadsDownHint')) return;
    var h = D.createElement('div');
    h.id = 'mlsHeadsDownHint';
    h.textContent = 'Recording — move the mouse or press any key to bring the controls back';
    (D.body || D.documentElement).appendChild(h);
  }

  function wake() {
    if (D.body.classList.contains('mls-headsdown')) D.body.classList.remove('mls-headsdown');
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    if (!headsDownOn()) return;
    if (stageNow() !== 1) return;
    idleTimer = setTimeout(function () {
      idleTimer = null;
      if (stageNow() === 1) { ensureHint(); D.body.classList.add('mls-headsdown'); }
    }, 3000);
  }

  /* wake() runs stageNow(), which scans the visit view and reads its note text.
     Bound to raw mousemove and keydown that is a forced layout read per candidate
     button on EVERY event — 60-125 times a second while a transcript streams, on
     top of the per-frame work. That is the exact layout-thrash profile behind
     this app's earlier freeze incidents. Restoring the chrome stays instant (a
     single classList read); only the expensive re-arm is throttled, and 300ms is
     invisible against the 3s idle window. */
  var lastWakeScan = 0;

  function onMove() {
    if (D.body.classList.contains('mls-headsdown')) { lastWakeScan = Date.now(); wake(); return; }
    var t = Date.now();
    if (t - lastWakeScan < 300) return;
    lastWakeScan = t;
    wake();
  }

  /* The observer must never count as user activity. #visitView churns on every
     transcript chunk, so routing mutations into wake() re-armed the countdown
     from zero forever and heads-down could never engage in the one flow it was
     written for. Mutations may START a countdown; only real input cancels one. */
  function arm() {
    if (idleTimer) return;
    if (D.body.classList.contains('mls-headsdown')) return;
    if (!headsDownOn()) return;
    if (stageNow() !== 1) return;
    idleTimer = setTimeout(function () {
      idleTimer = null;
      if (stageNow() === 1) { ensureHint(); D.body.classList.add('mls-headsdown'); }
    }, 3000);
  }

  /* --------------------------------------------------------------- activity */

  var busyTimer = null;

  function ensureBusy() {
    var b = qs('#mlsBusy');
    if (b) return b;
    b = D.createElement('div');
    b.id = 'mlsBusy';
    b.setAttribute('role', 'status');
    b.setAttribute('aria-live', 'polite');
    b.innerHTML = '<i></i>';
    (D.body || D.documentElement).appendChild(b);
    return b;
  }

  /* Deliberately an ACTIVITY bar, not a completion bar. We cannot observe when
     someone else's async work truly finished, so we never draw a percentage we
     would be inventing. It runs while work is plausibly in flight and fades. */
  function busy(on, ms) {
    var b = ensureBusy();
    if (busyTimer) { clearTimeout(busyTimer); busyTimer = null; }
    if (!on) { b.classList.remove('on'); return; }
    b.classList.add('on');
    busyTimer = setTimeout(function () { b.classList.remove('on'); }, ms || 9000);
  }

  function busyMaybe(label) {
    if (/pull|import|generate|sign|send|refresh|save|search/i.test(label || '')) busy(true, 12000);
  }

  /* -------------------------------------------------------------------- ask */

  /* Ask indexes the LIVE DOM rather than a build-time list, so it cannot go
     stale: whatever control is on screen is what Ask can reach. */
  /* Two rules here are patient-safety rules, not tidiness:
     1. ONLY VISIBLE CONTROLS. Indexing hidden views meant typing "record" could
        click a Record button belonging to whichever patient happened to be first
        in the patient list — silently switching the active chart and opening a
        visit on the wrong patient.
     2. AMBIGUOUS LABELS ARE NEVER CLICKED. A label that matches several controls
        (per-row buttons in a list) is shown and highlighted, never fired, because
        the shell cannot know which row the doctor meant. */
  function indexControls() {
    var out = [];
    var byLabel = {};
    qsa('button,.navtab,[onclick]').forEach(function (el) {
      if (el.closest && el.closest('#mlsDock,#mlsRightNow,#mlsAskResults,#mlsToolsMenu')) return;
      if (!visible(el)) return;
      var label = controlLabel(el);
      if (!label || label.length > 70) return;
      var key = label.toLowerCase();
      if (byLabel[key]) { byLabel[key].count++; return; }
      byLabel[key] = { el: el, label: label, count: 1 };
      out.push(byLabel[key]);
    });
    return out;
  }

  function score(label, q) {
    var l = label.toLowerCase();
    if (l === q) return 100;
    if (l.indexOf(q) === 0) return 80;
    if (l.indexOf(q) !== -1) return 60;
    var words = q.split(/\s+/).filter(Boolean);
    var hit = words.filter(function (w) { return l.indexOf(w) !== -1; }).length;
    return hit ? 20 + hit * 8 : 0;
  }

  /* "clear" belongs here: a doctor on the Orders screen typing "clear" to empty a
     form would otherwise have Ask fire the visit view's Clear button and destroy
     a 20-minute transcript with no confirmation and no undo. Anything that can
     lose captured work is destructive, not just anything that writes to Athena. */
  var DESTRUCTIVE = /remove|delete|purge|discharge|sign|send to athena|place order|log out|clear|discard|reset|erase|wipe|end visit|new visit/i;

  function wireAsk() {
    var input = qs('#mlsDockAsk');
    var panel = qs('#mlsAskResults');
    if (!input || !panel) return;
    var results = [];
    var sel = 0;

    function close() { panel.style.display = 'none'; results = []; sel = 0; }

    function run() {
      var q = input.value.trim().toLowerCase();
      if (q.length < 2) { close(); return; }
      results = indexControls().map(function (c) {
        return { c: c, s: score(c.label, q) };
      }).filter(function (r) { return r.s > 0; })
        .sort(function (a, b) { return b.s - a.s || a.c.label.length - b.c.label.length; })
        .slice(0, 8).map(function (r) { return r.c; });

      if (!results.length) {
        panel.innerHTML = '<div class="none">Nothing matches "' + q.replace(/[<>&]/g, '') + '".</div>';
        panel.style.display = 'block';
        return;
      }
      sel = 0;
      panel.innerHTML = results.map(function (r, i) {
        var danger = DESTRUCTIVE.test(r.label);
        return '<div class="r' + (i === 0 ? ' sel' : '') + (danger ? ' danger' : '') + '" role="option" data-i="' + i + '">' +
          r.label.replace(/[<>&]/g, '') + (r.count > 1 ? '<small>several — show me</small>' : '') + '</div>';
      }).join('');
      panel.style.display = 'block';
      qsa('.r', panel).forEach(function (row) {
        row.addEventListener('click', function () { choose(parseInt(row.getAttribute('data-i'), 10)); });
      });
    }

    function choose(i) {
      var r = results[i];
      if (!r) return;
      close();
      input.value = '';
      input.blur();
      /* Several controls carry this label — typically one per row in a list. The
         shell cannot know which row the doctor meant, so it shows the first
         instead of guessing. Guessing here is how you act on the wrong patient. */
      if (r.count > 1) {
        spotlight(r.el);
        note('Several controls are called "' + r.label + '" — showing you the first rather than guessing which one you meant.');
        return;
      }

      var proceed = function () { runControl(r.el); };
      /* Destructive controls keep their own gates. We add a confirmation rather
         than removing friction the app put there on purpose. Never a native
         dialog — the app owns mlsConfirm. */
      if (DESTRUCTIVE.test(r.label) && typeof W.mlsConfirm === 'function') {
        Promise.resolve(W.mlsConfirm('Run "' + r.label + '" now?')).then(function (ok) {
          if (ok) proceed();
        });
        return;
      }
      proceed();
    }

    input.addEventListener('input', run);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); input.blur(); return; }
      if (!results.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sel = (sel + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
        qsa('.r', panel).forEach(function (row, i) { row.classList.toggle('sel', i === sel); });
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    });
    D.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && e.target !== input) close();
    }, true);
  }

  /* ----------------------------------------------------------------- toggle */

  function classicSwitch() {
    var host = qs('#appHeader .tools');
    if (!host || qs('#mlsClassicBtn')) return;
    var b = D.createElement('button');
    b.id = 'mlsClassicBtn';
    b.className = 'btn-white mls-calm-keep';
    b.type = 'button';
    b.title = 'Switch back to the classic layout — takes effect immediately, no reload';
    b.textContent = 'Classic layout';
    b.addEventListener('click', function () {
      safe(function () { localStorage.setItem(STORE_KEY, '0'); });
      teardown();
      safe(mountReturn);
    });
    host.appendChild(b);
  }

  function teardown() {
    D.body.classList.remove('mls-calm', 'mls-headsdown');
    ['#mlsDock', '#mlsRightNow', '#mlsStages', '#mlsBusy', '#mlsHeadsDownHint', '#mlsClassicBtn',
      '#mlsToolsMenu', '#mlsNote'].forEach(function (s) {
      var el = qs(s);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    qsa('.mls-dup').forEach(function (b) { b.classList.remove('mls-dup'); });
    safe(dropIdentityCards);
    safe(dropControlNames);
    if (observer) safe(function () { observer.disconnect(); });
    if (idleTimer) clearTimeout(idleTimer);
    D.removeEventListener('mousemove', onMove, true);
    D.removeEventListener('keydown', onKey, true);
    D.removeEventListener('click', schedule, true);
    var css = qs('#mlsCalmShellCss');
    if (css && css.parentNode) css.parentNode.removeChild(css);
    dockEl = null;
    observer = null;
    lastRnSig = '';
    lastStage = -2;
    W.__mlsCalmShell.active = false;
  }

  function typingTarget() {
    var el = D.activeElement;
    if (!el) return false;
    if (el.isContentEditable) return true;
    return /^(input|textarea|select)$/i.test(el.tagName || '');
  }

  function onKey(e) {
    onMove();
    if (e.key === 'Escape' && D.body.classList.contains('mls-headsdown')) {
      D.body.classList.remove('mls-headsdown');
      return;
    }
    /* Never swallow a key from someone writing a note. Ctrl+1 is heading muscle
       memory in editors, and on several European layouts AltGr+digit reports
       ctrlKey=true — navigating away mid-sentence would be indefensible. */
    if ((e.metaKey || e.ctrlKey) && /^[1-5]$/.test(e.key) && !e.altKey && !typingTarget()) {
      var d = DEST[parseInt(e.key, 10) - 1];
      if (d) { e.preventDefault(); go(d.id); }
    }
    if (e.key === '/' && D.activeElement && !/input|textarea|select/i.test(D.activeElement.tagName) &&
      !D.activeElement.isContentEditable) {
      var ask = qs('#mlsDockAsk');
      if (ask) { e.preventDefault(); ask.focus(); }
    }
  }

  /* ------------------------------------------------------------- lifecycle */

  var observer = null;
  var pending = false;

  /* One observer, scoped to the two roots that actually tell us something:
     the rail (view state) and the visit view (stage state). Coalesced into a
     single rAF so a busy render cannot turn into a feedback loop. */
  function schedule() {
    if (!W.__mlsCalmShell.active) return;
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      if (!W.__mlsCalmShell.active) return;
      safe(syncDock);
      safe(renderRightNow);
      safe(renderStages);
      safe(prepRows);
      safe(patientScreen);
      safe(contextBar);
      safe(arm);
    });
  }

  function watch() {
    if (observer) return;
    observer = new MutationObserver(schedule);
    var rail = qs('.mainnav');
    var visit = qs('#visitView');
    /* class -> which view is active; style -> navFeatOn un-gating a tab mid
       session, which has to make its dock destination appear. The shell never
       writes to the rail, so watching it cannot feed back into itself. Tabs are
       observed individually as well, because some no longer live in the rail. */
    if (rail) observer.observe(rail, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });
    ALL_NAV_IDS.forEach(function (id) {
      var el = D.getElementById(id);
      if (el) observer.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
    });
    if (visit) observer.observe(visit, { childList: true, subtree: true });
    /* The prep summary only exists once a patient is selected, so watch the
       patients view too. prepRows() no-ops when its signature is unchanged, so
       its own insertion cannot drive a render loop. */
    var pts = qs('#patientsView');
    if (pts) observer.observe(pts, { childList: true, subtree: true });
  }

  /* --------------------------------------------- returning from classic */

  /* "Classic layout" writes mlsCalmShell='0', and enabled() honours that on
     every later load — so one click permanently retired the redesign and
     NOTHING in the app offered a way back. Measured on the running page at
     b585: after one click, zero visible controls anywhere mention the new
     layout, and the only routes back were typing ?ui=calm by hand or clearing
     site data. A doctor who tried Classic once would report that the redesign
     had disappeared, and they would be right.

     The dock deliberately carries no "go back" button because the calm shell
     IS the UI. That same argument makes this control correct: it exists only
     in the classic layout, where it is the only thing that knows the redesign
     is there at all, so it costs the calm UI nothing. */
  function mountReturn() {
    if (qs('#mlsCalmReturn')) return true;
    var app = qs('#appScreen');
    if (!app || !visible(app)) return false;
    /* Never before auth settles — the legacy #mlsFab shipped that bug once. */
    var auth = qs('#authScreen');
    if (auth && visible(auth)) return false;

    var css = D.createElement('style');
    css.id = 'mlsCalmReturnCss';
    css.textContent = '#mlsCalmReturn{position:fixed;right:14px;bottom:14px;z-index:940;' +
      'border:1px solid #DFE5E1;background:rgba(255,255,255,.94);color:#5B6B62;' +
      'border-radius:999px;padding:8px 14px;cursor:pointer;opacity:.72;' +
      'font:500 12.5px system-ui,-apple-system,"Segoe UI",sans-serif;' +
      'box-shadow:0 2px 10px rgba(20,35,28,.10)}' +
      '#mlsCalmReturn:hover,#mlsCalmReturn:focus-visible{opacity:1;color:#204034;outline:0}';
    (D.head || D.documentElement).appendChild(css);

    var b = D.createElement('button');
    b.id = 'mlsCalmReturn';
    b.type = 'button';
    b.textContent = 'Use the new layout';
    b.title = 'Return to the simplified layout with the bottom bar';
    b.addEventListener('click', function () {
      safe(function () { localStorage.setItem(STORE_KEY, '1'); });
      /* A ui=classic still in the URL wins over the stored preference on the
         next enabled() call, so booting in place would immediately bounce
         back. Swap the parameter and let the reload settle it. */
      if (/[?&]ui=classic/i.test(String(location.search || ''))) {
        location.search = String(location.search).replace(/([?&])ui=classic/i, '$1ui=calm');
        return;
      }
      var node = qs('#mlsCalmReturn'); if (node) node.remove();
      var sheet = qs('#mlsCalmReturnCss'); if (sheet) sheet.remove();
      /* Boot in place rather than reload — a reload mid-clinic can cost
         unsaved work, and boot() already fails back to classic if it throws. */
      if (boot() !== true) safe(function () { location.reload(); });
    });
    (D.body || D.documentElement).appendChild(b);
    return true;
  }

  function boot() {
    if (!enabled()) return mountReturn();
    if (!qs('#appScreen') || !visible(qs('#appScreen'))) return false;
    /* If any part of the shell fails to come up we return the doctor to the
       classic layout rather than leaving them with a hidden rail and no dock.
       An unattended deploy has to fail back to something usable. */
    try {
      injectCss();
      buildDock();
      classicSwitch();
      /* Set BEFORE the first render, not after: every deferred path below
         (the two boot timers, the queued rAF, Ask's 300ms follow-up) checks
         this flag, so a teardown that lands in between must make them no-ops.
         Without it, "Classic layout" left unstyled debris grafted into the
         classic UI with the stylesheet already gone. */
      W.__mlsCalmShell.active = true;
      renderRightNow();
      renderStages();
      safe(prepRows);
      watch();
      D.addEventListener('mousemove', onMove, true);
      D.addEventListener('keydown', onKey, true);
      /* The first render can land before the rail has marked a tab .on or before
         a view has filled in, and on a quiet screen NOTHING mutates afterwards —
         so b533 could sit on "Nothing to do here yet" forever. Two delayed
         recomputes cover startup, and a passive document click covers state the
         doctor changes through controls this shell did not fire. Both are cheap:
         schedule() coalesces to one rAF and the bar skips identical content. */
      setTimeout(schedule, 350);
      setTimeout(schedule, 1200);
      D.addEventListener('click', schedule, true);
      return true;
    } catch (e) {
      safe(function () { W.__mlsCalmShell.error = String((e && e.message) || e); });
      safe(teardown);
      return true;
    }
  }

  /* ------------------------------------------------------------------
     idc-1.0.0 — the patient is a person, not part of a button label.

     Owner, 2026-07-24, looking at the Today screen: "i ahte this patient
     banner like wtf is this its aweful and also like if Im on a paietn the
     patient banner sohuld be up there".

     The Today surface built its primary action as
       "🎙 Start Recording — Atoussa Salimi<small>7:30 AM · DOB 11/05/1968</small>"
     so the patient's name, time and date of birth were part of a control's
     label. Three things follow from that and all three are wrong: identity
     reads as an instruction, the button gets worse the longer the name is, and
     there is no patient header anywhere on the screen to look at.

     Identity moves ABOVE the action as its own card; the button becomes one
     thing to press. Done here rather than in the four generators that build
     these buttons (Start Recording, Start Visit, and the two "up next" forms)
     because this is presentation, the generators live in a 1.9MB file, and one
     transform covers every variant including any added later.

     NOT a claim that a chart is open. On Today no patient is selected yet, so
     the card is deliberately scoped to the ez3 action it belongs to and never
     pinned to the top of the app - a persistent banner there would imply the
     doctor is already in that patient's chart when they are not.

     The button keeps its full original text as aria-label, so nothing that
     resolves controls by accessible name loses its reach and a screen reader
     still hears which patient the action belongs to. Handlers are bound by id
     (ez3Now/ez3Nxt), never by label, so the visible text is safe to shorten -
     checked before writing this. */
  var ID_SPLIT = /^([^—]{1,40}?)\s+—\s+(.+)$/;

  function identityCards() {
    if (!W.__mlsCalmShell.active) return;
    qsa('.ez3-big').forEach(function (btn) {
      if (!btn.parentNode) return;
      var small = btn.querySelector('small');
      /* Raw textContent, NOT textOf(): textOf strips emoji to spaces, which
         would both break the suffix arithmetic below and eat the 🎙 that makes
         the action recognisable at a glance. */
      var whole = String(btn.textContent || '');
      var smallText = small ? String(small.textContent || '') : '';
      /* The ez3 surface repaints itself, which destroys the card and restores
         the long label. Re-deriving from the button each pass is what makes
         this idempotent; the signature only skips work when nothing moved. */
      var sig = whole + '|';
      if (btn.__mlsIdSig === sig && btn.previousSibling && btn.previousSibling.classList &&
          btn.previousSibling.classList.contains('mls-idcard')) return;

      var head = whole;
      if (smallText && whole.slice(-smallText.length) === smallText) head = whole.slice(0, whole.length - smallText.length);
      var m = ID_SPLIT.exec(head.replace(/\s+/g, ' ').trim());
      if (!m) return;                       /* no identity fused in - leave it */
      var action = m[1].trim(), who = m[2].trim();
      if (!who) return;

      var card = btn.previousSibling;
      if (!card || !card.classList || !card.classList.contains('mls-idcard')) {
        card = D.createElement('div');
        card.className = 'mls-idcard';
        btn.parentNode.insertBefore(card, btn);
      }
      card.textContent = '';
      var nm = D.createElement('div');
      nm.className = 'mls-idname';
      nm.textContent = who;
      card.appendChild(nm);
      if (small) {
        var mt = D.createElement('div');
        mt.className = 'mls-idmeta';
        mt.textContent = textOf(small);
        card.appendChild(mt);
      }

      /* Keep the exact original markup so teardown() can put the control back
         byte-for-byte. Without it, leaving the shell would strand a button
         reading "Start Recording" with no patient on it until the ez3 surface
         happened to repaint - the same class of debris that made the Classic
         escape hatch untrustworthy before. */
      if (btn.__mlsIdHtml == null) btn.__mlsIdHtml = btn.innerHTML;
      /* Built from the parts with a separator, NOT from the raw textContent:
         the markup has no whitespace before <small>, so concatenating gives
         "Atoussa Salimi7:30 AM". On screen that is invisible - <small> is
         display:block and renders on its own line - but an aria-label is a
         flat string, so a screen reader really would say the surname and the
         time as one word. The visual is fine; this is the one place the join
         actually reaches a person. */
      btn.setAttribute('aria-label',
        (head.replace(/\s+/g, ' ').trim() + (smallText ? ' · ' + smallText.replace(/\s+/g, ' ').trim() : '')));
      btn.textContent = action;
      /* Compare against what the button NOW reads, so the next pass does not
         try to re-split an already-split label. */
      btn.__mlsIdSig = action + '|';
    });
  }

  /* ------------------------------------------------------------------
     acn-1.0.0 — the name a control announces is the name it reads.

     idc-1.0.0 fixed the accessible name of ONE shape: an .ez3-big whose label
     splits on an em dash. The handoff's own lesson is that per-shape fixes do
     not hold, and it was right — measured on the running page at b581, with a
     patient active, every screen still announced:

       .mlsctx-id   "SOSample Patient OneAge 51 yrs51y F · DOB 01/15/1975 …"
       .ez3-qchip   "8:10 AMSample O."
       #ez3Choose   "Choose patient2 on today's schedule"
       .uc1-pay     "Pay Reports PREMIUMThis month's visits, coded and totaled…"

     Every one of these LOOKS right — the colliding pieces are separate boxes on
     separate lines — so no amount of looking at the screen finds them. They are
     wrong only in the flat string, which is what a screen reader speaks, what
     voice control matches, and what the Ask index and control inventory search.
     "8:10 AMSample O." is the owner's original complaint exactly, still shipping
     in a different shape, on a control that names a patient.

     So the derived label is PUBLISHED rather than merely used: any composite
     control whose flattened text differs from its derived label gets that label
     as an explicit aria-label. Central, shape-independent, and it covers
     controls added later without anyone remembering this rule exists.

     Three constraints, each deliberate:
     - Never overwrite an aria-label the app set. An explicit name is a decision
       by whoever owns that control; this only fills a gap.
     - The derived label always CONTAINS the visible words, in reading order, so
       voice control ("click Pay Reports") keeps matching. This adds separators,
       it never renames anything.
     - Stamped with data-mls-acn so teardown removes exactly what it added and
       the Classic escape hatch leaves no debris. */
  /* This runs on every render pass, and a busy chart carries ~800 controls, so
     the expensive half is gated behind a text signature. controlLabel calls
     getComputedStyle per child — style resolution, not a free read — and
     visible() forces layout. Both are skipped while a control's flat text is
     unchanged, which is every pass after the first for all but the few controls
     that actually re-rendered. Reading textContent costs no style or layout. */
  function nameControls() {
    if (!W.__mlsCalmShell.active) return;
    qsa('button,[role="button"]').forEach(function (el) {
      if (!el.children || !el.children.length) return;
      var stamped = el.getAttribute('data-mls-acn');
      if (el.getAttribute('aria-label') && !stamped) return;
      var flat = normLabel(el.textContent);
      if (el.__mlsAcnSig === flat) return;
      if (el.closest && el.closest('#mlsDock,#mlsRightNow,#mlsToolsMenu,#mlsAskResults')) return;
      if (!visible(el)) return;
      el.__mlsAcnSig = flat;
      var derived = controlLabel(el);
      if (!derived || derived === flat || derived.length > 200) {
        /* It agreed after all — drop a stamp from an earlier pass rather than
           leave a stale name on a control that has since re-rendered. */
        if (stamped) { el.removeAttribute('aria-label'); el.removeAttribute('data-mls-acn'); }
        return;
      }
      el.setAttribute('aria-label', derived);
      el.setAttribute('data-mls-acn', '1');
    });
  }

  function dropControlNames() {
    qsa('[data-mls-acn]').forEach(function (el) {
      el.removeAttribute('aria-label');
      el.removeAttribute('data-mls-acn');
      /* Clear the signature too, or switching to Classic and back would leave
         every control looking up-to-date and none of them named. */
      el.__mlsAcnSig = null;
    });
  }

  function dropIdentityCards() {
    qsa('.mls-idcard').forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
    qsa('.ez3-big').forEach(function (btn) {
      if (btn.__mlsIdHtml == null) return;
      btn.innerHTML = btn.__mlsIdHtml;
      btn.removeAttribute('aria-label');
      try { delete btn.__mlsIdHtml; delete btn.__mlsIdSig; } catch (e) { btn.__mlsIdHtml = null; btn.__mlsIdSig = ''; }
    });
  }

  /* Hide the transcript only while it is genuinely empty. Re-evaluated every
     pass, so the first captured word brings it straight back. */
  function visitCalm() {
    if (!W.__mlsCalmShell.active) return;
    qsa('.ez3fl-transcript').forEach(function (t) {
      /* NOT \b0 words\b - textContent welds the block children together, so
         the live node reads "...transcript0 words captured" with no word
         boundary before the 0; measured against the real element, the \b form
         never matched. And NOT a bare /0 words/, which also matches
         "10 words" and would hide a transcript that has content. */
      t.classList.toggle('mls-empty', /(?:^|\D)0\s*words/i.test(textOf(t)));
    });
  }

  /* render() runs one pass SYNCHRONOUSLY, bypassing schedule()'s
     requestAnimationFrame. Not decoration: rAF does not fire in a tab that is
     not compositing, so in any headless or background verification context every
     renderer silently never runs - which made a working patient screen read as
     completely inert and cost a build to chase. Anything that cannot be observed
     cannot be claimed, so the shell exposes a way to observe it. */
  function renderNow() {
    safe(syncDock);
    safe(renderRightNow);
    safe(renderStages);
    safe(prepRows);
    safe(patientScreen);
    safe(contextBar);
    safe(identityCards);
    /* After identityCards: that pass sets its own aria-label on the shapes it
       splits, and nameControls must see the finished markup so it neither
       overwrites that name nor re-derives one from a label mid-rewrite. */
    safe(nameControls);
    safe(visitCalm);
  }

  W.__mlsCalmShell = {
    version: VERSION,
    contract: CONTRACT,
    active: false,
    go: go,
    busy: busy,
    stage: stageNow,
    render: renderNow,
    revert: teardown,
    boot: boot,
    /* Exported so label derivation can be checked on the RUNNING PAGE against
       real markup and real computed styles — the one verification that counts.
       The welding bug survived a build because it was confirmed by reading the
       served file; a hand-rolled DOM cannot reproduce getComputedStyle on a
       child of a display:none subtree, which is exactly what decides here.
         __mlsCalmShell.label(document.getElementById('ptPullAthenaBtn'))
       must read "Pull from Athena · READ-ONLY", never the tooltip. */
    label: controlLabel
  };

  /* The app screen appears after auth; poll cheaply until it does, then stop.
     One timer, self-cancelling — never a standing interval. */
  var tries = 0;
  (function waitForApp() {
    if (boot() === true) return;
    if (++tries > 120) return;
    setTimeout(waitForApp, 500);
  })();
})();
