/* Non-blocking dialog helpers: fall back to native only when the in-app modals are absent. */
try{
  if(typeof window.mlsConfirm!=='function'){ window.mlsConfirm=function(m){ return Promise.resolve(window.confirm(m)); }; }
  if(typeof window.mlsPrompt!=='function'){ window.mlsPrompt=function(m,d){ return Promise.resolve(window.prompt(m,d==null?'':d)); }; }
}catch(e){}
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
  var api = { version: 'sh-1.1.0', installed: true };
  window.__mlsStaffHub = api;
  var CARD_ID = 'mlsShCard', CSS_ID = 'mlsShCss';

  function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }
  function isRecept() { return safe(function () { return typeof isReceptionistUser === 'function' && isReceptionistUser(); }, false); }
  function isNurse() { return safe(function () { return !!(bkUser && (bkUser.isNurse || bkUser.role === 'nurse')); }, false); }

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
      '#' + CARD_ID + ' .sh-nurses{background:#F2F8F5;border:1px solid #C8DED2;border-radius:12px;padding:13px 14px;margin-top:10px;}',
      '#' + CARD_ID + ' .sh-row{display:flex;align-items:center;gap:8px;border:1px solid #D8E6DE;border-radius:9px;padding:8px 10px;margin:6px 0;background:#fff;}',
      '#mlsNurseNotice{background:#EEF6F2;border:1px solid #BFD8CB;border-radius:12px;padding:12px 14px;margin:0 0 14px;color:#204034;font-size:13px;line-height:1.5;}',
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
      '<div class="sh-role"><b>&#129658; Clinical support (nurse / MA) <span class="sh-tag live">own restricted login</span></b>' +
      '<p>Can review practice patient history, handle intake and care-team requests, and prepare attributed drafts. Legal, payments, signing, and Athena write actions are blocked by the server.</p></div>' +
      '<div class="sh-role"><b>&#129337; Doctor / admin <span class="sh-tag live">you</span></b>' +
      '<p>Creates and removes staff logins below, sees who recorded what on every visit, and is the only one who signs notes or sends anything to Athena.</p></div>' +
      '</div>' +
      '<button type="button" class="sh-manage" id="mlsShManage">&#128101; Manage front-desk logins</button> ' +
      '<button type="button" class="sh-manage" id="mlsShNurses">&#129658; Manage nursing logins</button>' +
      '<div class="sh-nurses" id="mlsShNurseBox" style="display:none"></div>';
    tv.insertBefore(card, tv.firstChild);

    var btn = card.querySelector('#mlsShManage');
    btn.addEventListener('click', function () {
      safe(function () {
        var box = document.getElementById('receptionBox');
        if (box && box.parentElement !== card) card.appendChild(box);   /* adopt the REAL box; global handlers keep working */
        if (typeof loadReceptionists === 'function') loadReceptionists(true);
      });
    });
    card.querySelector('#mlsShNurses').addEventListener('click', loadNurses);
  }

  var lastNurseCreds = null;
  function authHeaders(json) {
    var h = { Authorization: 'Bearer ' + (typeof bkToken === 'function' ? bkToken() : '') };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }
  function nurseBox() { return document.getElementById('mlsShNurseBox'); }
  function loadNurses() {
    var box = nurseBox(); if (!box) return;
    if (box.style.display === 'block') { box.style.display = 'none'; return; }
    box.style.display = 'block'; box.textContent = 'Loading nursing logins…';
    fetch(bkBase() + '/api/team/nurses', { headers: authHeaders(false) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Could not load nursing logins.'); return d; }); })
      .then(function (d) { renderNurses(d.nurses || []); })
      .catch(function (e) { box.textContent = e.message || 'Could not load nursing logins.'; });
  }
  function renderNurses(list) {
    var box = nurseBox(); if (!box) return;
    var h = '<b>Clinical-support logins</b><div style="font-size:12px;color:#66746C;margin:3px 0 9px">Each nurse or MA signs in at this same app. Their work is restricted and saved as a draft for doctor review.</div>';
    if (lastNurseCreds) h += '<div style="background:#fff;border:1px solid #BFD8CB;border-radius:9px;padding:9px;margin-bottom:9px"><b>Login created</b><div>Email: ' + esc(lastNurseCreds.email) + '</div><div>Temporary password: <b>' + esc(lastNurseCreds.tempPassword) + '</b> <button type="button" id="mlsShCopyNurse">Copy</button></div></div>';
    list.forEach(function (u) { h += '<div class="sh-row"><span><b>' + esc(u.name || '(no name)') + '</b> <small>' + esc(u.email) + '</small></span><button type="button" class="mlsShRemoveNurse" data-id="' + Number(u.id) + '" style="margin-left:auto">Remove</button></div>'; });
    if (!list.length) h += '<div style="font-size:12px;color:#66746C;margin-bottom:8px">No nursing logins yet.</div>';
    h += '<div style="display:flex;gap:7px;flex-wrap:wrap;margin-top:9px"><input id="mlsShNurseName" placeholder="Name" style="flex:1;min-width:120px;padding:8px"><input id="mlsShNurseEmail" type="email" placeholder="Email" style="flex:2;min-width:170px;padding:8px"><button type="button" id="mlsShAddNurse">Create nursing login</button></div>';
    box.innerHTML = h;
    var add = document.getElementById('mlsShAddNurse'); if (add) add.addEventListener('click', addNurse);
    var copy = document.getElementById('mlsShCopyNurse'); if (copy) copy.addEventListener('click', function () { navigator.clipboard.writeText('Email: ' + lastNurseCreds.email + '\nTemporary password: ' + lastNurseCreds.tempPassword); });
    Array.prototype.forEach.call(box.querySelectorAll('.mlsShRemoveNurse'), function (b) { b.addEventListener('click', function () { removeNurse(b.getAttribute('data-id')); }); });
  }
  function addNurse() {
    var name = (document.getElementById('mlsShNurseName').value || '').trim();
    var email = (document.getElementById('mlsShNurseEmail').value || '').trim();
    if (!email) { toast('Enter an email for the nursing login.', 'err'); return; }
    fetch(bkBase() + '/api/team/nurses', { method: 'POST', headers: authHeaders(true), body: JSON.stringify({ name: name, email: email }) })
      .then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'Could not create nursing login.'); return d; }); })
      .then(function (d) { lastNurseCreds = { name: name, email: email, tempPassword: d.tempPassword }; nurseBox().style.display = 'none'; loadNurses(); toast('Nursing login created.', 'ok'); })
      .catch(function (e) { toast(e.message || 'Could not create nursing login.', 'err'); });
  }
  async function removeNurse(id) {
    if (!await mlsConfirm('Remove this nursing login? Their access will stop immediately.')) return;
    fetch(bkBase() + '/api/team/nurses/' + encodeURIComponent(id), { method: 'DELETE', headers: authHeaders(false) })
      .then(function (r) { if (!r.ok) throw new Error('Could not remove nursing login.'); lastNurseCreds = null; nurseBox().style.display = 'none'; loadNurses(); })
      .catch(function (e) { toast(e.message, 'err'); });
  }

  function enforceNurseView() {
    if (!isNurse()) return;
    ['nav_legalreq','nav_analysis','nav_studio','nav_team','signBtn','pushAllEmrBtn','sendEmrBtn','ptPullAthenaBtn','ptPurgeAthenaBtn','legalReturnBtn'].forEach(function (id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
    var vv = document.getElementById('visitView');
    if (vv && !document.getElementById('mlsNurseNotice')) {
      var note = document.createElement('div'); note.id = 'mlsNurseNotice';
      note.innerHTML = '<b>Nursing workspace</b><br>Review the attached patient history, record intake/vitals/medications, and save your work as a draft. A doctor must review and sign; legal, payments, and Athena write actions are unavailable on this login.';
      vv.insertBefore(note, vv.firstChild);
    }
  }

  var n = 0;
  var iv = setInterval(function () { safe(ensure); safe(enforceNurseView); if (++n > 80) clearInterval(iv); }, 900);
  safe(ensure);

  api.revert = function () {
    try { clearInterval(iv); } catch (e) {}
    try { var c = document.getElementById(CARD_ID); if (c) c.remove(); } catch (e) {}
    try { var s = document.getElementById(CSS_ID); if (s) s.remove(); } catch (e) {}
    api.installed = false; delete window.__mlsStaffHub;
  };
})();
