/* =============================================================================
 * __mlsStaffHub  sh-1.0.0   (2026-07-13, owner work order: ONE cohesive
 * staff-account system instead of scattered fragments)
 * -----------------------------------------------------------------------------
 * WHAT EXISTS (audit 2026-07-13): the backend + app ALREADY have a real,
 * server-enforced front-desk role - POST /api/team/receptionists provisions a
 * walled login (bkUser.role==='receptionist'; requireClinician 403s clinical
 * APIs), with a check-in board, scheduling, messages + comms tabs. It was
 * simply BURIED. Multi-person capture also exists (rs segments: patient-
 * stamped, cross-patient combine refused) - rs-1.1.0 adds recordedBy
 * attribution + the staff-review handoff chip.
 *
 * THIS MODULE surfaces it all as one deliberate system: a "Practice staff"
 * card at the top of the Team view (doctor accounts only) that
 *   1. explains the two REAL roles in plain words:
 *      - Front desk: own walled login (day prep, check-in, scheduling;
 *        clinical notes blocked by the server),
 *      - Clinical support (nurse / MA): a clinician login whose capture lands
 *        as labeled, attributed segments the doctor reviews before signing;
 *   2. ADOPTS the app's real #receptionBox (DOM move - all inline handlers are
 *      global functions, so create/remove/copy-credentials keep working);
 *   3. never renders for receptionist sessions (isReceptionistUser guard on
 *      top of the server's own 403).
 * No new stores, no parallel account model. Reversible: window.__mlsStaffHub
 * .revert(). ASCII-only except UI emoji.
 * ==========================================================================*/
(function () {
  'use strict';
  if (window.__mlsStaffHub) return;
  var api = { version: 'sh-1.0.0', installed: true };
  window.__mlsStaffHub = api;
  var CARD_ID = 'mlsShCard', CSS_ID = 'mlsShCss';

  function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }
  function isRecept() { return safe(function () { return typeof isReceptionistUser === 'function' && isReceptionistUser(); }, false); }

  function css() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent = [
      '#' + CARD_ID + '{background:#fff;border:1px solid #E7E5DD;border-radius:16px;padding:18px 20px;margin:0 0 14px;box-shadow:0 1px 2px rgba(20,33,28,.04);}',
      '#' + CARD_ID + ' h3{font-family:"Newsreader",Georgia,serif;font-weight:600;font-size:18px;letter-spacing:-.01em;color:#1A211C;margin:0 0 4px;}',
      '#' + CARD_ID + ' .sh-sub{font-size:12.5px;color:#79837C;margin:0 0 12px;}',
      '#' + CARD_ID + ' .sh-roles{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin:0 0 12px;}',
      '#' + CARD_ID + ' .sh-role{border:1px solid #EFEDE6;border-radius:12px;padding:12px 14px;background:#FCFBF8;}',
      '#' + CARD_ID + ' .sh-role b{display:block;font-size:13.5px;color:#1A211C;margin-bottom:4px;}',
      '#' + CARD_ID + ' .sh-role p{font-size:12px;color:#55605A;margin:0;line-height:1.55;}',
      '#' + CARD_ID + ' .sh-role .sh-tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;border-radius:5px;padding:2px 7px;margin-left:6px;vertical-align:1px;}',
      '#' + CARD_ID + ' .sh-tag.live{color:#2E6A4B;background:#EAF1EE;}',
      '#' + CARD_ID + ' .sh-tag.via{color:#8A5A22;background:#FCF8EF;}',
      '#' + CARD_ID + ' .sh-manage{display:inline-flex;align-items:center;gap:8px;background:#204034;border:1px solid #204034;color:#fff;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;padding:9px 15px;}',
      '#' + CARD_ID + ' .sh-manage:hover{background:#2E6A4B;}',
      /* the adopted receptionBox sheds its old orange skin */
      '#' + CARD_ID + ' #receptionBox{background:#FCFBF8 !important;border:1px solid #EFEDE6 !important;border-radius:12px !important;margin-top:12px !important;}',
      /* ONE pull surface (owner order): the assistant-panel Pull-last-month
         button duplicated the staff workspace pull card - retired. The chat
         intent still routes to the same single modal. */
      '#mlsMPasstBtn{display:none !important;}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  function ensure() {
    if (isRecept()) return;
    var tv = document.getElementById('teamView');
    if (!tv || document.getElementById(CARD_ID)) return;
    css();
    var card = document.createElement('div');
    card.id = CARD_ID;
    card.innerHTML =
      '<h3>Practice staff</h3>' +
      '<div class="sh-sub">Everyone gets their own login. Roles keep each person to exactly what their job needs &mdash; the server enforces it, not just the screen.</div>' +
      '<div class="sh-roles">' +
      '<div class="sh-role"><b>&#128221; Front desk <span class="sh-tag live">own login</span></b>' +
      '<p>Runs the check-in board and scheduling, preps the day&rsquo;s list, fixes demographics. Clinical notes are blocked server-side &mdash; they can&rsquo;t see or touch them.</p></div>' +
      '<div class="sh-role"><b>&#129658; Clinical support (nurse / MA) <span class="sh-tag via">clinician login</span></b>' +
      '<p>Signs in with their own clinician login and records the <b>Staff history</b> part of a visit (intake, vitals, meds). It lands as a labeled recording with their name on it &mdash; you review every part before combining and signing.</p></div>' +
      '<div class="sh-role"><b>&#129337; Doctor / admin <span class="sh-tag live">you</span></b>' +
      '<p>Creates and removes staff logins below, sees who recorded what on every visit, and is the only one who signs notes or sends anything to Athena.</p></div>' +
      '</div>' +
      '<button type="button" class="sh-manage" id="mlsShManage">&#128101; Manage front-desk logins</button>';
    tv.insertBefore(card, tv.firstChild);

    var btn = card.querySelector('#mlsShManage');
    btn.addEventListener('click', function () {
      safe(function () {
        var box = document.getElementById('receptionBox');
        if (box && box.parentElement !== card) card.appendChild(box);   /* adopt the REAL box; global handlers keep working */
        if (typeof loadReceptionists === 'function') loadReceptionists(true);
      });
    });
  }

  var n = 0;
  var iv = setInterval(function () { safe(ensure); if (++n > 40) clearInterval(iv); }, 900);
  safe(ensure);

  api.revert = function () {
    try { clearInterval(iv); } catch (e) {}
    try { var c = document.getElementById(CARD_ID); if (c) c.remove(); } catch (e) {}
    try { var s = document.getElementById(CSS_ID); if (s) s.remove(); } catch (e) {}
    api.installed = false; delete window.__mlsStaffHub;
  };
})();
