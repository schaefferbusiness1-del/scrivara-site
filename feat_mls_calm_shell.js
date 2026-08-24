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

  /* A timed-out foundation load publishes an installed:false retirement
     receipt so late callbacks stay inert.  That receipt is not a real Calm
     owner and must never block the next exact build from installing. */
  if (window.__mlsCalmShell && window.__mlsCalmShell.installed !== false) return;
  if (window.__mlsCalmShell && window.__mlsCalmShell.installed === false) {
    try { delete window.__mlsCalmShell; } catch (e) { window.__mlsCalmShell = null; }
  }

  var VERSION = 'calm-1.0.0';

  /* Dock destinations. The coverage suite asserts this list matches
     tests/fixtures/ui-reach-map.json so the shipped dock and the reach
     contract cannot drift apart. */
  var CONTRACT = { MLS_DOCK_DEST: ['day', 'patient', 'review', 'studio', 'tools', 'visit'] };

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
  /* showView() owns each top-level view's inline display value. Read that
     write-side state first so route changes do not force layout on every
     hidden room merely to rediscover which room showView just selected. Only
     old/ambiguous markup with no inline decision falls back to visible(). */
  function activeAppView() {
    var views = qsa('#appWrap > div').filter(function (el) { return /View$/.test(el.id || '') && !el.hidden; });
    for (var i = 0; i < views.length; i++) {
      var inline = String(views[i].style && views[i].style.display || '');
      if (inline && inline !== 'none') return views[i];
    }
    for (var j = 0; j < views.length; j++) {
      var decision = String(views[j].style && views[j].style.display || '');
      if (!decision && visible(views[j])) return views[j];
    }
    return null;
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
    /* The retired Classic shell can strand navigation off-screen. Production
       now has one supported navigation owner: the liquid-glass Calm shell. */
    safe(function () { localStorage.setItem(STORE_KEY, '1'); });
    return true;
  }

  /* ------------------------------------------------------------------- css */

  /* Apple's standard easing curve. Everything moves on transform/opacity only —
     no layout-animating properties, so a mid-clinic machine never janks. */
  var CSS = [
    /* THE LEGACY FOUR ARE NOW ALIASES, not a second vocabulary. These four
       names predate the token system and 23 rules in this file still use them;
       rewriting all 23 would churn a file three other lanes are editing, and
       leaving them forked is how the app ended up with two spellings of one
       curve in the first place. Pointing them at the canonical tokens gives one
       source of truth with no call-site churn. The old literals are the
       FALLBACKS, so a surface that somehow loads this stylesheet without the
       page's :root degrades to exactly today's behaviour rather than to none. */
    ':root{--mls-spring:var(--mls-ease-out,cubic-bezier(.32,.72,0,1));'+
      '--mls-fast:var(--mls-dur-2,180ms);'+
      '--mls-base:var(--mls-dur-3,260ms);'+
      '--mls-slow:var(--mls-dur-4,380ms)}',
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
    /* b730 (phone audit B4): with the rail gone, the mobile burger opened a
       grey scrim over NOTHING — a dead control dressed as navigation. If the
       calm shell hides the rail, it hides the button that opens it. */
    'html body.mls-calm #mlsRdRailBtn{display:none!important}',
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

    /* ---- b841: THE DOCK GOES WHERE THE DOCTOR WANTS IT --------------------
       Owner: "make it possible to move the bottom menu select to the top in
       settings or to either side ... but I love how it hovers so dont change
       that." So every position is still `position:fixed` glass that floats over
       the page — only the anchor and the axis change. The default is untouched:
       with no attribute set, the rules above apply exactly as before, so a
       doctor who never opens the setting sees no difference at all.
       Each position re-states its own resting transform, because the entrance
       @keyframes above bakes translateX(-50%) into its end state and a left/right
       dock must not inherit it. */
    /* BELOW THE HEADER, not under it. #appHeader is position:sticky, 74px tall
       and z-index:6000; a dock resting at top:18px with z-index:920 had 56 of
       its 85 pixels hidden behind it — measured, and visible as a row of half
       destination labels. The dock clears the header instead of fighting it for
       a stacking order the header should win. */
    'body[data-mls-dock="top"] #mlsDock{top:88px;bottom:auto;animation-name:mlsDockInT}',
    '@keyframes mlsDockInT{from{opacity:0;transform:translateX(-50%) translateY(-18px) scale(.96)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}',

    'body[data-mls-dock="left"] #mlsDock,body[data-mls-dock="right"] #mlsDock{',
    'top:50%;bottom:auto;left:auto;right:auto;flex-direction:column;align-items:stretch;',
    'transform:translateY(-50%);border-radius:22px}',
    'body[data-mls-dock="left"] #mlsDock{left:18px;animation-name:mlsDockInL}',
    'body[data-mls-dock="right"] #mlsDock{right:18px;animation-name:mlsDockInR}',
    '@keyframes mlsDockInL{from{opacity:0;transform:translateY(-50%) translateX(-18px) scale(.96)}to{opacity:1;transform:translateY(-50%) translateX(0) scale(1)}}',
    '@keyframes mlsDockInR{from{opacity:0;transform:translateY(-50%) translateX(18px) scale(.96)}to{opacity:1;transform:translateY(-50%) translateX(0) scale(1)}}',
    /* the sliding indicator turns with the dock: JS drives height+translateY on
       this axis, so the CSS must stop pinning the height. */
    'body[data-mls-dock="left"] #mlsDock .mls-dock-pill,body[data-mls-dock="right"] #mlsDock .mls-dock-pill{',
    'height:auto;width:calc(100% - 12px)}',
    'body[data-mls-dock="left"] #mlsDock button,body[data-mls-dock="right"] #mlsDock button{width:100%}',
    /* the Ask field cannot be 172px wide inside a vertical rail; it rests as a
       compact square and opens to full width on focus, over the page, which is
       the same trick the horizontal dock already uses. */
    'body[data-mls-dock="left"] #mlsDockAskWrap,body[data-mls-dock="right"] #mlsDockAskWrap{',
    'margin:4px 0 0;padding:8px 0 0;border-left:0;border-top:1px solid rgba(0,0,0,.07);justify-content:center}',
    'body[data-mls-dock="left"] #mlsDockAsk,body[data-mls-dock="right"] #mlsDockAsk{width:46px}',
    'body[data-mls-dock="left"] #mlsDockAsk:focus{width:230px}',
    'body[data-mls-dock="right"] #mlsDockAsk:focus{width:230px;margin-left:-184px}',
    /* heads-down dimming re-stated per axis for the same reason as the entrance */
    'body.mls-headsdown[data-mls-dock="top"] #mlsDock{transform:translateX(-50%) translateY(-6px)}',
    'body.mls-headsdown[data-mls-dock="left"] #mlsDock{transform:translateY(-50%) translateX(-6px)}',
    'body.mls-headsdown[data-mls-dock="right"] #mlsDock{transform:translateY(-50%) translateX(6px)}',
    /* CLEARANCE, because "it hovers" must not mean "it hides things".
       Measured live with the rail on the left: exactly one control, the
       previous-day arrow #mlsDsPrev, sat underneath it — visible to the eye as
       a rail over a button, and elementFromPoint at the intersection returned
       the dock, so the click was going to the dock and not to the arrow. The
       bottom dock has carried clearance rules since it shipped; the three new
       sides need their own. The page moves, the dock still floats.

       !important is NOT decoration here, it was measured. Without it the rule
       parsed, sat in the CSSOM, matched #appWrap (verified with .matches), had
       no competing rule in any readable sheet — and still computed to 0px. The
       proof it was being outranked rather than ignored: an INLINE
       padding-left:128px on #appWrap also computed to 0px, which only an
       !important declaration can do. It lives in a stylesheet whose cssRules
       throws on read, so the audit that "found nothing" was the known silent
       zero, not an absence. */
    'body[data-mls-dock="left"] #appWrap{padding-left:128px !important}',
    'body[data-mls-dock="right"] #appWrap{padding-right:128px !important}',
    'body[data-mls-dock="top"] #appWrap{padding-top:112px !important}',
    /* a vertical rail on a phone would eat the whole screen edge; below the
       phone breakpoint every choice falls back to the proven bottom dock. */
    '@media(max-width:640px){body[data-mls-dock] #mlsDock{top:auto;bottom:18px;left:50%;right:auto;',
    'flex-direction:row;align-items:center;transform:translateX(-50%);animation-name:mlsDockInD}',
    'body[data-mls-dock] #mlsDock .mls-dock-pill{height:calc(100% - 12px);width:auto}',
    'body[data-mls-dock] #mlsDock button{width:auto}',
    'body[data-mls-dock] #mlsDockAskWrap{margin-left:4px;padding-left:8px;border-top:0;border-left:1px solid rgba(0,0,0,.07)}',
    'body[data-mls-dock] #mlsDockAsk{width:172px}',
    /* and the clearance goes with it — a phone gets the bottom rail, so an
       inherited side padding would just narrow an already narrow screen. */
    'body[data-mls-dock] #appWrap{padding-left:0 !important;padding-right:0 !important;padding-top:14px !important}}',
    '#mlsDock .mls-dock-pill{position:absolute;top:6px;left:6px;height:calc(100% - 12px);border-radius:16px;background:#D6E7DC;',
    'box-shadow:0 1px 2px rgba(20,35,28,.14),inset 0 0 0 1px rgba(32,64,52,.10);',
    /* The pill already glided rather than teleported — the brief's premise was
   wrong and the running page said so. What it did not do was SETTLE: it
   used the plain deceleration curve, so it stopped dead on arrival.
   --mls-ease-spring overshoots by ~1% and comes back, which is the whole
   difference between a highlight that moves and one that lands. */
    'transition:transform var(--mls-dur-3) var(--mls-ease-spring),width var(--mls-dur-3) var(--mls-ease-spring);pointer-events:none;z-index:0}',
    '#mlsDock button{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:2px;',
    'min-width:64px;padding:8px 12px 7px;border:0;background:transparent;border-radius:16px;cursor:pointer;',
    'font:500 11.5px/1.1 inherit;color:#5B6B62;transition:color var(--mls-fast) var(--mls-spring),transform var(--mls-fast) var(--mls-spring)}',
    '#mlsDock button:hover{color:#204034}',
    '#mlsDock button:active{transform:scale(.93)}',
    '#mlsDock button.on{color:#173026;font-weight:700}',
    '#mlsDock button svg{transition:transform var(--mls-base) var(--mls-spring)}',
    /* The icon lift was 1px and 8% on the plain curve — technically animated,
   not perceptible. The lift itself is unchanged; the CURVE is what makes it
   read as the item accepting the selection rather than redrawing. */
    '#mlsDock button.on svg{transform:translateY(-1px) scale(1.08);transition:transform var(--mls-dur-3) var(--mls-ease-spring)}',
    '#mlsDock button svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}',
    '#mlsDock .mls-dock-count{position:absolute;top:3px;right:9px;min-width:15px;height:15px;padding:0 4px;border-radius:8px;',
    'background:#2E6A4B;color:#fff;font:500 10px/15px inherit;text-align:center;transform:scale(0);',
    'transition:transform var(--mls-base) var(--mls-spring)}',
    '#mlsDock .mls-dock-count.show{transform:scale(1)}',
    '#mlsDockAskWrap{position:relative;z-index:1;display:flex;align-items:center;margin-left:4px;padding-left:8px;border-left:1px solid rgba(0,0,0,.07)}',
    /* 172px: "Ask or find anything" measures 145px at the rendered font plus
       the 24px padding - at 150px the placeholder clipped mid-word. */
    '#mlsDockAsk{width:172px;height:34px;padding:0 12px;border:0;border-radius:14px;background:rgba(0,0,0,.045);',
    'font:400 13px inherit;color:#1A211C;outline:0;transition:width var(--mls-base) var(--mls-spring),background var(--mls-fast) linear}',
    '#mlsDockAsk:focus{width:250px;background:rgba(0,0,0,.075)}',
    '#mlsDockAsk::placeholder{color:var(--muted)}',
    '#mlsAskResults{position:absolute;bottom:46px;right:0;width:340px;max-height:320px;overflow:auto;',
    'background:rgba(255,255,255,.92);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);border:1px solid rgba(0,0,0,.07);',
    'border-radius:16px;box-shadow:0 16px 40px rgba(20,35,28,.18);padding:6px;display:none;',
    'transform-origin:bottom right;animation:mlsPop var(--mls-base) var(--mls-spring)}',
    '@keyframes mlsPop{from{opacity:0;transform:scale(.94) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}',
    '#mlsAskResults .r{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:11px;cursor:pointer;font-size:13.5px;color:#1A211C}',
    '#mlsAskResults .r:hover,#mlsAskResults .r.sel{background:#EAF1EE}',
    '#mlsAskResults .r small{margin-left:auto;color:var(--muted);font-size:11.5px}',
    '#mlsAskResults .r.danger{color:#A32D2D}',
    '#mlsAskResults .none{padding:12px;color:#68736B;font-size:13px}',

    /* Three floating pills - MLS Copilot Voice, MLS Assistant, Dictate - stacked
       over the bottom of every screen and all led to the same assistant. One
       Copilot button in the dock replaces them; the mic lives inside the Copilot
       card, which is where a mic belongs. */
    'body.mls-calm #mlsAsstFab,',
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
    'body.mls-calm #ptList li button{opacity:.42;',
    'transition:opacity var(--mls-fast) linear}',
    'body.mls-calm #ptList li:hover button,',
    'body.mls-calm #ptList li:focus-within button,',
    'body.mls-calm #ptList li.on button{opacity:1}',
    'body.mls-calm #ptList button:focus-visible{opacity:1;outline:2px solid #2E6A4B;outline-offset:2px}',

    /* patient screen: reference blocks fold to one line */
    'body.mls-calm #profileCard .mls-fold{border:1px solid #EDEBE4;border-radius:12px;margin:8px 0;background:#fff}',
    'body.mls-calm #profileCard .mls-fold:not(.mls-open) > *:not(:first-child){display:none!important}',
    'body.mls-calm #profileCard .mls-fold > .mls-fold-hd{margin:0;padding:12px 14px;cursor:pointer;',
    'display:flex;align-items:center;gap:9px;font:500 13.5px/1.3 inherit;color:#4A5B51;border:0;background:none}',
    'body.mls-calm #profileCard .mls-fold > .mls-fold-hd:hover{background:#F6FAF8;border-radius:12px}',
    'body.mls-calm #profileCard .mls-fold > .mls-fold-hd::after{content:"";margin-left:auto;width:7px;height:7px;',
    'border-right:1.6px solid var(--muted);border-bottom:1.6px solid var(--muted);transform:rotate(-45deg);',
    'transition:transform var(--mls-base) var(--mls-spring)}',
    'body.mls-calm #profileCard .mls-fold.mls-open > .mls-fold-hd::after{transform:rotate(45deg)}',
    'body.mls-calm #profileCard .mls-fold:not(.mls-open) > .mls-fold-hd button{display:none!important}',
    'body.mls-calm #profileCard .mls-fold.mls-open > *:not(:first-child){animation:mlsViewIn var(--mls-base) var(--mls-spring)}',

    /* prep summary rows */
    '#mlsPrepRows{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:0 22px;margin:2px 0 6px}',
    '#mlsPrepRows .r{display:flex;align-items:baseline;gap:10px;padding:8px 0;min-width:0;',
    'border-bottom:1px solid rgba(0,0,0,.05)}',
    '#mlsPrepRows .k{flex:0 0 88px;font:500 11px/1.4 inherit;letter-spacing:.4px;text-transform:uppercase;color:var(--muted)}',
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
    '#mlsToolsMenu{position:fixed;z-index:930;width:min(560px,94vw);padding:10px;border-radius:16px;',
    'background:rgba(255,255,255,.94);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);',
    'border:1px solid rgba(0,0,0,.07);box-shadow:0 16px 40px rgba(20,35,28,.18);',
    /* Clamped because this menu is built from whatever the live DOM still
       offers, so its height is not a constant the layout can rely on. It
       measured a safe 297px with the 7 rows a preview session exposes, but a
       signed-in session lists more, and position:fixed with no bound puts the
       first rows above y=0 on a phone, where nothing can scroll to them. The
       bound leaves room for the dock underneath. */
    'max-height:calc(100vh - 132px);overflow-y:auto;overscroll-behavior:contain;',
    'transform-origin:bottom left;animation:mlsPop var(--mls-base) var(--mls-spring)}',
    /* 2026-07-28: windows-style launcher grid - icon above, name below */
    '#mlsToolsMenu .grp{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:4px}',
    '#mlsToolsMenu .gh,#mlsToolsMenu .sep{grid-column:1/-1}',
    '#mlsToolsMenu .r{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:6px;padding:12px 6px 10px;border-radius:12px;font-size:11.5px;line-height:1.25;color:#1A211C;cursor:pointer;text-align:center;min-height:76px}',
    '#mlsToolsMenu .r .ri{font-size:26px;line-height:1}',
    '#mlsToolsMenu .r .rn{overflow-wrap:anywhere}',
    '#mlsToolsMenu .r:hover,#mlsToolsMenu .r:focus{background:#EAF1EE;outline:0}',
    '#mlsToolsMenu .sep{height:1px;margin:5px 8px;background:rgba(0,0,0,.07)}',
    /* Section captions. Quiet by construction - a caption that competes with
       the rows under it turns four labels into four more things to read. The
       rule above each section after the first is what makes the grouping
       visible at a glance rather than on a second pass.
       var(--muted), never a literal grey: measured on the running page, a
       hand-picked #79837C reads 3.93:1 on this menu's near-white background,
       under AA for 10.5px text, while --muted's light value clears it at
       5.31:1. That is the rule tests/secondary-text-is-a-theme-token.test.js
       exists to hold, and the token is also what the dark parity layer already
       resolves this caption to. */
    '#mlsToolsMenu .gh{padding:8px 12px 3px;font-weight:800;font-size:10.5px;line-height:1.2;',
    'letter-spacing:.09em;text-transform:uppercase;color:var(--muted,#636E66);cursor:default;',
    'user-select:none;-webkit-user-select:none}',
    '#mlsToolsMenu .grp + .grp{margin-top:4px;padding-top:3px;border-top:1px solid rgba(0,0,0,.06)}',

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
    /* the .lbl rule went with the "Right now" caption it styled — leaving it
       would be the same dead-CSS-with-a-confident-comment I deleted from the
       motion block this build */
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
    '{animation:mlsMdlIn var(--mls-dur-2) var(--mls-ease-out)}',
    'body.mls-calm .ez3-modal-card,body.mls-calm .ez2-modal>*,body.mls-calm #settingsModal>*,',
    'body.mls-calm #templatesModal>*,body.mls-calm #opPrepModal>*,body.mls-calm #patientModal>*',
    '{animation:mlsMdlCard var(--mls-dur-3) var(--mls-ease-out)}',
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
    '#mlsRightNow .note{font-size:12.5px;color:var(--muted)}',
    '#mlsRightNow .seg{display:inline-flex;padding:3px;border-radius:12px;background:rgba(0,0,0,.045);gap:2px;margin-right:6px}',
    '#mlsRightNow .seg .segbtn{border:0;background:transparent;color:#5B6B62;border-radius:10px;padding:6px 12px;',
    'font:500 12.5px inherit;cursor:pointer;opacity:1;transform:none;animation:none}',
    '#mlsRightNow .seg .segbtn.on{background:#fff;color:#204034;box-shadow:0 1px 3px rgba(20,35,28,.10)}',
    '#mlsRightNow .seg .segbtn:hover{color:#204034;background:rgba(255,255,255,.6)}',

    /* stages — the visit rail.
       Owner, on a screenshot of "Prep · Record · Review · Sign · Send":
       "this progress bar should fill very beautifully each circle as a visit
       goes on."
       What he was looking at is exactly what these rules produced: a 1.6px
       #D6DED9 ring on white, at 15px, beside a --muted 12.5px label. Only the
       CURRENT dot carried a green halo, so only the current dot read as a
       circle at all and the rail read as one glyph followed by four grey
       words. There was no visible difference between "done" and "still to
       come" until you looked for a 3% scale change.
       Three states now, and each is legible WITHOUT colour:
         COMPLETE  filled disc carrying a drawn check
         CURRENT   filled disc inside a halo ring, scaled up
         UPCOMING  hollow outline, muted
       Completed stages STAY filled, so the rail answers "how far along am I"
       at a glance rather than only "where am I". */
    '#mlsStages{display:flex;align-items:center;gap:0;margin:0 0 14px;padding:2px}',
    '#mlsStages .st{position:relative;display:flex;align-items:center;gap:7px;color:var(--muted);font:500 12.5px inherit}',
    '#mlsStages .st .dot{flex:none;display:flex;align-items:center;justify-content:center;',
    'width:16px;height:16px;border-radius:50%;border:1.6px solid #D6DED9;background:#fff;',
    /* Canonical tokens, and a real spring on the transform: the dot that
       becomes `now` is the one thing on this rail that was summoned, so it
       overshoots ~1% and settles rather than easing flat into place. Colour
       stays linear — a colour that springs reads as a flicker. box-shadow
       joins the transition so the focus ring BLOOMS with the scale instead of
       snapping on a frame ahead of it; it is paint-only and costs no layout.
       The COLOUR carries a --mls-dur-1 delay and the transform does not, so
       the connector (dur-4, no delay) and the disc it feeds finish together:
       the fill visibly travels along the track and INTO the circle instead of
       both ends lighting up on the same frame. The delay is a token, not a
       fourteenth hand-picked number. */
    'transition:transform var(--mls-dur-3) var(--mls-ease-spring),',
    'background var(--mls-dur-3) linear var(--mls-dur-1),',
    'border-color var(--mls-dur-3) linear var(--mls-dur-1),',
    'box-shadow var(--mls-dur-3) var(--mls-ease-out)}',
    /* The check is DRAWN, not typed. A glyph would inherit the font of the
       label beside it, would need its own rule to stay legible on the fill,
       and would be one more character for the mojibake sweep to police — this
       repo has already shipped chart-row status glyphs as mojibake once.
       No ASCII apostrophe anywhere in this block, deliberately: every scanner
       that reads this stylesheet does it by matching single-quoted string
       literals, and one apostrophe in a comment swallows the next 40 rules. */
    '#mlsStages .st .dot svg{display:block;width:10px;height:10px;opacity:0;transform:scale(.55);',
    'transition:opacity var(--mls-dur-2) var(--mls-ease-out) var(--mls-dur-2),',
    'transform var(--mls-dur-2) var(--mls-ease-spring) var(--mls-dur-2)}',
    '#mlsStages .st .dot svg path{fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}',
    '#mlsStages .st.done .dot{background:#2E6A4B;border-color:#2E6A4B;transform:scale(1.02)}',
    '#mlsStages .st.done .dot svg{opacity:1;transform:scale(1)}',
    /* CURRENT is filled AND ringed. Filled alone is indistinguishable from
       complete for anyone who cannot make out the check; ringed alone left the
       "you are here" mark lighter than every stage behind it, which is what
       the owner was looking at. */
    '#mlsStages .st.now .dot{background:#2E6A4B;border-color:#2E6A4B;',
    'box-shadow:0 0 0 4px rgba(46,106,75,.14);transform:scale(1.15)}',
    '#mlsStages .st.now{color:#204034}',
    '#mlsStages .st.done{color:#4A5B51}',
    /* State in words, for a screen reader, never for the eye. NOT display:none
       — a display:none node is absent from the accessibility tree, which is
       the same as never having written it. The check is the only signal on
       this rail that is not colour, and it belongs to one state of three. */
    '#mlsStages .st .sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;',
    'border:0;overflow:hidden;white-space:nowrap;clip:rect(0 0 0 0);clip-path:inset(50%)}',
    '#mlsStages .bar{flex:1;height:2px;background:#E7E5DD;margin:0 9px;border-radius:2px;overflow:hidden}',
    /* The connector fills with transform, not width.
       It used to be `width:0` + an inline `width:100%` and a
       `transition:width` — a layout property, against law 1, animating a
       reflow every frame. It was also never seen, because renderStages
       rebuilt the whole rail with innerHTML on every stage change and a
       transition needs the SAME element to still be there when the value
       changes. Both halves are fixed: the nodes now persist (see
       buildStages/paintStages) and the fill is composited.
       scaleX from the left edge, so a full connector reads as the progress
       flowing forward into the next stage. */
    '#mlsStages .bar i{display:block;height:100%;width:100%;background:#2E6A4B;',
    'transform:scaleX(0);transform-origin:left center;',
    'transition:transform var(--mls-dur-4) var(--mls-ease-out)}',

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
    /* #mlsToolsMenu was missing from this list. Two surfaces in this stylesheet
       animate with mlsPop - #mlsAskResults and this menu - and only the first
       was named, so the Tools menu kept springing open for a doctor who asked
       the OS for less motion. Measured, not assumed: the popped-open menu
       reported animation-duration 300ms under a reduced-motion emulation. */
    '#mlsDock,#mlsRightNow button,#mlsAskResults,#mlsToolsMenu,',
    'body.mls-calm .view-enter{animation-duration:1ms!important}',
    '#mlsBusy i{animation-duration:2s!important}',
    /* The stage rail is the only surface in this stylesheet whose motion
       carries a transition-DELAY, and the blanket rule below shortens
       durations only — a 200ms delay on the check and a 120ms delay on the
       disc colour would both survive it, so a doctor who asked the OS for less
       motion would still watch the rail light up in pieces. Clearing the
       shorthand zeroes delay along with duration. Every state stays exactly as
       correct as it is with motion on: the classes and the inline scaleX are
       what carry the picture, the transitions only decide how it arrives. */
    '#mlsStages .st .dot,#mlsStages .st .dot svg,#mlsStages .bar i',
    '{transition:none!important}',
    '*{transition-duration:1ms!important}}',

    '@keyframes mlsDockInM{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}',
    '@media (max-width:760px){',
    '#mlsDock{left:8px;right:8px;bottom:8px;transform:none;width:auto;animation-name:mlsDockInM}',
    /* Keep the shipped inset, gap and hidden-Ask behavior. Count horizontal
       padding inside each flex allotment so the seventh button stays inside
       the existing phone dock instead of landing past the viewport edge. */
    '#mlsDock button{min-width:0;flex:1;padding:8px 4px 7px;font-size:10.5px;box-sizing:border-box}',
    /* Scoped by the dock id so it cannot lose a specificity tie to the base rule. */
    '#mlsDock #mlsDockAsk,#mlsDock #mlsDockAsk:focus{width:96px;flex:1 1 auto}',
    '#mlsDock #mlsDockAskWrap{flex:1 1 auto;min-width:0}',
    '#mlsAskResults{width:min(340px,86vw)}',

    /* The stage rail could not show its last stage on a phone. Measured at 375px
       on every build from b581 to b593: clientWidth 336 against scrollWidth 400,
       flex-wrap:nowrap, overflow-x:visible, and body/html overflow-x:hidden with
       NO scrollable ancestor — so "Send", the stage that ends the visit, was cut
       44px past the viewport edge with no gesture that could reach it. It read
       as a four-stage workflow.

       Wrap rather than scroll: a progress rail exists to show every stage at
       once, a horizontal scroller hides the last one behind a gesture nobody is
       told about, and wrapping cannot clip whatever the labels turn out to be in
       another locale. The connectors are decoration — the dots already carry
       done/now — and a connector spanning a line break is worse than none. */
    '#mlsStages{flex-wrap:wrap;row-gap:6px;column-gap:8px}',
    /* ph-stage-1.0.0 — the rail's own type is DEAD CSS, and that is why it wraps.
       Line 617 declares `font:500 12.5px inherit`. `inherit` is a CSS-wide keyword
       and cannot stand in for <family-name> inside the `font` SHORTHAND, so the
       parser throws the WHOLE declaration away — not just the family. Measured on
       the running app: #mlsStages .st computes font-size:16px / font-weight:400.
       It has never once rendered at the 12.5/500 the rail was designed for.

       At the inherited 16px the five stages need 378.7px inside a 361.9px rail at
       402px wide, so the row wrapped and "Send" sat alone on the second line —
       exactly the owner's screenshot. b853 responded by hiding the rail entirely
       (mls-connect.js:46695, `body.mls-phone #mlsStages{display:none}`), but the
       owner runs "Show the full app", which sets sessionStorage mls_phone_mode='0'
       and makes wantPhone() false (mls-connect.js:46635) — so body.mls-phone never
       lands on him and that hide never reached him. Width, not a body class, is
       what a phone fix has to key on here.

       LONGHANDS, deliberately: font-size/font-weight cannot be silently dropped
       the way the shorthand was. (The same invalid `font:...inherit` pattern
       appears 100 times across 37 files in this repo; only the one that produces
       the owner's visible defect is touched here, because correcting the rest is
       a desktop-visible type change that deserves its own before/after pass.)

       MEASURED one-line fit with the values below (12.5px, 14px dot, 5px gap,
       8px column-gap): 295.5px needed against 319.9px available at 360px wide, and
       389.9px at 430px. Below ~347px it wraps again, which is the fallback the
       comment above deliberately chose over a horizontal scroller.
       Confined to this @media (max-width:760px) block, so the desktop rail keeps
       its current type exactly. */
    '#mlsStages .st{font-size:12.5px;font-weight:500;gap:5px}',
    '#mlsStages .st .dot{width:14px;height:14px}',
    /* Connectors are decoration on a phone — the dots already carry done/now,
       and a connector spanning a line break is worse than none.
       THIS LINE CLOSES @media (max-width:760px). It used to sit at the very
       END of the array, which meant everything below — the whole motion
       system, mlsMoRise, the .mls-mo prohibition and the reduced-motion kill
       — was nested inside the phone query and could never apply on a desktop.
       Measured on the running page via document.styleSheets before the fix:
       121 of 143 shell rules page-level, 14 trapped at max-width:760px, 5 of
       them motion. Grep cannot see this; only the CSSOM can. */
    '#mlsStages .bar{display:none}}',

    /* dockspace-1.1.0 gives phone buttons a fixed 52px basis, which places the
       seventh destination beyond the viewport at 390px. Preserve the shipped
       dock inset, gap, bottom position and hidden Ask behavior; only let the
       seven existing destinations share their current row at the 44px floor. */
    '@media (max-width:430px){',
    '#mlsDock>button,html[data-mls-dock-band] #mlsDock>button{min-width:44px!important;flex:1 1 44px!important;',
    'padding-left:2px!important;padding-right:2px!important;box-sizing:border-box}',
    '}',

    /* ---------------- motion system (mls-motion-system) ----------------
       One vocabulary, four durations, three easings. Adopted here and by the
       voice cluster; the older bespoke curves stay where they are rather than
       being rewritten blind across a 40k-line bundle, but nothing NEW should
       invent its own timing again.

       dur-1 press/hover  dur-2 state change  dur-3 entrance  dur-4 view
       ease-out arriving  ease-inout moving in place  ease-spring summoned */
    ':root{--mls-dur-1:120ms;--mls-dur-2:200ms;--mls-dur-3:300ms;--mls-dur-4:420ms;'+
      '--mls-ease-out:cubic-bezier(.2,.7,.3,1);'+
      '--mls-ease-inout:cubic-bezier(.4,0,.2,1);'+
      '--mls-ease-spring:cubic-bezier(.2,.9,.3,1.06)}',

    /* NO VIEW-ENTRANCE RULE HERE, DELIBERATELY. b653 shipped one and it was
       wrong twice over:
         - It could never match. showView (ScribeFlow.html:10423) writes ONLY
           .style.display on the containers (10443-10462) and never classList,
           and the containers carry no class at all — `id="patientsView"
           style="display:none"`. So the rule was dead CSS whose comment
           ("Views arrive rather than appear") asserted behaviour that did not
           exist. A false comment in a file the motion suite pins is worse than
           no comment.
         - Wiring it up would re-introduce a REVERTED design. ScribeFlow.html
           :10440 records the decision: "Routes render immediately at full
           opacity; whole-view fades made every navigation feel like a
           screen-level pop." It would also wrap #patientsView — a
           content-visibility:auto list — in an animated-opacity stacking
           context at boot, on the screen whose TBT is the known problem.

       Press feedback is likewise NOT redeclared here. ScribeFlow.html:10441
       already ships a global `button{transition:transform .07s ease}
       button:active{transform:scale(.97)}`. Adding a near-identical rule at
       .965 was me adding to the exact incoherence this system exists to fix —
       eleven pulses and two spellings of one curve. The incumbent wins. */

    /* Colour/state transitions on the shell's own chrome, which the global
       press rule does not cover. Transform is left to the incumbent. */
    '#mlsDock button,#mlsRightNow button,#mlsStages button'+
      '{transition:background var(--mls-dur-2) var(--mls-ease-inout),'+
      'color var(--mls-dur-2) var(--mls-ease-inout),'+
      'border-color var(--mls-dur-2) var(--mls-ease-inout)}',

    /* The right-now bar is summoned by the user, so it may spring slightly. */
    '@keyframes mlsMoRise{from{opacity:0;transform:translate3d(0,7px,0)}to{opacity:1;transform:none}}',
    '#mlsRightNow:not(.empty){animation:mlsMoRise var(--mls-dur-3) var(--mls-ease-spring)}',

    /* A STANDING PROHIBITION, not a rule for motion that exists today. Nothing
       currently applies .mls-mo — this is here so that the next person to add an
       entrance animation cannot put one inside a host that rebuilds on a timer
       or that a doctor types into. The transcript host is destroyed and rebuilt
       about every 3s and #visitOrdersBody every ~5s with identical markup; an
       entrance rule in there is a permanent flicker in front of someone
       mid-recording, not a flourish. .mls-mo-never is the opt-out for anything
       else that turns out to re-render. Keep this even while it matches nothing. */
    '#visitView .mls-mo,#ez3Wrap .mls-mo,#visitOrdersBody .mls-mo,'+
      '#noteCard .mls-mo,.mls-mo-never,.mls-mo-never *'+
      '{animation:none!important}',

    /* Motion is decoration. Everything above is transform/opacity, so removing
       it changes nothing structural — which is exactly what makes it safe to
       switch off wholesale. */
    '@media (prefers-reduced-motion: reduce){'+
      'body.mls-calm [class*="mls-mo"],#mlsRightNow:not(.empty),'+
      '#mlsDock button,#mlsRightNow button,#mlsStages button'+
      '{animation:none!important;transition:none!important;transform:none!important}}'
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
    studio: '<path d="M12 4l8 4.5-8 4.5-8-4.5z"/><path d="M4 12.5L12 17l8-4.5M4 16.5L12 21l8-4.5"/>',
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
    /* `extra` enriches the segmented row WITHOUT changing where the destination
       lands or whether it survives. The owner's words: "actually make Review
       review, not just orders." It was named Review and went to Orders, while
       the stage bar two rows up uses Review to mean review-the-note — the same
       word meaning two things in one screen.
       The note is reached through nav_visit, so it must NOT be a real target:
       as a target it would become the landing tab (duplicating the Visit dock
       item) and would keep Review alive on accounts that have neither orders
       nor recommendations. As `extra` it is a segment and nothing more. */
    /* 2026-07-28 owner order "put history into the review tab": History rides
       the same extra-segment pattern as The note - clicking it clicks the real
       #nav_history, so #historyView stays the one renderer and the Patient
       destination keeps its own route. nav_visit stays first (pinned). */
    { id: 'review', label: 'Review', targets: ['nav_orders', 'nav_recs'],
      extra: ['nav_visit', 'nav_history'], as: { nav_visit: 'The note', nav_history: 'History' }, count: 'navOrdCount' },
    /* Owner 2026-07-26: "add AI Studio to bottom tool bar." Tools cannot be
       that route: go('tools') opens the shortcuts MENU and never navigates, so
       studioView was reachable from the dock only via a second hop. This is a
       plain navigation destination; Tools keeps the menu role unchanged. */
    { id: 'studio', label: 'AI Studio', targets: ['nav_studio'] },
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

  /* What the segmented row offers: the destination's real targets, plus any
     `extra` the app still offers. Deliberately NOT used by destTarget() or by
     dock visibility — an extra must never decide where a destination lands, nor
     keep a destination alive by itself. Review with no orders and no
     recommendations is still an empty Review, and hides. */
  function destSegments(d) {
    if (!d) return [];
    var real = destTargets(d);
    if (!real.length || !d.extra) return real;
    var seen = {};
    real.forEach(function (t) { seen[t.id] = 1; });
    return real.concat((d.extra || []).map(function (id) {
      return seen[id] ? null : D.getElementById(id);
    }).filter(function (el) { return el && available(el); }));
  }


  /* Which rail tabs each destination covers — used to light the right dock item
     when navigation happens from somewhere else (a link, Ask, a module). */
  var DEST_TABS = {
    day: ['nav_calendar'],
    patient: ['nav_patients', 'nav_history'],
    visit: ['nav_visit'],
    review: ['nav_orders', 'nav_recs'],
    /* nav_studio lights the Studio item, not Tools: currentDest() is
       last-match-wins over these keys, so it must appear in exactly one.
       nav_analysis MOVED HERE from tools, 2026-07-26. Owner: "add the analysis
       tab to the ai studio tab smartly". Analysis is no longer a destination —
       it is AI Studio's Practice section — so anything that navigates to it
       must light AI Studio. Leaving it under tools lit the wrong dock item on
       every route into Practice, which is the dock telling the doctor they are
       somewhere they are not. */
    studio: ['nav_studio', 'nav_analysis'],
    tools: ['nav_team', 'nav_admin', 'nav_legalreq', 'nav_help', 'nav_staffpull']
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
    /* data-mls-no-dictate: the dictate-anywhere chip anchors to a focused
       field's top-right corner - for this input that is the exact spot
       #mlsAskResults opens, and the two collided on the owner's screen. */
    askWrap.innerHTML = '<input id="mlsDockAsk" type="text" autocomplete="off" spellcheck="false" ' +
      'data-mls-no-dictate placeholder="Ask or find anything" aria-label="Ask or find anything">' +
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
     charter (and the coverage suite) forbid.

     FOUR SECTIONS, NOT ONE LIST. Measured on a running page at b685: the menu
     rendered 17 rows flat in 224x718 of clipped, scrolling column, and the flat
     order put "Log out" at position 10 - between "Settings" and "Schedule".
     The one row that ends the session sat in the middle of the practice tools,
     one slip of the finger from a doctor reaching for Schedule mid-clinic.

     The sections are ordered the way a clinic day runs: what you reach for
     mid-encounter, then the practice around it, then the record, then the app
     itself. Log out is last and separated, because it is the only row here
     that is not about the patient in front of you.

     GROUPING MOVES ROWS. IT NEVER DROPS ONE. Every route that was in the flat
     list is in a section, including the ones the assignment did not name
     (nav_*, "Add a visit", "Copy every visit from athenaOne", "Full visit
     notes"): a menu that quietly loses a row is the feature loss this whole
     shell is guarding against. */
  var TOOLS_GROUPS = [
    { id: 'visit', label: 'During a visit', items: [
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
      { id: 'mlsDaDock', as: 'Dictate' },
      { id: 'mlsAsstFab', as: 'MLS Assistant' },
      /* "Draft op note" is deliberately NOT a row here (owner, 2026-08-09:
         "get rid of draft op note and keep prep op notes"). It sat directly
         beside "Prep op notes" and the two read as the same thing, because for
         a bound patient they DO the same thing: #opPrepSmartBtn's openOpPrepSmart
         preps the selected patient, and only falls back to the whole scheduled
         day when no patient is bound (ScribeFlow.html openOpPrepSmart). So the
         capability is NOT stranded by dropping the row -- the row below is the
         single owner of op-note prep, per-patient and per-day.
         The #profileCard button itself stays hidden by PT_MOVED, which is still
         accurate: this shell hides it. Do not re-add it here without also
         deciding which of the two surfaces owns the action. */
      /* Only Snapshot is relocated off the context bar — see CTX_MOVED. After-visit
         summary and Patient portal stay on the bar, so they are deliberately NOT
         listed here; offering them in both places is the duplication this removes. */
      { label: /^snapshot$/i, within: '#patientBar,#mlsCtxBar' },
      /* #43 (owner 2026-07-27: "stat prep should be available from a tool
         section"). Day-level op-note prep is offered ONLY on the Staff prep
         screen (#ez3sPrep "Prep notes", mls-connect.js renderStaff), and that
         node exists only while that screen is rendered, so it can never be a
         Tools row - toolsResolve would drop it silently on every other
         screen. #opPrepSmartBtn is the always-present control the app itself
         ships for the same entry point (openOpPrepSmart: this patient when
         one is bound, otherwise the whole scheduled day), so Tools drives
         THAT node and no handler is duplicated. runControl uses el.click(),
         and openOpPrepSmart is not trusted-gesture gated. */
      { id: 'opPrepSmartBtn', as: 'Prep op notes' }
    ] },
    { id: 'practice', label: 'Practice', items: [
      { label: /^schedule$/i, within: '#profileCard' },
      { id: 'intakeBtn', as: 'Pre-visit intake forms' },
      { label: /^templates$/i, within: '#appHeader' },
      { id: 'customWidgetHdrBtn' },
      /* "Patient intake" and "New patient" are DIFFERENT things and read as the
         same thing, so a doctor reaching for one lands in the other's UI. Named
         here for what each actually does; adding a patient stays a single flow,
         reached from Patients > New patient.
         askCopilotHdrBtn is deliberately absent: Copilot now has its own dock
         button, and listing it here as well is the duplication we are removing. */
      /* 2026-07-28: Ask your data row retired - the dock Ask bar and dock Copilot are the owners. */
      /* "Where pulls run" named a place, not a thing a doctor wants. What they
         are looking for when they open this is whether the pull is happening
         and where - so the row says what it shows. */
      { id: 'mlsPdpSel', as: 'Pull activity' },
      /* nav_studio is AI Studio. Left unlabelled it derived "Tools · PREMIUM"
         from the rail tab, so the Tools menu carried a row called Tools that
         went somewhere else - two controls sharing a label for different
         actions, which the labeling law forbids. */
      /* 2026-07-28: AI Studio row retired here - it has its own dock destination. */
      { id: 'mlsAthenaDoctorBtn', as: 'Troubleshoot Athena' },
      /* nav_analysis is KEPT here, relabelled, 2026-07-26. It is no longer a
         destination of its own — showView('analysis') lands on AI Studio with
         Practice open — but the Tools row is the one place a doctor who is
         looking for the word "Practice" can still find it in a menu, and it now
         says where it goes. Removing it would have been a silent deletion of a
         route the coverage suite already knows about. */
      { id: 'nav_analysis', as: 'Practice trends (AI Studio)' },
      { id: 'nav_team' },
      /* 2026-07-30, MEASURED on a running page: Staff prep had NO visible route
         anywhere in the product. A document-wide sweep for a visible control
         labelled "Staff prep" returned ZERO, and this menu rendered 15 rows,
         none of them Staff prep.
         Two correct decisions collided. #nav_staffpull is retired BY THE APP
         (ScribeFlow.html ships it `hidden` with display:none !important and the
         title "Retired: use Menu for Staff prep and Athena schedule pulls"), so
         available() rightly refused it and this row was dropped silently - the
         same "offered in the spec list is not offered on screen" trap the
         Full-visit-notes row already fell into. Meanwhile the Menu the app's own
         copy points at is itself hidden: the 2026-07-28 owner sweep hides
         #mlsTbMenu because the dock is the menu now. Each owner deferred to the
         other and the capability landed nowhere.
         So Tools drives the CANONICAL Menu row directly. available() ignoring
         "hidden by a shell" is exactly what that function exists for, textOf()
         reads textContent so it resolves inside a hidden subtree, and the row's
         own handler still dispatches mls:menu-staff-prep-request - one Staff
         activation owner, no duplicated handler, and nothing un-retired. */
      { label: /staff prep/i, within: '#mlsTbMenuPanel', as: 'Staff prep' },
      { id: 'nav_legalreq' }
    ] },
    { id: 'data', label: 'Data', items: [
      { label: /^verify saved data$/i, within: '#profileCard' },
      { label: /^share \/ export$/i, within: '#profileCard' },
      { label: /^export everything for emr$/i, within: '#profileCard' },
      /* Owner, 2026-07-28: "the check mark that lets you pull visits is
         gone and needs to be added back but not next to the pull today in
         the settings option." Both halves are honoured here. The row no
         longer targets #mlsDsVisitBodies - the checkbox beside Pull today,
         which this shell hides and which he explicitly does not want back
         there - but #setPullVisitBodies, the Settings copy of the same
         preference, resolved by the ONE resolver (window.__mlsVisitNotesPref).
         `reveal` routes the row THROUGH Settings so he sees a real check
         mark with its state, instead of a hidden box being flipped. */
      { id: 'setPullVisitBodies', as: 'Full visit notes', reveal: 'integrations' },
      { label: /^copy every visit from athenaone$/i, within: '#profileCard' },
      { label: /^add a visit$/i, within: '#profileCard' }
    ] },
    /* `last: true` pins a row to the end of its section behind a rule, wherever
       the app happens to offer it. Log out is the only one, and the flag exists
       so it cannot drift back into the middle the way it already did once. */
    { id: 'app', label: 'App', items: [
      { label: /^settings$/i, within: '#appHeader' },
      { id: 'nav_admin' }, { id: 'nav_help' },
      { label: /^log out$/i, within: '#appHeader', last: true }
    ] }
  ];

  /* The flat view of the same specs. Kept because the reach suite and the
     hidden-controls suite both read this shape, and because "which controls
     does the shell surface" is a question about the set, not the sections. */
  var TOOLS_SOURCES = TOOLS_GROUPS.reduce(function (all, g) {
    return all.concat(g.items);
  }, []);

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

  /* A control that lives INSIDE Settings must never be driven blind. The
     modal is closed while the Tools menu is open, so el.click() would flip
     a checkbox the clinician cannot see - which is the complaint that sent
     us here in the first place. Open Settings, land on the group that owns
     it, and SHOW it. Same doctrine as openCopilot: delegate to the control
     the app already owns, fall back to the global opener only if absent. */
  function revealSetting(it) {
    var el = it && it.el;
    var opener = null;
    /* Scoped to the header on purpose: qsa(sel, null) falls back to the
       whole document, which would let any button reading "Settings"
       anywhere on the page claim this route. */
    var header = qs('#appHeader');
    if (header) qsa('button', header).some(function (b) {
      if (!/^settings$/i.test(textOf(b))) return false;
      opener = b; return true;
    });
    if (opener) opener.click();
    else safe(function () { if (typeof W.openSettings === 'function') W.openSettings(); });
    setTimeout(function () {
      /* The unified Settings owner draws one tab per group. Click its tab
         rather than calling into that module: no new export is needed, and
         the legacy tab model simply has no such button, so it is skipped
         instead of throwing. */
      safe(function () {
        var tab = qs('#settingsTabBar [data-mls-settings-group="' + it.reveal + '"]');
        if (tab) tab.click();
      });
      /* block:"center", never "nearest": the minimum scroll parks a control
         flush with the viewport edge - on screen, focused, and under the
         fixed dock. Shown is not the same as reachable. */
      safe(function () { if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center' }); });
      if (el) spotlight(el);
    }, 240);
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

  function toolsResolve(spec) {
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
    /* A DECLARED label IS a name. This guard used to reject the element
       for having no derivable text ONE LINE before `spec.as` - the field
       that exists to name exactly these controls - was consulted. A bare
       <input type=checkbox> has empty textContent and carries its title
       and aria-label on the wrapping <label>, so EVERY checkbox spec was
       silently dropped. The "Full visit notes" row the shell promises had
       therefore never rendered once, while the reach suite exempted the
       hidden wrapper *because* that row was "offered". Offered in the
       spec list is not offered on screen. */
    if (!available(el) || (!spec.as && !textOf(el))) return null;
    return { el: el, label: spec.as || controlLabel(el), last: !!spec.last, reveal: spec.reveal || '' };
  }

  /* Flat, in section order, so the row index used by the click handler is one
     list however the sections are drawn. Unchanged in what it offers: an absent
     control is still an absent row. */
  function toolsItems() {
    var out = [];
    TOOLS_SOURCES.forEach(function (spec) {
      var it = toolsResolve(spec);
      if (it) out.push(it);
    });
    return out;
  }

  /* The same items, split into the sections they are declared in, with a row
     marked `last` pushed to the end of its own section. Sections with nothing
     available are dropped whole - a caption over no rows is chrome describing
     absence, which is exactly what this menu is being cleaned up to stop. */
  function toolsSections() {
    var out = [], flat = 0;
    TOOLS_GROUPS.forEach(function (g) {
      var head = [], tail = [];
      g.items.forEach(function (spec) {
        var it = toolsResolve(spec);
        if (!it) return;
        it.i = flat++;
        (it.last ? tail : head).push(it);
      });
      out.push({ id: g.id, label: g.label, rows: head, tailRows: tail });
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
    /* ONE resolution pass. toolsSections() and toolsItems() would each walk the
       live DOM, and a control that appeared between the two calls would shift
       every row index after it - the click handler reads data-i, so the doctor
       would press one row and run another. */
    var sections = toolsSections();
    var items = [];
    sections.forEach(function (s) {
      s.rows.concat(s.tailRows).forEach(function (it) { items[it.i] = it; });
    });
    function row(it) {
      /* 2026-07-28 owner order: Tools is a windows-style launcher - icon above, name below. Same rows, same data-i indexing, same resolver; only the cell presentation changed. */
      var nm = it.label.replace(/[<>&]/g, '');
      var ic = it.icon || ({'Dictate':'🎙️','MLS Assistant':'🤖','Draft op note':'📝','Snapshot':'📸','Prep op notes':'📋','Schedule':'📅','Pre-visit intake forms':'🧾','Templates':'📄','Custom widget':'🧩','Pull activity':'📥','Analysis':'📊','Team':'👥','Staff prep':'👩‍⚕️','Legal requests':'⚖️','Verify saved data':'🛡️','Share / Export':'📤','Export everything for EMR':'💾','Full visit notes':'📖','Copy every visit from athenaOne':'📋','Add a visit':'➕','Settings':'⚙️','Admin':'🔐','Help':'🎓','Troubleshoot Athena':'🩺','Log out':'🚪'})[nm] || '🔧';
      return '<div class="r" role="menuitem" tabindex="0" data-i="' + it.i + '"><span class="ri" aria-hidden="true">' + ic + '</span><span class="rn">' + nm + '</span></div>';
    }
    menu.innerHTML = sections.map(function (s) {
      var body = s.rows.map(row).join('');
      var tail = s.tailRows.map(row).join('');
      /* The escape hatch rides the App section rather than floating under the
         whole menu: it is an app-level choice like Settings, and a row with no
         section was the last thing left in the flat list. */
      if (s.id === 'app') {
        /* 2026-07-28 owner order: the Classic layout row is gone - it was a one-way door. ?ui=classic stays as the un-advertised recovery path. */
      }
      if (!body && !tail) return '';
      /* Log out is separated from what precedes it, and only when both exist -
         a rule under nothing is a line for its own sake. */
      var sep = (body && tail) ? '<div class="sep"></div>' : '';
      return '<div class="grp" role="group" aria-label="' + s.label + '">' +
        '<div class="gh" aria-hidden="true">' + s.label + '</div>' +
        body + sep + tail + '</div>';
    }).join('');
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
    function esc(e) {
      if (e.key === 'Escape') { close(); safe(function () { anchor.focus(); }); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
        /* role=menu advertises arrow navigation - honour it over the grid's
           declaration-order Tab walk */
        var rowsK = Array.prototype.slice.call(qsa('.r', menu));
        if (!rowsK.length) return;
        e.preventDefault();
        var iK = rowsK.indexOf(D.activeElement);
        var nK = e.key === 'Home' ? 0 : e.key === 'End' ? rowsK.length - 1 : e.key === 'ArrowDown' ? (iK + 1) % rowsK.length : (iK <= 0 ? rowsK.length - 1 : iK - 1);
        safe(function () { rowsK[nK].focus(); });
      }
    }
    setTimeout(function () { D.addEventListener('click', away, true); }, 0);
    menu.addEventListener('keydown', esc);
    safe(function () { var first = qs('.r', menu); if (first) first.focus(); });

    qsa('.r', menu).forEach(function (row) {
      row.addEventListener('click', function () {
        /* 2026-07-28: data-classic rows no longer render; recovery stays at ?ui=classic. */
        var it = items[parseInt(row.getAttribute('data-i'), 10)];
        close();
        if (!it) return;
        if (it.reveal) { revealSetting(it); return; }
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

  /* The name of the destination the dock is standing on, for the ONE other
     surface that has to agree with it: the top-left title.

     Measured at b685 on a running page, the title read "MLS Scribe" on Review.
     Its owner (syncTitle in feat_mls_redesign.js) reads
     `#mlsRdNav .navtab.on` — SCOPED TO THE RAIL — and #nav_orders is not in
     the rail. It has been relocated into the overflow panel:

       #nav_orders.navtab.nav-feat-off < #mlsTbMenuPanel < #mlsTbMenu
         < #mlsRdMenuSlot < #mlsRdTop < #appHeader

     so the tab carries `.on` and the rail query returns ZERO rows. That is not
     a Review bug; it is every destination whose tab is not in the rail, and it
     fails by rendering the product name, which looks deliberate.

     Deliberately NOT `return DEST.label` for whatever currentDest() reports.
     Destinations cover more than one tab (Patient covers History, AI Studio
     covers Practice), and borrowing the destination's name for those would put
     "Patient" over the History list. So this answers only when the tab that is
     ON is the destination's own LANDING target — the tab go() actually clicks.
     Anything reached past that keeps its own name, via the rail fallback. */
  function activeDestLabel() {
    var id = currentDest();
    if (!id) return '';
    var d = null;
    DEST.forEach(function (x) { if (x.id === id) d = x; });
    if (!d) return '';
    var landing = destTarget(d);
    if (!landing || landing.id !== currentTabId()) return '';
    return d.label || '';
  }

  /* -------------------------------------------------- b841: dock placement
     Persisted per user through the app's own uns() namespace when it is
     available, so the choice follows the account the way every other
     Appearance setting does, and falls back to a device-local key on the
     public/preview shells where uns() is not defined. Any value that is not
     one of the four known sides is treated as the default rather than written
     to the body, because an unknown attribute would match no rule and strand
     the dock with `top:auto;bottom:auto`. */
  var DOCK_SIDES = { bottom: 1, top: 1, left: 1, right: 1 };
  function dockKey() {
    try { if (typeof W.uns === 'function') return W.uns('qolDockSide'); } catch (e) {}
    return 'mls::qolDockSide';
  }
  function dockSide() {
    var v;
    try { v = W.localStorage.getItem(dockKey()) || ''; } catch (e) { v = ''; }
    return DOCK_SIDES[v] ? v : 'bottom';
  }
  function dockVertical() {
    var s = dockSide();
    /* the phone breakpoint forces the bottom rail back, so the pill must be
       measured on the horizontal axis there no matter what is stored. */
    var narrow = false;
    try { narrow = !!(W.matchMedia && W.matchMedia('(max-width:640px)').matches); } catch (e) {}
    return !narrow && (s === 'left' || s === 'right');
  }
  /* A TOP DOCK HAS TO CLEAR WHATEVER IS ALREADY STUCK TO THE TOP, and that is
     not a constant. Two sticky surfaces live up there and both outrank the dock:
     #appHeader (74px, z-index 6000) and #mlsCtxBar, the patient banner
     (z-index 5900). At a fixed top:18px the dock lost 56 of its 85 pixels behind
     the header; moved to 88px it then disappeared behind the patient banner -
     both measured, both plainly visible as a row of half-cut labels. Raising the
     dock's z-index above them was the wrong fix: it would float the navigation
     over the patient's name and DOB, and the banner is the one thing on this
     screen that must never be covered.
     So the offset is measured from whatever is actually stuck up there. Sticky
     elements hold their position once stuck, so this stays correct while
     scrolling; it is recomputed on resize, where the header can reflow. */
  function topDockOffset() {
    var top = 18;
    ['appHeader', 'mlsCtxBar'].forEach(function (id) {
      var el = D.getElementById(id);
      if (!el) return;
      var cs = W.getComputedStyle(el), r = el.getBoundingClientRect();
      if (!/sticky|fixed/.test(cs.position)) return;
      if (r.height < 2 || cs.display === 'none' || cs.visibility === 'hidden') return;
      top = Math.max(top, Math.round(r.bottom) + 12);
    });
    return top;
  }
  function applyDockSide(side) {
    var v = DOCK_SIDES[side] ? side : dockSide();
    try {
      if (v === 'bottom') D.body.removeAttribute('data-mls-dock');
      else D.body.setAttribute('data-mls-dock', v);
    } catch (e) {}
    try {
      if (dockEl) {
        /* A MEASUREMENT TAKEN TOO EARLY MUST NOT BE WRITTEN DOWN. boot() runs
           this before the sticky header has laid out, so topDockOffset()
           returned its 18px floor - and an inline 18px then BEAT the 88px CSS
           fallback, parking the dock back under the header. Measured: inline
           top 18px, dock top 2, covered by #mlsRdTop. So a floor result clears
           the inline value and lets the stylesheet hold the line until a real
           measurement exists. */
        if (v === 'top') {
          var t = topDockOffset();
          if (t > 18) dockEl.style.top = t + 'px';
          else dockEl.style.removeProperty('top');
        } else dockEl.style.removeProperty('top');
      }
    } catch (e) {}
    try { syncDock(); } catch (e) {}
  }
  try {
    W.addEventListener('resize', function () {
      if (dockSide() === 'top') safe(function () { applyDockSide('top'); });
    }, { passive: true });
  } catch (e) {}
  W.applyDockSidePreview = function (side) {
    if (!DOCK_SIDES[side]) side = 'bottom';
    try { W.localStorage.setItem(dockKey(), side); } catch (e) {}
    applyDockSide(side);
    return side;
  };
  W.mlsDockSide = dockSide;

  function syncDock() {
    if (!dockEl) return;
    /* b849: KEEP THE TOP DOCK CLEAR, EVENT-DRIVEN RATHER THAN TIMED. Two
       deferred re-measures (500ms, 1600ms) were not enough - the patient banner
       settles later than both, and the dock stayed parked behind it. syncDock
       already runs on every external DOM change, which is exactly when the
       surfaces above the dock can move, so the offset is recomputed here and
       WRITTEN ONLY ON CHANGE, matching the no-op-write discipline the rest of
       this function was built around. Runs only when the doctor has chosen the
       top dock, so the default path pays nothing. */
    if (dockSide() === 'top') {
      var wantTop = topDockOffset();
      if (wantTop > 18) {
        var px = wantTop + 'px';
        if (dockEl.style.top !== px) dockEl.style.top = px;
      }
    }
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
      var wantDisp = offered ? '' : 'none';
      if (b.style.display !== wantDisp) b.style.display = wantDisp;
      var on = offered && id === active;
      b.classList.toggle('on', !!on);
      /* WRITE ONLY ON CHANGE. setAttribute fires a mutation record even when
         the value is identical, and this pass runs on every external DOM
         change: measured on the owner's signed-in visit screen, 605
         aria-current writes in 40 seconds, EVERY ONE a no-op. The dock is not
         the source of the churn - it was amplifying it for free. */
      var wantCur = on ? 'page' : 'false';
      if (b.getAttribute('aria-current') !== wantCur) b.setAttribute('aria-current', wantCur);
      if (on) activeBtn = b;
    });
    if (pill && activeBtn) {
      /* offsetWidth/offsetLeft are FORCED LAYOUT reads, two per pass, in the
         file the boot lane measured at 29% of boot's 5,576 forced layouts. */
      /* b841: the indicator follows whichever axis the dock is laid out on. The
         write-only-on-change discipline above is kept on BOTH axes, and the
         unused axis is cleared once rather than every pass, so switching sides
         cannot leave a stale width pinning the pill to the old orientation. */
      if (dockVertical()) {
        var h = activeBtn.offsetHeight + 'px';
        var ty = 'translateY(' + (activeBtn.offsetTop - 6) + 'px)';
        if (pill.style.width !== '') pill.style.width = '';
        if (pill.style.height !== h) pill.style.height = h;
        if (pill.style.transform !== ty) pill.style.transform = ty;
      } else {
        var w = activeBtn.offsetWidth + 'px';
        var tx = 'translateX(' + (activeBtn.offsetLeft - 6) + 'px)';
        if (pill.style.height !== '') pill.style.height = '';
        if (pill.style.width !== w) pill.style.width = w;
        if (pill.style.transform !== tx) pill.style.transform = tx;
      }
      if (pill.style.opacity !== '1') pill.style.opacity = '1';
    } else if (pill && pill.style.opacity !== '0') {
      pill.style.opacity = '0';
    }
    qsa('.mls-dock-count', dockEl).forEach(function (c) {
      var src = D.getElementById(c.getAttribute('data-count'));
      var n = src ? parseInt(textOf(src), 10) : 0;
      if (!isFinite(n) || n <= 0) { c.classList.remove('show'); return; }
      /* Assigning textContent replaces the text node, so an unchanged count
         still fires a childList record: 121 of them in the same 40 seconds. */
      var want = n > 99 ? '99+' : String(n);
      if (c.textContent !== want) c.textContent = want;
      /* 108 no-op class writes in 23s: adding a class an element already
         carries still notifies every attribute observer. */
      if (!c.classList.contains('show')) c.classList.add('show');
    });
  }

  function markViewEnter() {
    var v = activeAppView();
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
    /* NO ACTIONS ON THE PATIENT SCREEN. Deliberately empty, and it must stay
       empty — this is not a list waiting to be filled back in.

       The lead's b685 walkthrough on the owner's signed-in tab saw a strip
       reading "Start visit | New patient | Pull from Athena · READ-ONLY" above
       a screen that already offers all three, better placed. Measured here at
       b685, 1280x850, signed in with a patient open:

         strip      #mlsRightNow            1216x59, three buttons
           "Start visit"                     100x37
           "New patient"                     115x37
           "Pull from Athena · READ-ONLY"     244x37
         the same three, already on the screen underneath it:
           #profileCard "🎙️ Start visit"     688x62   <- the visit hero
           #ptNewBtn    "＋ New patient"      128x37
           #ptPullAthenaBtn                   250x42

       So every action here was a second, SMALLER offer of a control the doctor
       can already see. That breaks two rules at once: one offer per action per
       screen (law 4), and — worse — a 100x37 "Start visit" competing with the
       688x62 hero for the same job, so the biggest thing on screen is no longer
       unambiguously the next step (law 3).

       Nothing is hidden and nothing needs a route back: the keepers are the
       app's own controls, in place, at full size. The three ids are still
       offered by Ask, and #ptIntakeBtn was app-gated to 0x0 in that state
       anyway. The key stays (rather than being deleted) so the destination can
       still render its SEGMENTED row — Patients / History is navigation, not a
       duplicated action, and returns by itself if History is ever unfolded. */
    patient: [],
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
    /* NO ACTIONS ON THE VISIT SCREEN EITHER — same ruling as `patient` above,
       owner-escalated 2026-07-26 ("I've asked many times"): this bar rendered
       "Start Recording — <patient> · <dob> · …" at 734x37 directly above a
       720x82 hero (#ez3ActiveGo / #ez3Nxt) offering the SAME action in the
       SAME words. vf-1.0.0 gives the visit view ONE state-driven primary at
       hero size for every phase (record / stop / generate / sign), so any
       entry this list could hold is by construction a second, smaller offer
       of a control already on screen (laws 3, 4, 15). The key stays so the
       destination can still render its segments — navigation, not actions. */
    visit: [],
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
    var sibs = destSegments(destDef);

    /* Re-render only when the bar would actually change. The visit view mutates
       continuously while a transcript streams in, and rebuilding on every one of
       those would restart each button's entrance animation 60 times a second —
       a flickering toolbar in front of a doctor mid-recording. */
    var sig = dest + '|' +
      sibs.map(function (t) { return t.id + (t.classList.contains('on') ? '*' : ''); }).join(',') + '|' +
      picked.map(function (p) { return (p.as || controlLabel(p.el)) + (p.primary ? '!' : ''); }).join(',');
    /* The `bar.childNodes.length` half of this guard was written before b582
       let the bar render EMPTY. In that state childNodes.length is 0, so the
       guard was always falsy and the function fell through to the empty branch
       on every single tick — the one case the guard above most needed to catch.
       MEASURED: #mlsRightNow.innerHTML written 60 times per 40 idle seconds and
       289 times in 5 seconds under transcript-like mutation, every write
       byte-identical, dragging syncDock/renderStages/prepRows/contextBar along
       with it at frame rate. Treat "legitimately empty" as a rendered state
       rather than as evidence the render never happened. */
    if (sig === lastRnSig && (bar.childNodes.length || bar.classList.contains('empty'))) return;
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

    /* When the bar holds nothing but actions, it stops being a panel.
       Measured on the running page at b654 it was 407x65 whose entire content
       was the caption "Right now" and ONE 181x44 button — a bordered, shadowed,
       20px-padded card built to hold a segmented row that was not there. The
       owner: "I absolutely hate the top Right now then the button next to it."
       With no segments there is no group to draw a box around, so the box goes
       and the action stands on its own. The card returns the moment segments do. */
    var bare = sibs.length <= 1;
    if (bar.classList.contains('bare') !== bare) bar.classList.toggle('bare', bare);

    if (sibs.length > 1) {
      var seg = D.createElement('span');
      seg.className = 'seg';
      seg.setAttribute('role', 'tablist');
      sibs.forEach(function (tab) {
        var s = D.createElement('button');
        s.type = 'button';
        s.className = 'segbtn' + (tab.classList.contains('on') ? ' on' : '');
        s.setAttribute('data-mls-proxy', '1');
        s.setAttribute('role', 'tab');
        s.setAttribute('aria-selected', tab.classList.contains('on') ? 'true' : 'false');
        /* Same idiom the right-now buttons already use for an aliased control:
           show the alias, and DISCLOSE the real control in the title. A segment
           that silently renamed a rail tab would be the shell claiming
           authorship of a control it only proxies. */
        var alias = (destDef && destDef.as) ? (destDef.as[tab.id] || '') : '';
        s.textContent = alias || controlLabel(tab).replace(/\s*\d+$/, '');
        if (alias) s.title = 'Opens "' + controlLabel(tab).replace(/\s*\d+$/, '') + '"';
        s.addEventListener('click', function () {
          tab.click();
          markViewEnter();
          setTimeout(function () { safe(syncDock); safe(renderRightNow); safe(renderStages); }, 60);
        });
        seg.appendChild(s);
      });
      bar.appendChild(seg);
    }

    /* NO VISIBLE "Right now" LABEL. The owner, 2026-07-25: "I absolutely hate
       the top Right now then the button next to it."
       He is right, and the word was never doing any work. It is chrome
       explaining chrome: a fixed caption in front of buttons that already say
       what they do, so "Start visit" was read as "Right now  Start visit" every
       single time, and the caption never changed. b582 already found the same
       word to be the entire content of an empty bar and hid it in that case;
       this finishes the thought for the full case too.
       Nothing is lost for assistive tech — the bar itself carries
       aria-label="Right now" (see mountRightNow), so the region keeps its name
       while the eye gets the actions unprefixed. */

    if (!picked.length) {
      var note = D.createElement('span');
      note.className = 'note';
      note.textContent = 'Nothing to do here yet';
      bar.appendChild(note);
    }

    picked.forEach(function (p, i) {
      var b = D.createElement('button');
      b.type = 'button';
      /* This button is a REFERENCE to p.el, not the control. Decorators that match
         controls by label must not treat it as one - feat_athena_clarity.js did,
         and appended a visible sub-label paragraph and a READ-ONLY chip into the
         toolbar, which is the welding the owner actually saw. */
      b.setAttribute('data-mls-proxy', '1');
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
  /* 'SOURCE' LEADS, AND ITS ABSENCE FROM THIS LIST WAS THE DEFECT.
     ---------------------------------------------------------------------
     buildPrepSummary emits `SOURCE: NOT PULLED from Athena yet — no card on
     this record has been read from the chart` (mls-connect.js:2237) whenever
     nothing landed. This list is what prepRows renders, and it did not contain
     SOURCE — so the one line that says the chart was never read was generated
     and then never shown. The raw block that holds it is clipped to 1x1px and
     the duplicate node is display:none, so a day on which EVERY chart was
     refused rendered as a calm, complete-looking box.

     That is exactly what the owner reported on 2026-08-06 as "it says every
     patient is alergic to the same thing" and "the summary in the top doesnt
     show up": one event — every chart refused at the coverage gate, nothing
     saved — produces BOTH symptoms at once, because every patient then shows
     the same byte-identical "No Athena history pulled for this patient yet."
     A shipped comment at ScribeFlow.html:15566 records the same appearance
     measured on 2026-07-29 (15 of 19 patients with no landed chart), in his
     words: "one patient's history looked duplicated onto everyone else."

     SOURCE is first so the refusal leads rather than trailing six rows of
     "Not recorded". When a chart DID land, buildPrepSummary emits no SOURCE
     line, the regex below simply finds nothing, and no row is added — so this
     is inert on the healthy path and visible only when there is bad news.
     An invisible failure is indistinguishable from success; this product's
     worst recurring defect is a refusal nobody can see. */
  var PREP_LABELS = ['SOURCE', 'ALLERGIES', 'PROBLEMS', 'MEDICATIONS', 'VITALS', 'HISTORY', 'LAST VISIT'];
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
    /* Patricia Kirwin, live 2026-08-08: her card's dashes were HONEST but
       INVISIBLE honesty - a never-read record (no coverage receipt, no chart
       content; 1,340 of 1,567 records) looked identical to a read-and-thin
       one, and its stored default NKDA read as a chart fact. Three states,
       never two: NEVER-READ says "not pulled yet" in words; a landed chart's
       empty field keeps the quiet dash; content renders as content. The
       never-read test rides the app's own receipt predicate, never a guess. */
    var neverRead = false;
    try {
      var apPt = (typeof window.activePatient === 'function') ? window.activePatient() : null;
      if (apPt && typeof window._athenaChartLanded === 'function') neverRead = !window._athenaChartLanded(apPt);
    } catch (eNr) {}
    host.innerHTML = found.map(function (f) {
      var empty = PREP_EMPTY.test(f.value);
      var val;
      if (empty && neverRead) {
        val = '<span class="v none" title="No Athena chart has been pulled for this patient yet - these fields are unread, not empty.">not pulled yet</span>';
      } else if (empty) {
        val = '<span class="v none" title="Not captured. This does not mean the chart is empty - re-pull to check.">—</span>';
      } else if (neverRead && /^\s*(?:nkda|nka|no known (?:drug )?allerg(?:y|ies))\b/i.test(f.value)) {
        /* Owner 2026-08-09 ("every person is allergic to NKDA"): a FILLED default
           on a never-read record slipped the three-state (which fires on EMPTY)
           and presented as a chart fact. b967 annotated the profile surface;
           this is the same honesty on the prep card. A default is not an answer. */
        val = '<span class="v" title="This value was never read from an Athena chart - it is a stored default, not a verified chart fact. Pull the chart to verify.">' + f.value.replace(/[<>&]/g, '') + ' — unverified (no Athena chart pulled yet)</span>';
      } else {
        val = '<span class="v" title="' + String(f.full || f.value).replace(/[<>&"]/g, '').slice(0, 600) +
          '">' + f.value.replace(/[<>&]/g, '') + '</span>';
      }
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
  var PT_KEEP_OPEN = ['mlsEpTopBox', 'mlsEpRisksBox', 'mlsEpSummaryBox', 'pf2Quick', 'pf2ExpandAll']; /* 2026-07-28: the quick row and its Expand control are never adoptable folds */
  var PT_KEEP_OPEN_TEXT = /problem list/i;

  function foldTitle(block) {
    var head = block.children[0];
    return head ? textOf(head).slice(0, 60) : '';
  }

  /* Eight actions competed at the top of one patient. These move to the Tools
     menu (which matches on availability, so a control hidden by THIS shell is
     still offered). Marked with a class rather than a blanket CSS rule so only
     the controls actually relocated are hidden - anything new that appears in
     that header keeps showing until someone decides where it belongs.

     START VISIT IS NOT ONE OF THEM, and used to be. The intent was that it
     "becomes the right-now bar's primary", but MEASURED on the running page at
     b676 the two surfaces it landed on were both losing:
       #profileCard  "Start visit"  93x26  = 2,405px^2, at opacity .5 --
                     the FOURTH SMALLEST control on a screen of 36, while
                     "Copy every visit from athenaOne" next to it was 13,536px^2
       #mlsRightNow  "Start visit"  100x37 = 3,700px^2, sitting beside
                     "Pull from Athena - READ-ONLY" at 244x37 = 9,028px^2
     So the one thing a doctor opens a patient to do was, on both surfaces, the
     smallest thing offered. Demoting a screen's PRIMARY is not decluttering.
     It stays in the header and feat_mls_visit_focus.js makes it the hero;
     everything genuinely secondary still moves, exactly as before.

     Dropping `moved:true` from the ACTIONS entry below is part of the same fix
     and closes a second defect: `moved` skips the VISIBILITY test, so with no
     patient selected -- #profileCard display:none -- the bar still offered
     "Start visit" for nobody. */
  var PT_MOVED = /^(schedule|draft op note|share \/ export|export everything for emr|verify saved data|copy every visit from athenaone|add a visit)$/i;

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

  /* The patient card carries four visible buttons that all read "✎ Edit" and
     announce exactly that — Reason for visit, Key risks & reminders, Vitals,
     and History & background. Measured on the running page at b587: tabbing
     them says "Edit, Edit, Edit, Edit", and not one had an aria-label or a
     title. The short visible text is deliberate and stays; only the ACCESSIBLE
     name changes, so there is no visual change at all. */
  /* Widened from #profileCard to the whole visible view after two narrower
     heuristics were tried and rejected against the live DOM. Recorded because
     the rejected ones look reasonable and will be proposed again:

       subtract only the control's OWN words   #profileCard 9/9 right
                                               #visitView   names controls after
                                                            the sibling BUTTON:
                                                            "Copy — Print",
                                                            "Print — Copy"
       prefer an inert sibling ELEMENT         #visitView   readable
                                               #profileCard 8 of 9 WORSE, and it
                                                            lifted patient data
                                                            into the name:
                                                            "Edit — Sample
                                                            medication 10 mg
                                                            daily"

     What actually works is subtracting EVERY control's text from the container,
     because the two regions differ only in where the buttons sit: the patient
     card puts them beside the heading, the visit screen puts them INSIDE it
     ("<h3>Patient after-visit summary Copy Print</h3>"). Removing all control
     text leaves the heading's own words in both shapes. The inert-sibling walk
     survives as a fallback for rows that are nothing but controls.

     An aria-label REPLACES the visible text for a screen reader, so a wrong
     name is worse than a generic one and clinical detail must never reach one —
     that is why this was measured on the running page before shipping rather
     than reasoned about. Guarded by
     tests/calm-shell-generic-naming-scope.test.js. */
  var GENERIC_LABEL = /^(edit|copy|clear|add|remove|open|view|more|refresh|print|save|delete)$/i;

  /* Read the section from the row the control sits in, by subtracting the
     control's own words from its container's. Hunting a heading ELEMENT fails
     here: several of these rows title themselves with a bare text node, and
     the ones that do use an element put the button inside the same heading. */
  var CTRL_SEL = 'button,a[href],input,select,textarea,[role="button"]';

  /* 3..60 chars, and never an opaque identifier — a run id like
     PF-RUN-20260725-96375 is a worse name than none. */
  function usableName(t) {
    return t.length >= 3 && t.length <= 60 && !/^[A-Z0-9-]{8,}$/.test(t);
  }

  /* The container's text with EVERY control's text removed, which leaves the
     heading's own words whether the buttons sit beside the heading (patient
     card) or inside it (visit screen). Capped by usableName, because one level
     above the row textContent becomes the whole card. */
  function inertText(node) {
    var t = normLabel(node.textContent || '');
    if (!t) return '';
    var ctrls = node.querySelectorAll ? node.querySelectorAll(CTRL_SEL) : [];
    for (var i = 0; i < ctrls.length; i++) {
      var ct = normLabel(ctrls[i].textContent || '');
      if (ct) t = t.split(ct).join(' ');
    }
    return t.replace(/\s+/g, ' ').trim();
  }

  /* Fallback for a row that is nothing BUT controls, where the subtraction
     above empties the string: the nearest sibling that carries no control. */
  function inertSibling(node, el) {
    var kids = node.children || [];
    for (var i = 0; i < kids.length; i++) {
      var kid = kids[i];
      if (kid === el || kid.contains(el)) continue;
      if (kid.matches && kid.matches(CTRL_SEL)) continue;
      if (kid.querySelector && kid.querySelector(CTRL_SEL)) continue;
      var t = normLabel(kid.textContent || '');
      if (usableName(t)) return t;
    }
    return '';
  }

  function sectionNameFor(el) {
    var node = el.parentElement;
    for (var i = 0; i < 5 && node; i++) {
      var t = inertText(node);
      if (usableName(t)) return t;
      node = node.parentElement;
    }
    node = el.parentElement;
    for (var j = 0; j < 5 && node; j++) {
      var s = inertSibling(node, el);
      if (s) return s;
      node = node.parentElement;
    }
    return '';
  }

  function nameIfGeneric(b) {
    var flat = normLabel(b.textContent || '');
    if (!GENERIC_LABEL.test(flat)) return;
    /* Never overwrite a name the APP chose; only one this pass wrote. */
    if (b.getAttribute('aria-label') && !b.getAttribute('data-mls-secname')) return;
    /* sectionNameFor walks up to five ancestors reading textContent, so it is
       the expensive half. Skip it for a control already named for this label —
       a re-rendered node is a NEW node and carries no flag, so a card that
       rebuilds still gets re-derived. */
    if (b.__mlsSecSig === flat && b.getAttribute('data-mls-secname')) return;
    b.__mlsSecSig = flat;
    var section = sectionNameFor(b);
    if (!section) return;
    var name = flat + ' — ' + section;
    if (b.getAttribute('aria-label') === name) return;
    b.setAttribute('aria-label', name);
    b.setAttribute('data-mls-secname', '1');
  }

  /* Scoped to the ONE visible view, not the document. Measured at b599: a
     generic-label scan costs 0.19ms inside the visible view against 2.1ms
     document-wide, on a 3.27ms render pass — and controls in hidden views are
     not something a doctor can meet anyway, which is the same rule Ask already
     follows. Named regardless of the control's own visibility inside that view,
     so a collapsed card is already correct the instant it opens rather than
     announcing a bare "Copy" until the next render lands. */
  function nameGenericInView() {
    if (!W.__mlsCalmShell.active) return;
    var view = activeAppView();
    if (!view) return;
    qsa('button,[role="button"]', view).forEach(function (b) {
      if (b.closest && b.closest('#mlsDock,#mlsRightNow,#mlsToolsMenu,#mlsAskResults,#mlsPrepRows')) return;
      nameIfGeneric(b);
    });
  }

  function patientScreen() {
    if (!W.__mlsCalmShell.active) return;
    var card = qs('#profileCard');
    if (!card || !visible(card)) return;

    qsa('button,.btn-primary,.btn-ghost,.btn-green', card).forEach(function (b) {
      if (b.closest && b.closest('#mlsPrepRows,#mlsRightNow')) return;
      nameIfGeneric(b);
      if (!PT_MOVED.test(textOf(b))) return;
      b.classList.add('mls-moved');
    });

    wireFolds();

    /* b749 (owner 2026-07-27: "the arrows do not work"). The five chart-section
       rows are built by __mlsProfCalm (pf2-1.1.0) as direct children of
       #profileCard, each with its own header BUTTON, its own arrow and its own
       open class. This shell adopted them as folds and BOTH mechanisms then
       died on the same row:
         - our display:none!important on a non-open fold body outspecifies the
           pf2 rule .pf2-sec.open .pf2-b{display:block} (1,4,1 against 0,3,0,
           and ours is important), so the pf2 click toggled a class that could
           no longer reveal anything;
         - our delegated toggle bails when the click lands on a control that
           belongs to the block, via e.target.closest("button,a,input,select,
           textarea") - and a pf2 header IS a button, so that matched every
           time and .mls-open was never set either.
       On top of that our ::after drew a chevron beside the pf2 triangle, which
       is the two arrows the owner is looking at. A block that is ALREADY a
       disclosure does not need a second one: stand down (see the pf2-sec skip
       in the adopt loop below) and un-stamp anything an earlier pass claimed,
       so the fix is self-healing rather than dependent on module load order.
       aria-expanded is deliberately NOT removed here: pf2 owns that attribute
       now and this pass must not fight its state. */
    qsa('.pf2-sec.mls-fold', card).forEach(function (sec) {
      sec.classList.remove('mls-fold');
      sec.classList.remove('mls-open');
      var hd = sec.children[0];
      if (!hd) return;
      hd.classList.remove('mls-fold-hd');
      hd.removeAttribute('role');
      hd.removeAttribute('tabindex');
    });
    /* Re-assert the click target on blocks already folded, in case they
       re-rendered their heading since the last pass. */
    qsa('.mls-fold', card).forEach(markFoldHead);

    qsa(':scope > div, :scope > section', card).forEach(function (block) {
      if (block.id === 'mlsPrepRows') return;
      if (PT_KEEP_OPEN.indexOf(block.id) !== -1) return;
      if (PT_KEEP_OPEN_TEXT.test(foldTitle(block))) return;
      if (block.children.length < 2) return;          /* nothing to fold */
      /* b749: pf2 rows are already disclosures with their own arrow, their own
         open class and their own delegated handler. Folding them a second time
         is what killed both mechanisms and drew the second arrow. */
      if (block.classList.contains('pf2-sec')) return;
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
    /* 2026-07-30, owner: "started recording but indicater at the top stayed at
       prep and did not go to record".
       Record was detected ONLY while a Stop control was on screen - that is, only
       DURING active capture. The moment he paused or stopped, that control becomes
       "Resume recording", the Stop match fails, and the rail fell all the way back
       to Prep: the stage went BACKWARDS and threw away the fact that recording had
       happened. The chip row at the bottom of the same screen was showing
       "check Record" at that moment, so two progress indicators on one screen
       disagreed - and the rail was the wrong one.
       A Resume control cannot exist unless recording already started, so its
       presence is the app's own evidence that the Record stage was reached. That
       keeps this function's stated law intact: read the evidence, never guess. */
    var resumable = findControl({ label: /resume\s*recording/i, within: '#visitView' });
    if (resumable) return 1;
    var signable = findControl({ label: /^(sign|save to athena|send to athena)/i, within: '#visitView' });
    var noteText = '';
    var ta = qsa('textarea,[contenteditable="true"]', visit).filter(visible)[0];
    if (ta) noteText = (ta.value || ta.textContent || '').trim();
    if (signable && noteText.length > 40) return 3;
    if (noteText.length > 40) return 2;
    return 0;
  }

  /* Heads-down is an active-recording affordance, not a generic Record-stage
     affordance. A stopped visit intentionally keeps a visible Resume button,
     so stageNow() remains 1 for progress purposes; that must never re-arm the
     three-second auto-hide timer. Require visible Pause/Stop or the recorder's
     own active flag/text instead. */
  function captureActuallyRecording() {
    var visit = qs('#visitView');
    if (visit && visible(visit)) {
      var stopping = findControl({ label: /\b(?:pause|stop)\b/i, within: '#visitView' });
      if (stopping) return true;
    }
    var capture = qs('#captureBtn');
    if (!capture || !visible(capture)) return false;
    return capture.classList.contains('recording') ||
      /\b(?:recording|stop visit|stop recording)\b/i.test(String(capture.textContent || ''));
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

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* THE RAIL'S WRITE SIGNATURE: the stage index AND how many stages there are.
     Both, because the stage list is data. A rail built for four stages showing
     index 3 is not the same picture as a five-stage rail showing index 3, and
     a signature of the index alone would leave the old rail on screen forever
     the day STAGES grows.
     It is stamped on the ELEMENT rather than kept in a module variable so that
     it travels with the nodes it describes: teardown removes the rail and the
     stamp goes with it, and a rail rebuilt from scratch cannot inherit a
     signature that describes markup which no longer exists. */
  function stageSig(now) { return now + ':' + STAGES.length; }

  /* Build the rail's nodes ONCE.
     ------------------------------------------------------------------
     A CSS transition needs the SAME element to still be in the document when
     the value changes. The old renderStages did

       el.innerHTML = parts.join('')

     on every stage change, which destroyed and recreated all nine nodes with
     their final classes already applied. Every transition declared on .dot
     and .bar i was therefore dead CSS — the rail SNAPPED.

     Measured on the running page, driving a real Prep -> Review change and
     sampling document.getAnimations() every 25ms for three seconds:
       animations observed on the rail : 0
       stamped nodes surviving         : 0 of 9  (5 .st + 4 .bar i replaced)
     A previous report read the declaration and concluded the dots already
     glided. The declaration was there; the motion never was. Verify on the
     running page, not the stylesheet.

     So: build once, then only move classes and one transform.

     Built with real nodes rather than one innerHTML string. The rail is built
     once per mount so neither form costs anything measurable, but an SVG check
     assembled by the HTML parser has to be spelled correctly in a template
     literal to end up in the SVG namespace at all, and this is the file where
     a declaration that was read but never ran cost a build. Nodes are the form
     that can be executed in a harness and counted. */
  function buildStages(el) {
    /* The stamp describes THESE nodes, so it dies with them — otherwise a rail
       whose children were emptied by something else would be re-built and then
       skipped by the paint guard, leaving five hollow circles forever. */
    el.__mlsStageSig = '';
    while (el.firstChild) el.removeChild(el.firstChild);
    STAGES.forEach(function (name, i) {
      var st = D.createElement('span');
      st.className = 'st';
      var dot = D.createElement('span');
      dot.className = 'dot';
      var svg = D.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('focusable', 'false');
      var tick = D.createElementNS(SVG_NS, 'path');
      tick.setAttribute('d', 'M4.2 8.4 6.9 11.1 11.8 5.4');
      svg.appendChild(tick);
      dot.appendChild(svg);
      st.appendChild(dot);
      st.appendChild(D.createTextNode(name));
      /* The stage's state in words, for a screen reader. Written here empty and
         filled by paintStages, so the state has exactly one writer. */
      var sr = D.createElement('span');
      sr.className = 'sr';
      st.appendChild(sr);
      el.appendChild(st);
      if (i < STAGES.length - 1) {
        var bar = D.createElement('span');
        bar.className = 'bar';
        /* The connector is decoration: the discs and the per-stage state text
           carry the whole picture, so a screen reader is told nothing twice. */
        bar.setAttribute('aria-hidden', 'true');
        bar.appendChild(D.createElement('i'));
        el.appendChild(bar);
      }
    });
  }

  /* Move the state onto the existing nodes. Nothing here creates or removes an
     element, which is the whole point. */
  function paintStages(el, now, sig) {
    /* WRITE-ONLY-ON-CHANGE, second tier. renderStages already returns early on
       an unchanged stage; this guard is what makes the property true of
       paintStages ITSELF, so a caller that arrives another way — a rebuild that
       left lastStage stale, __mlsCalmShell.render driven from a probe — still
       performs zero DOM writes when the picture on screen is already correct.
       Measured in tests/visit-stage-rail-fills.test.js, which runs this region
       in a counting stub DOM: mounting and painting the rail once is 99 writes
       across 108 node operations, and then 50 unchanged renders are 0 and 0.
       One repaint at an unchanged stage costs 10 operations, which is what
       this early return is worth on every #visitView mutation. */
    if (el.__mlsStageSig === sig) return;
    el.__mlsStageSig = sig;
    var sts = el.querySelectorAll('.st');
    var bars = el.querySelectorAll('.bar i');
    var i;
    for (i = 0; i < sts.length; i++) {
      var done = i < now;
      var cur = i === now;
      /* classList.toggle(name, force) does NOT re-commit when the state is
         already correct; add/remove re-commit unconditionally and this runs on
         the shell's tick, so add/remove here would be a whole-document style
         recalculation several times a second for no visual change. */
      sts[i].classList.toggle('done', done);
      sts[i].classList.toggle('now', cur);
      /* aria-current marks EXACTLY ONE stage, and only while a stage is
         current: at now === -1 the view is not in a visit, and claiming a
         current step would be this rail asserting something the view never
         said. setAttribute fires a mutation record even for an identical
         value, so both directions are guarded. */
      if (cur) {
        if (sts[i].getAttribute('aria-current') !== 'step') sts[i].setAttribute('aria-current', 'step');
      } else if (sts[i].getAttribute('aria-current') !== null) {
        sts[i].removeAttribute('aria-current');
      }
      /* Not conveyed by colour alone. The filled disc and the check are the
         visual signal; this is the same three-way state in words. */
      var word = done ? 'completed' : (cur ? 'current step' : 'not started');
      var sr = sts[i].querySelector('.sr');
      /* Assigning textContent replaces the text node and fires a childList
         record even for a byte-identical string. */
      if (sr && sr.textContent !== word) sr.textContent = word;
    }
    for (i = 0; i < bars.length; i++) {
      /* The connecting track fills up TO the current stage: connector i sits
         between stage i and stage i+1, so the filled length is a pure function
         of the stage index. */
      var want = i < now ? 'scaleX(1)' : 'scaleX(0)';
      /* Guard the write for the same reason: an identical inline style
         assignment still dirties the element. */
      if (bars[i].style.transform !== want) bars[i].style.transform = want;
    }
  }

  function renderStages() {
    if (!W.__mlsCalmShell.active) return;
    var visit = qs('#visitView');
    var el = qs('#mlsStages');
    /* Both display writes sit BEFORE the lastStage guard below, so they ran on
       every pass regardless of whether anything changed. */
    if (!visit || !visible(visit)) { if (el && el.style.display !== 'none') el.style.display = 'none'; return; }
    el = ensureStages();
    if (!el) return;
    if (el.style.display !== 'flex') el.style.display = 'flex';
    var now = stageNow();
    var sig = stageSig(now);
    /* ensureStages() hands back an EMPTY div when the rail had been removed, so
       "already built" is a property of the DOM, not of lastStage. */
    var built = el.childNodes.length > 0;
    if (now === lastStage && built) return;
    lastStage = now;
    if (!built) buildStages(el);
    /* On the very first paint the nodes were created microseconds ago and have
       no previous computed value, so this lands instantly — which is correct:
       opening a visit should show the rail's true state, not replay it. Every
       LATER change transitions, because the nodes persist. */
    paintStages(el, now, sig);
    /* Guarded like everything else in this pass: an identical setAttribute
       still fires a mutation record, and this element carries aria-live. */
    var label = now >= 0 ? 'Visit progress: ' + STAGES[now] : 'Visit progress';
    if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
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

  function clearHeadsDown() {
    if (D.body) D.body.classList.remove('mls-headsdown');
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    var hint = qs('#mlsHeadsDownHint');
    if (hint && hint.parentNode) hint.parentNode.removeChild(hint);
  }

  function wake() {
    clearHeadsDown();
    if (!headsDownOn()) return;
    if (stageNow() !== 1 || !captureActuallyRecording()) return;
    idleTimer = setTimeout(function () {
      idleTimer = null;
      if (stageNow() === 1 && captureActuallyRecording()) { ensureHint(); D.body.classList.add('mls-headsdown'); }
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
    if (stageNow() !== 1 || !captureActuallyRecording()) return;
    idleTimer = setTimeout(function () {
      idleTimer = null;
      if (stageNow() === 1 && captureActuallyRecording()) { ensureHint(); D.body.classList.add('mls-headsdown'); }
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
  var DESTRUCTIVE = /remove|delete|purge|discharge|sign|send to athena|place order|log out|clear|discard|reset|erase|wipe|end visit|new visit|start over/i;

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
        /* Not a control name -> hand the question to Copilot instead of
           dead-ending. The row is a REAL result: Enter, arrows and click all
           run through the same choose() path as every other row, so a typed
           question is never swallowed (the owner's report, 2026-07-26).
           2026-07-30, MEASURED: this field is now the ONLY visible find/search
           control in the whole document - a live sweep found exactly one, this
           one - because the 2026-07-28 sweep hides the top bar's
           #mlsPqsInput ("Find patients and screens…") as a duplicate of this
           bar. It is not a duplicate: indexControls() knows CONTROL names and
           has never known patients, so a doctor typing a patient's name into a
           field labelled "Ask or find anything" was handed to Copilot as a
           question and the app had no way left to find a patient by name.
           So the first row hands the words to the patient finder the app
           already owns. Offered only when that finder exists, and it is an
           OFFER - it claims no match it has not made. */
        var qRaw = input.value.trim();
        var canFind = typeof W.mlsQuickFind === 'function';
        var safeQ = qRaw.replace(/[<>&]/g, '');
        results = canFind ? [{ finder: true, q: qRaw }, { copilot: true, q: qRaw }] : [{ copilot: true, q: qRaw }];
        sel = 0;
        panel.innerHTML = '<div class="none">Nothing here is called that.</div>' +
          (canFind ? '<div class="r sel" role="option" data-i="0">&#128269; Find a patient or screen: "' +
            safeQ + '"<small>Enter</small></div>' : '') +
          '<div class="r' + (canFind ? '' : ' sel') + '" role="option" data-i="' + (canFind ? 1 : 0) + '">' +
          '&#129302; Ask MLS Copilot: "' + safeQ + '"' + (canFind ? '' : '<small>Enter</small>') + '</div>';
        panel.style.display = 'block';
        qsa('.r', panel).forEach(function (row) {
          row.addEventListener('click', function () { choose(parseInt(row.getAttribute('data-i'), 10)); });
        });
        return;
      }
      sel = 0;
      /* ASKING IS ALWAYS REACHABLE. Copilot used to be offered only when NO
         control matched, so a question sharing one word with any control
         ('pay schedule' matches 'schedule') showed rows and no way to ask -
         from a box whose own placeholder promises 'Ask or find anything'.
         Appended LAST so control matches keep their ranking. */
      results = results.concat([{ copilot: true, q: input.value.trim() }]);
      panel.innerHTML = results.map(function (r, i) {
        if (r.copilot) {
          return '<div class="r ask" role="option" data-i="' + i + '">' +
            '&#129302; Ask MLS Copilot: "' + String(r.q).replace(/[<>&]/g, '') + '"</div>';
        }
        var danger = DESTRUCTIVE.test(r.label);
        return '<div class="r' + (i === 0 ? ' sel' : '') + (danger ? ' danger' : '') + '" role="option" data-i="' + i + '">' +
          r.label.replace(/[<>&]/g, '') + (r.count > 1 ? '<small>several — show me</small>' : '') + '</div>';
      }).join('');
      panel.style.display = 'block';
      qsa('.r', panel).forEach(function (row) {
        row.addEventListener('click', function () { choose(parseInt(row.getAttribute('data-i'), 10)); });
      });
    }

    /* Hand the typed words to the finder the app owns, through the app's own
       opener and nothing else. mlsQuickFind takes an OPTIONAL prefill (see
       feat_mls_fixpack_0701 qfOpen), so the doctor is never asked to type the
       same name twice; an older opener that ignores the argument simply opens
       empty. This shell must not reach into that overlay's field, and must not
       synthesize an input event to make it notice - trust is the browser's to
       set, and the coverage guard on this file is right to forbid it. */
    function handToFinder(q) {
      safe(function () { W.mlsQuickFind(q); });
    }

    function choose(i) {
      var r = results[i];
      if (!r) return;
      if (r.finder) {
        var wanted = r.q;
        close();
        input.value = '';
        input.blur();
        handToFinder(wanted);
        return;
      }
      if (r.copilot) {
        var question = r.q;
        close();
        input.value = '';
        input.blur();
        /* Copilot owns the answer. Open its dock, then send through the app's
           own chip path (fill + busy-guard + copilotAsk) - never reimplemented
           here. copilotChipText missing -> the dock still opens with the
           question prefilled, one keypress from sent, never lost. */
        safe(function () { if (typeof W.openCopilotDock === 'function') W.openCopilotDock(); });
        if (typeof W.copilotChipText === 'function') {
          safe(function () { W.copilotChipText(question); });
        } else {
          safe(function () { if (typeof W.openCopilotDock === 'function') W.openCopilotDock(question); });
        }
        return;
      }
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
    if (cooldownTimer) { clearTimeout(cooldownTimer); cooldownTimer = 0; }
    passJobs = [];
    passIndex = 0;
    pending = false;
    D.removeEventListener('mousemove', onMove, true);
    D.removeEventListener('keydown', onKey, true);
    D.removeEventListener('click', onDocumentClick, true);
    bindLifecycle(false);
    var css = qs('#mlsCalmShellCss');
    if (css && css.parentNode) css.parentNode.removeChild(css);
    dockEl = null;
    observer = null;
    watchRoots = [];
    dirty = newBits();
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
      clearHeadsDown();
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
  var cooldownTimer = 0;
  var lastPassAt = 0;
  var passJobs = [];
  var passIndex = 0;

  /* Reconcile only the owners a mutation can affect. The previous all-owner
     pass ran seven independent DOM scans after every patient-list/profile
     mutation; at 1,500 patients that produced repeated 50-100ms frames even
     when six owners had no possible state change. Unknown callers retain the
     conservative full pass. */
  function newBits() {
    return { route: false, counts: false, visit: false, patient: false, bar: false, actions: false };
  }
  var dirty = newBits();
  var watchRoots = [];

  function markDirty(bit) { dirty[bit] = true; }
  function markAll() {
    dirty.route = true;
    dirty.counts = true;
    dirty.visit = true;
    dirty.patient = true;
    dirty.bar = true;
    dirty.actions = true;
  }
  function markFromTarget(node) {
    for (var i = 0; i < watchRoots.length; i++) {
      var item = watchRoots[i], root = item.node;
      if (root === node || (root.contains && root.contains(node))) {
        for (var j = 0; j < item.bits.length; j++) dirty[item.bits[j]] = true;
        return;
      }
    }
    markAll();
  }
  function markFrom(records) {
    if (!records || typeof records.length !== 'number' || !records.length || !records[0] || !records[0].target) {
      markAll();
      return;
    }
    for (var i = 0; i < records.length; i++) markFromTarget(records[i].target);
  }
  function hasDirty() {
    return dirty.route || dirty.counts || dirty.visit || dirty.patient || dirty.bar || dirty.actions;
  }
  function buildPasses() {
    var d = dirty;
    dirty = newBits();
    var jobs = [];
    if (d.route || d.counts) jobs.push(syncDock);
    if (d.route || d.actions) jobs.push(renderRightNow);
    if (d.route || d.visit) jobs.push(renderStages);
    if (d.route || d.patient) jobs.push(prepRows);
    if (d.route || d.patient) jobs.push(patientScreen);
    if (d.route || d.patient || d.bar) jobs.push(contextBar);
    if (d.route || d.visit) jobs.push(arm);
    return jobs;
  }
  function runNextPass() {
    cooldownTimer = 0;
    if (!W.__mlsCalmShell.active) { pending = false; passJobs = []; return; }
    if (passIndex < passJobs.length) {
      safe(passJobs[passIndex++]);
      cooldownTimer = setTimeout(runNextPass, 0);
      return;
    }
    passJobs = [];
    passIndex = 0;
    pending = false;
    lastPassAt = Date.now();
    if (hasDirty()) queuePass();
  }
  function beginPasses() {
    cooldownTimer = 0;
    if (!W.__mlsCalmShell.active) { pending = false; return; }
    passJobs = buildPasses();
    passIndex = 0;
    runNextPass();
  }
  function queuePass() {
    if (!W.__mlsCalmShell.active) return;
    if (pending) return;
    var wait = Math.max(0, 48 - (Date.now() - lastPassAt));
    pending = true;
    cooldownTimer = setTimeout(beginPasses, wait);
  }

  function schedule(records) {
    if (!W.__mlsCalmShell.active) return;
    markFrom(records);
    queuePass();
  }

  function onDocumentClick(e) {
    if (!W.__mlsCalmShell.active) return;
    var target = e && e.target;
    if (target && target.nodeType !== 1) target = target.parentElement;
    if (!target || !target.closest) { markAll(); queuePass(); return; }
    /* A real Pause/Stop is a state transition, not merely activity. Clear the
       calm shell on entry so a stale hint/timer cannot survive the transition
       or re-hide the newly stopped controls. Start and unrelated clicks retain
       the ordinary wake/re-arm behavior. */
    var stopControl = target.closest('#ez3Stop,#captureBtn,.ez3fl-recbtn');
    var stopLabel = stopControl ? String(stopControl.textContent || '') : '';
    var isStopClick = !!(stopControl && (
      stopControl.id === 'ez3Stop' || /\b(?:pause|stop)\b/i.test(stopLabel) ||
      (stopControl.id === 'captureBtn' && stopControl.classList.contains('recording'))));
    if (isStopClick) clearHeadsDown();
    else wake();
    var shell = target.closest('#mlsDock,#mlsRightNow,#mlsAskResults,#mlsToolsMenu');
    if (shell) {
      if (shell.id === 'mlsDock') {
        var dockDest = target.closest('button[data-dest]');
        if (dockDest && dockDest.getAttribute('data-dest') !== 'tools') markDirty('route');
      }
      queuePass();
      return;
    }
    if (target.closest('.navtab')) markDirty('route');
    else if (target.closest('#visitView')) markDirty('visit');
    else if (target.closest('#patientBar,#mlsCtxBar')) markDirty('bar');
    else if (target.closest('#patientsView')) markDirty('patient');
    else markDirty('actions');
    queuePass();
  }

  function observeRoot(node, options, bits) {
    if (!node || !observer) return;
    safe(function () { observer.observe(node, options); });
    watchRoots.push({ node: node, bits: bits });
  }

  function watch() {
    if (observer) return;
    watchRoots = [];
    observer = new MutationObserver(schedule);
    var rail = qs('.mainnav');
    var visit = qs('#visitView');
    /* Most-specific roots lead so a count or patient-bar mutation does not get
       widened to the surrounding rail/patient view. */
    DEST.forEach(function (d) {
      if (d.count) observeRoot(D.getElementById(d.count), { childList: true, characterData: true, subtree: true }, ['counts']);
    });
    observeRoot(qs('#patientBar,#mlsCtxBar'), { childList: true, subtree: true }, ['bar']);
    /* class -> which view is active; style -> navFeatOn un-gating a tab mid
       session, which has to make its dock destination appear. The shell never
       writes to the rail, so watching it cannot feed back into itself. Tabs are
       observed individually as well, because some no longer live in the rail. */
    ALL_NAV_IDS.forEach(function (id) {
      observeRoot(D.getElementById(id), { attributes: true, attributeFilter: ['class', 'style'] }, ['route']);
    });
    observeRoot(rail, { attributes: true, attributeFilter: ['class', 'style'], subtree: true }, ['route']);
    observeRoot(visit, { childList: true, subtree: true }, ['visit']);
    /* The prep summary only exists once a patient is selected, so watch the
       patients view too. prepRows() no-ops when its signature is unchanged, so
       its own insertion cannot drive a render loop. */
    observeRoot(qs('#patientsView'), { childList: true, subtree: true }, ['patient']);
  }

  function onViewChanged() { markDirty('route'); queuePass(); }
  function onActivePatientChanged() { markDirty('patient'); markDirty('bar'); queuePass(); }
  function onSessionBoundary() { markAll(); queuePass(); }
  function bindLifecycle(on) {
    var fn = on ? 'addEventListener' : 'removeEventListener';
    safe(function () { W[fn]('mls:view-changed', onViewChanged); });
    safe(function () { W[fn]('mls:active-patient-changed', onActivePatientChanged); });
    safe(function () { W[fn]('mls:session-boundary', onSessionBoundary); });
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
    enabled();
    if (!qs('#appScreen') || !visible(qs('#appScreen'))) return false;
    /* If any part of the shell fails to come up we return the doctor to the
       classic layout rather than leaving them with a hidden rail and no dock.
       An unattended deploy has to fail back to something usable. */
    try {
      injectCss();
      buildDock();
      /* b841: restore the doctor's chosen side BEFORE the first syncDock, so
         the sliding indicator is measured on the axis it will actually live on
         instead of flipping once on the next pass. */
      safe(function () { applyDockSide(dockSide()); });
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
      bindLifecycle(true);
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
      /* and re-measure the top dock once the sticky surfaces above it have
         actually laid out — the same two-beat cover the rest of boot uses. */
      setTimeout(function () { safe(function () { if (dockSide() === 'top') applyDockSide('top'); }); }, 500);
      setTimeout(function () { safe(function () { if (dockSide() === 'top') applyDockSide('top'); }); }, 1600);
      D.addEventListener('click', onDocumentClick, true);
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
  /* RENDERED, not operable. visible() answers "may the shell offer this as an
     action", so it rejects `disabled`  correct there, wrong here. A disabled
     control is still painted, still in the accessibility tree, and still read
     out. Gating naming on operability left the Pay Reports card announcing
     "Pay Reports PREMIUMThis month's visits, coded and totaled Open full report"
     on every screen: measured on the running page at b582, 486px wide, disabled,
     unnamed, while its enabled twin on another screen was named correctly  which
     is what made it look like a race rather than a rule. Whether a control can be
     pressed has nothing to do with what it is called. */
  function onScreen(el) {
    if (!el || el.hidden) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  /* Advanced whenever the destination changes. The signature caches a verdict
     that depends on COMPUTED STYLE, not only on text: a control examined in a
     moment when its stylesheet had not applied derives a label identical to its
     flat text, and a text-only key would cache that "nothing to fix" for the
     life of the page. Keying on the epoch too means each control is re-derived
     at most once per view change  cheap, bounded, and unable to pin a wrong
     verdict forever. */
  var acnEpoch = 0;

  function nameControls() {
    if (!W.__mlsCalmShell.active) return;
    var activeView = activeAppView();
    qsa('button,[role="button"]').forEach(function (el) {
      if (!el.children || !el.children.length) return;
      /* Hidden top-level views can contain hundreds of composite controls.
         Reject them from showView's inline state before onScreen() performs
         any offset/getClientRects layout read. Global overlays and chrome have
         no owning view and continue through the normal path. */
      var owningView = el.closest && el.closest('#appWrap > div[id$="View"]');
      if (owningView && owningView !== activeView) return;
      var stamped = el.getAttribute('data-mls-acn');
      if (el.getAttribute('aria-label') && !stamped) return;
      var flat = normLabel(el.textContent);
      var sig = acnEpoch + '|' + flat;
      if (el.__mlsAcnSig === sig) return;
      if (el.closest && el.closest('#mlsDock,#mlsRightNow,#mlsToolsMenu,#mlsAskResults')) return;
      if (!onScreen(el)) return;
      el.__mlsAcnSig = sig;
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
    /* Section names are this shell's too, so Classic must not inherit them. */
    qsa('[data-mls-secname]').forEach(function (el) {
      el.removeAttribute('aria-label');
      el.removeAttribute('data-mls-secname');
    });
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
  var acnDest = null;

  function renderNow() {
    /* One epoch bump per destination change, read here because renderNow is the
       one pass guaranteed to run on every screen. markViewEnter() is not  it
       returns early when no *View element is on screen, which is exactly the
       mid-switch moment a stale naming verdict would be cached in. */
    var destNow = safe(currentDest) || '';
    if (destNow !== acnDest) { acnDest = destNow; acnEpoch++; }
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
    safe(nameGenericInView);
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
    label: controlLabel,
    /* The dock's active destination, by name, for the top-left title. Computed
       live from the DOM on every call rather than read off the dock's rendered
       .on class, because the title updates on showView (setTimeout 0) and
       syncDock runs a rAF later - a title reading a not-yet-painted dock would
       be one screen behind on every navigation. See activeDestLabel(). */
    destLabel: activeDestLabel
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
