// MLS Assist — background worker. Only place that holds the API key + talks to MLS. (v1.7 robust executor)
const DEFAULT_BACKEND = 'https://scrivara-backend.onrender.com';
// Maps each global element #index → { frameId, localIndex } so the autopilot can
// read AND act inside iframes (e.g. athenaNet, which is heavily iframed). Rebuilt
// on every mlsAssistElements call, consumed by mlsAssistExec for #index targets.
const _mlsFrameMap = {};
function getCfg() { return new Promise(r => chrome.storage.local.get(['mlsBackend', 'mlsKey'], r)); }

// NO-API-KEY MODE: read the doctor's LIVE MLS login token straight out of an open,
// signed-in mlsscribe.com tab (same Bearer JWT the web app uses). This means the
// extension "just works" once they're logged into MLS — nothing to generate/paste.
// Cached briefly so we don't re-scan every single agent step.
let _sessTok = '', _sessAt = 0;
async function getSessionToken() {
  if (_sessTok && (Date.now() - _sessAt) < 60000) return _sessTok;
  try {
    const tabs = await chrome.tabs.query({ url: ['https://mlsscribe.com/*', 'https://*.mlsscribe.com/*'] });
    // Prefer the most-recently-used MLS tab.
    tabs.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
    for (const tab of tabs) {
      try {
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: () => { try { return sessionStorage.getItem('sf_bk_token') || localStorage.getItem('sf_bk_token') || ''; } catch (e) { return ''; } }
        });
        const tok = (r && r.result || '').trim();
        if (tok) { _sessTok = tok; _sessAt = Date.now(); return tok; }
      } catch (e) { /* tab not scriptable (still loading / restricted) — try next */ }
    }
  } catch (e) {}
  return '';
}

async function callBackend(path, body) {
  const c = await getCfg();
  const base = (c.mlsBackend || DEFAULT_BACKEND).replace(/\/+$/, '');
  let key = (c.mlsKey || '').trim();
  let viaSession = false;
  if (!key) { key = await getSessionToken(); viaSession = true; }
  if (!key) return { error: 'Not connected. Open MLS (mlsscribe.com) in a tab and sign in — MLS Assist will use your login automatically. (Or add an API key via the toolbar icon.)' };
  try {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    let d = {}; try { d = await r.json(); } catch (e) {}
    if (!r.ok) {
      // A stale session token? Drop the cache and tell them to re-sign-in.
      if (viaSession && r.status === 401) { _sessTok = ''; _sessAt = 0; return { error: 'Your MLS login expired — open mlsscribe.com and sign in again, then retry.' }; }
      return { error: d.error || ('Request failed (HTTP ' + r.status + ')') };
    }
    return d;
  } catch (e) { return { error: 'Network error: ' + e.message }; }
}
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  // Tell the popup how we're authenticating: a saved API key, the live MLS login, or nothing yet.
  if (msg.type === 'mlsConnStatus') {
    (async () => {
      const c = await getCfg();
      if ((c.mlsKey || '').trim()) return sendResponse({ mode: 'key' });
      const tok = await getSessionToken();
      sendResponse({ mode: tok ? 'session' : 'none' });
    })();
    return true;
  }
  if (msg.type === 'mlsAssistGenerate') { callBackend('/api/assist/note', { transcript: msg.transcript }).then(sendResponse); return true; }
  if (msg.type === 'mlsAssistAgentStep') { callBackend('/api/assist/agent-step', { goal: msg.goal, pageText: msg.pageText, screenshot: msg.screenshot, history: msg.history }).then(sendResponse); return true; }
  if (msg.type === 'mlsAssistExtract') { callBackend('/api/assist/extract', { pageText: msg.pageText, url: msg.url }).then(sendResponse); return true; }
  // Pull the day's SCHEDULE from the EMR tab (Athena) → return its page text so MLS can
  // parse the appointments and pre-load today's patients. Reads every frame (Athena is iframe-based).
  if (msg.type === 'mlsAppScheduleRequest') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        // Find the EMR tab by KNOWN domains, else by EMR-looking host keywords, else the
        // most-recently-active non-MLS http(s) tab. Kept broad so an Athena domain/URL change
        // doesn't break us — the real work is content-based below.
        let tab = all.find((t) => /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i.test(t.url || ''))
               || all.find((t) => /athena|epic|cerner|ecw|eclinical|nextgen|allscripts|emr|ehr|\bchart\b|practice|clinic/i.test(t.url || '') && !/mlsscribe\.com/i.test(t.url || ''));
        if (!tab) {
          const cand = all.filter((t) => /^https?:/i.test(t.url || '') && !/mlsscribe\.com|chrome:\/\//i.test(t.url || ''));
          cand.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
          tab = cand[0];
        }
        if (!tab) return sendResponse({ ok: false, error: 'Open your EMR schedule (e.g. the Athena day view) in another tab, then try again.' });
        // Read every frame WITH its URL so we can isolate the SCHEDULE/CALENDAR frame and
        // drop the noise (athenaText messaging, department lists) that would pollute parsing.
        let results = [];
        try {
          results = await chrome.scripting.executeScript({
            target: { tabId: tab.id, allFrames: true },
            func: () => { try { return { u: location.href, t: (document.body && document.body.innerText || '').slice(0, 22000) }; } catch (e) { return { u: '', t: '' }; } }
          });
        } catch (e) {
          results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ u: location.href, t: (document.body && document.body.innerText || '').slice(0, 22000) }) });
        }
        const frames = results.map((r) => r && r.result).filter((r) => r && r.t && r.t.trim());
        // CONTENT-SCORE each frame for "looks like a schedule" — appointment times, day/date
        // labels, scheduling words. This is what makes us resilient to Athena changing their
        // frame names / URLs: we find the schedule by what's IN it, not where it lives.
        const scoreSched = (f) => {
          const u = (f.u || '').toLowerCase(), t = (f.t || ''), tl = t.toLowerCase();
          let s = 0;
          if (/schedul|calendar|appointment|booking|frontoffice|dashboard/.test(u)) s += 25;     // URL hint = bonus, not required
          s += Math.min((t.match(/\b\d{1,2}:\d{2}\s*(a\.?m\.?|p\.?m\.?)?/gi) || []).length, 60) * 2; // clock times = strongest signal
          ['appointment', 'schedul', 'provider', 'booking', 'arrived', 'checked in', 'check-in', 'exam room', 'no show', 'walk-in'].forEach((k) => { if (tl.indexOf(k) >= 0) s += 6; });
          ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].forEach((d) => { if (tl.indexOf(d) >= 0) s += 2; });
          s -= /conversation|colleague|inbox|message/.test(tl) ? 20 : 0;                            // de-rank the messaging frame
          s += Math.min(t.length, 14000) / 500;                                                     // size as a minor tiebreaker
          return s;
        };
        let pick = null, best = -1;
        frames.forEach((f) => { const s = scoreSched(f); if (s > best) { best = s; pick = f; } });
        pick = pick || { u: tab.url, t: '' };
        // Include the page title so the parser can anchor the date range of a multi-day view.
        sendResponse({ ok: true, text: ((tab.title ? ('[' + tab.title + ']\n') : '') + (pick.t || '')).slice(0, 22000), url: pick.u || tab.url, title: tab.title, frames: frames.length });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  // Open + read ONE PATIENT'S CHART from Athena. If a patient name is given, try to
  // click that patient (in the schedule/search) to open their chart, then read the
  // frame that scores highest on clinical-chart keywords (so we never grab the schedule).
  if (msg.type === 'mlsAppChartRequest') {
    (async () => {
      try {
        const all = await chrome.tabs.query({});
        let tab = all.find((t) => /athenahealth|athenanet|athena\.io|\.px\.athena/i.test(t.url || ''));
        if (!tab) { const cand = all.filter((t) => /^https?:/i.test(t.url || '') && !/mlsscribe\.com|chrome:\/\//i.test(t.url || '')); cand.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); tab = cand[0]; }
        if (!tab) return sendResponse({ ok: false, error: 'Open the patient in your Athena tab, then try again.' });
        const want = String(msg.patient || '').trim();
        let opened = false;
        // Click a visible patient name, OR type the name into an Athena search box, so we
        // can OPEN the chart without the doctor having to click it themselves.
        const openFn = (name) => {
          try {
            const parts = name.toLowerCase().replace(/[^a-z\s,]/g, '').split(/[\s,]+/).filter(Boolean);
            if (!parts.length) return 'no';
            const last = parts[parts.length - 1], first = parts[0];
            const clickName = () => {
              const els = Array.from(document.querySelectorAll('a,button,[role="link"],[role="button"],[onclick],td,li,span,div'));
              for (const el of els) {
                const t = (el.innerText || el.textContent || '').trim().toLowerCase();
                if (t && t.length < 70 && t.indexOf(last) >= 0 && (parts.length < 2 || t.indexOf(first) >= 0)) {
                  const r = el.getBoundingClientRect(); if (r.width > 0 && r.height > 0) { el.click(); return true; }
                }
              }
              return false;
            };
            if (clickName()) return 'clicked';
            const inputs = Array.from(document.querySelectorAll('input[type="text"],input[type="search"],input:not([type])'));
            const box = inputs.find((i) => {
              const h = ((i.placeholder || '') + ' ' + (i.name || '') + ' ' + (i.getAttribute('aria-label') || '') + ' ' + (i.id || '')).toLowerCase();
              const r = i.getBoundingClientRect(); const t = (i.type || '').toLowerCase();
              if (r.width <= 0 || r.height <= 0) return false;
              // NEVER type a patient NAME into a numeric / ID field — that's what throws Athena's
              // "Patient ID must be numeric" error. Skip number/tel/date fields and any ID-ish label.
              if (t === 'number' || t === 'tel' || t === 'date' || t === 'email' || t === 'password') return false;
              if ((i.inputMode || '').toLowerCase() === 'numeric') return false;
              if (/patient\s*id|patientid|\bid\b|\bmrn\b|chart\s*(id|no|num)|\bnpi\b|account|claim|invoice|\bnumber\b|ssn|\bdob\b/.test(h)) return false;
              return /search|name|find|look\s*up|lookup|filter|patient/.test(h);
            });
            if (box) {
              box.focus(); box.value = name;
              box.dispatchEvent(new Event('input', { bubbles: true })); box.dispatchEvent(new Event('change', { bubbles: true }));
              ['keydown', 'keypress', 'keyup'].forEach((tp) => box.dispatchEvent(new KeyboardEvent(tp, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
              return 'searched';
            }
            return 'no';
          } catch (e) { return 'no'; }
        };
        if (want) {
          let statuses = [];
          try { const res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: openFn, args: [want] }); statuses = res.map((r) => r && r.result); } catch (e) {}
          if (statuses.indexOf('clicked') >= 0) { opened = true; await new Promise((r) => setTimeout(r, 1900)); }
          else if (statuses.indexOf('searched') >= 0) {
            // gave Athena the name — wait for results, then click the matching result.
            await new Promise((r) => setTimeout(r, 2600));
            try { const res2 = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: openFn, args: [want] }); if (res2.map((r) => r && r.result).indexOf('clicked') >= 0) { opened = true; await new Promise((r) => setTimeout(r, 1900)); } } catch (e) {}
          }
        }
        let results = [];
        try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => { try { return { u: location.href, t: (document.body && document.body.innerText || '').slice(0, 14000) }; } catch (e) { return { u: '', t: '' }; } } }); }
        catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ u: location.href, t: (document.body && document.body.innerText || '').slice(0, 14000) }) }); }
        const frames = results.map((r) => r && r.result).filter((r) => r && r.t && r.t.trim());
        const score = (txt) => { const s = (txt || '').toLowerCase(); let n = 0; ['problem', 'medication', 'allerg', 'history', 'vital', 'diagnos', 'assessment', 'date of birth', 'dob', 'surg', 'imaging', 'mri', 'immuniz'].forEach((k) => { if (s.indexOf(k) >= 0) n++; }); return n; };
        let pick = null, best = -1;
        frames.forEach((f) => { const sc = score(f.t) * 1000 + Math.min(f.t.length, 13000) / 100; if (sc > best) { best = sc; pick = f; } });
        pick = pick || { u: tab.url, t: '' };
        sendResponse({ ok: true, text: (pick.t || '').slice(0, 16000), url: pick.u || tab.url, title: tab.title, opened: opened, frames: frames.length });
      } catch (e) { sendResponse({ ok: false, error: String((e && e.message) || e) }); }
    })();
    return true;
  }
  // Read the innerText of whatever tab is ACTIVE right now (so the agent sees the
  // tab it is currently on, even after a tab switch).
  if (msg.type === 'mlsAssistPageText') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return sendResponse({ text: '' });
        // Read EVERY frame (top + iframes) so the agent can see iframe-based EMRs.
        let results = [];
        try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: () => (document.body && document.body.innerText || '').slice(0, 6000) }); }
        catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => (document.body && document.body.innerText || '').slice(0, 9000) }); }
        let text = '';
        for (const fr of results) { const t = fr && fr.result; if (t) { text += (text ? '\n---- (frame) ----\n' : '') + t; } if (text.length > 12000) break; }
        sendResponse({ text: text.slice(0, 12000), url: tab.url, title: tab.title });
      } catch (e) { sendResponse({ text: '' }); }
    })();
    return true;
  }
  // Numbered inventory of the interactive controls on the ACTIVE tab. The agent
  // targets these by #index, which is far more reliable than guessing labels.
  // MUST stay in lock-step with _inv() inside mlsAssistExec (same selector/order).
  if (msg.type === 'mlsAssistElements') {
    (async () => {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return sendResponse({ list: [] });
        const perFrame = () => {
          function vis(el) { try { if (el.disabled) return false; if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false; var st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') < 0.05) return false; var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; return true; } catch (e) { return true; } }
          function lab(e) { var s = (e.innerText || e.value || (e.getAttribute && (e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('name'))) || e.id || ''); return String(s).replace(/\s+/g, ' ').trim().slice(0, 60); }
          var sel = 'button,a[href],[role=button],[role=link],[role=menuitem],[role=tab],[role=option],input:not([type=hidden]),textarea,select,[contenteditable=""],[contenteditable="true"],[onclick]';
          var nodes = Array.prototype.slice.call(document.querySelectorAll(sel)).filter(vis).slice(0, 120);
          return nodes.map(function (e) { var tag = (e.tagName || '').toLowerCase(); var ty = e.getAttribute && e.getAttribute('type'); var role = e.getAttribute && e.getAttribute('role'); var ph = e.getAttribute && e.getAttribute('placeholder'); return tag + (ty ? ('[' + ty + ']') : '') + (role ? (' role=' + role) : '') + ' «' + (lab(e) || ph || '') + '»'; });
        };
        let results = [];
        try { results = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: perFrame }); }
        catch (e) { results = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: perFrame }); }
        const list = [], map = [];
        for (const fr of results) {
          const arr = (fr && fr.result) || [];
          for (let li = 0; li < arr.length; li++) {
            if (list.length >= 120) break;
            map.push({ frameId: fr.frameId || 0, localIndex: li });
            list.push(list.length + ': ' + arr[li]);
          }
          if (list.length >= 120) break;
        }
        _mlsFrameMap[tab.id] = map;
        sendResponse({ list });
      } catch (e) { sendResponse({ list: [] }); }
    })();
    return true;
  }
  // Execute a single agent action on the ACTIVE tab (or switch tabs). This lets the
  // autopilot act on whatever tab it is on, including after switching.
  if (msg.type === 'mlsAssistExec') {
    (async () => {
      try {
        const action = msg.action || {};
        if (action.type === 'switchtab') {
          const tabs = await chrome.tabs.query({});
          const t = String(action.target || '').toLowerCase().trim();
          const http = tabs.filter(x => /^https?:/.test(x.url || ''));
          let tab = t ? http.find(x => ((x.title || '').toLowerCase().includes(t) || (x.url || '').toLowerCase().includes(t))) : null;
          if (!tab) { const others = http.filter(x => !x.active).sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0)); tab = others[0]; }
          if (!tab) return sendResponse({ ok: false, msg: 'No other tab to switch to.' });
          await chrome.tabs.update(tab.id, { active: true });
          try { await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) {}
          return sendResponse({ ok: true, msg: 'Switched to: ' + (tab.title || tab.url || 'tab') });
        }
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return sendResponse({ ok: false, msg: 'No active tab.' });
        // Frame routing: a "#index" target may live inside an iframe (Athena, etc.).
        // Look it up in the map built by mlsAssistElements and run the action in THAT
        // frame, passing the element's local index so it resolves the exact control.
        let _execTarget = { tabId: tab.id };
        let _act = action;
        const _im = /^#(\d+)$/.exec(String(action.target || '').trim());
        if (_im && _mlsFrameMap[tab.id] && _mlsFrameMap[tab.id][+_im[1]]) {
          const _ent = _mlsFrameMap[tab.id][+_im[1]];
          if (_ent.frameId) _execTarget = { tabId: tab.id, frameIds: [_ent.frameId] };
          _act = Object.assign({}, action, { _localIdx: _ent.localIndex });
        }
        // Retry wrapper: web EMRs render asynchronously, so a target may not exist on
        // the first try. We re-run the injected executor a few times with a short
        // settle delay — but ONLY when the failure was "couldn't find it" (notfound).
        // Success returns immediately, so the happy path stays fast.
        const tries = (action && /^(click|confirm|type|select|pastenote)$/.test(action.type || '')) ? 5 : 1;
        let r = null;
        for (let i = 0; i < tries; i++) {
          [r] = await chrome.scripting.executeScript({
          target: _execTarget,
          args: [_act],
          func: (act) => {
            function visible(el) {
              if (!el) return false;
              try {
                if (el.disabled) return false;
                if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;
                const st = getComputedStyle(el);
                if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') < 0.05) return false;
                const rc = el.getBoundingClientRect();
                if (rc.width < 1 || rc.height < 1) return false;
                return true;
              } catch (e) { return true; }
            }
            function labelOf(e) {
              return ((e.innerText || e.value || (e.getAttribute && (e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('name') || e.id)) || '') + '').toLowerCase().replace(/\s+/g, ' ').trim();
            }
            // Rebuild the SAME ordered inventory the agent saw, so a "#index" target
            // maps to the exact element. Must match mlsAssistElements above.
            function _inv() {
              function vis(el) { try { if (el.disabled) return false; if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false; var st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden' || parseFloat(st.opacity || '1') < 0.05) return false; var r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; return true; } catch (e) { return true; } }
              var sel = 'button,a[href],[role=button],[role=link],[role=menuitem],[role=tab],[role=option],input:not([type=hidden]),textarea,select,[contenteditable=""],[contenteditable="true"],[onclick]';
              return Array.prototype.slice.call(document.querySelectorAll(sel)).filter(vis).slice(0, 120);
            }
            function _byIdx(t) { var m = /^#(\d+)$/.exec(String(t || '').trim()); if (!m) return null; var el = _inv()[+m[1]]; return (el && visible(el)) ? el : (el || null); }
            // When frame-routed, the background passes the element's LOCAL index in this frame.
            function _local() { try { return (typeof act._localIdx === 'number') ? (_inv()[act._localIdx] || null) : null; } catch (e) { return null; } }
            // Scored finder — prefers an exact label, a visible & enabled element, an
            // interactive role, and one inside the viewport. Far more accurate than the
            // old "first substring match", which often clicked the wrong control.
            function findEl(target) {
              if (!target) return null;
              try { const el = document.querySelector(target); if (el && visible(el)) return el; } catch (e) {}
              const t = String(target).toLowerCase().replace(/\s+/g, ' ').trim();
              if (!t) return null;
              const cand = [...document.querySelectorAll('button,a,[role=button],[role=link],[role=menuitem],[role=tab],[role=option],input,textarea,select,label,[onclick],[contenteditable=""],[contenteditable="true"]')];
              const tc = t.replace(/[^a-z0-9 ]/g, '').trim();
              let best = null, bestScore = 19;
              for (const e of cand) {
                const lab = labelOf(e);
                if (!lab) continue;
                let s = -1;
                if (lab === t) s = 100;
                else if (lab.replace(/[^a-z0-9 ]/g, '').trim() === tc) s = 90;
                else if (lab.startsWith(t) || lab.endsWith(t)) s = 70;
                else if (lab.includes(t)) s = 50 - Math.min(40, Math.abs(lab.length - t.length));
                if (s < 0) continue;
                if (visible(e)) s += 30; else s -= 25;
                const tag = (e.tagName || '').toLowerCase();
                if (tag === 'button' || (e.getAttribute && e.getAttribute('role') === 'button') || tag === 'a') s += 6;
                try { const rc = e.getBoundingClientRect(); if (rc.top >= 0 && rc.top < innerHeight) s += 4; } catch (er) {}
                if (s > bestScore) { bestScore = s; best = e; }
              }
              return best;
            }
            function fireClick(el) {
              try { el.scrollIntoView({ block: 'center', inline: 'center' }); } catch (e) {}
              const r = el.getBoundingClientRect();
              const x = r.left + r.width / 2, y = r.top + r.height / 2;
              const opt = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y };
              for (const t of ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
                try { el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, opt)); } catch (e) {}
              }
              try { el.click(); } catch (e) {}
            }
            function typeInto(el, text) {
              try { el.focus(); } catch (e) {}
              try { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })); } catch (e) {}
              if (el.isContentEditable) { try { el.textContent = ''; } catch (e) {} try { el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text })); } catch (e) {} if (!document.execCommand('insertText', false, text)) { el.textContent = text; } }
              else { const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const s = Object.getOwnPropertyDescriptor(p, 'value'); if (s && s.set) s.set.call(el, text); else el.value = text; }
              try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text })); } catch (e) { el.dispatchEvent(new Event('input', { bubbles: true })); }
              el.dispatchEvent(new Event('change', { bubbles: true })); try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); } catch (e) {}
            }
            function setSelectByText(sel, text) {
              const t = String(text || '').toLowerCase().trim();
              let opt = [...sel.options].find(o => (o.textContent || '').toLowerCase().trim() === t || (o.value || '').toLowerCase().trim() === t);
              if (!opt) opt = [...sel.options].find(o => ((o.textContent || '').toLowerCase().trim().includes(t)) || ((o.value || '').toLowerCase().trim() === t));
              if (!opt) return false;
              sel.value = opt.value; sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); return true;
            }
            const a = act || {};
            if (a.type === 'select') {
              const t = String(a.target || '').toLowerCase().trim();
              let sel = null;
              var _bi = _local() || _byIdx(a.target); if (_bi && _bi.tagName === 'SELECT') sel = _bi;
              try { if (!sel) { const q = document.querySelector(a.target); if (q && q.tagName === 'SELECT') sel = q; } } catch (e) {}
              if (!sel) sel = [...document.querySelectorAll('select')].find(s => (((s.id || '') + ' ' + (s.name || '') + ' ' + (s.getAttribute('aria-label') || '') + ' ' + (s.getAttribute('title') || '')).toLowerCase().includes(t)));
              if (!sel) sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => (o.textContent || '').toLowerCase().includes(String(a.text || '').toLowerCase().trim())));
              if (!sel) return { ok: false, notfound: true, msg: 'No dropdown found for: ' + (a.target || '') };
              return setSelectByText(sel, a.text) ? { ok: true, msg: 'Set ' + (a.target || 'dropdown') + ' to ' + (a.text || '') } : { ok: false, msg: 'Option not found: ' + (a.text || '') };
            }
            if (a.type === 'click' || a.type === 'confirm') {
              const el = _local() || _byIdx(a.target) || findEl(a.target);
              if (!el) {
                const t = String(a.target || '').toLowerCase().trim();
                for (const s of document.querySelectorAll('select')) { const o = [...s.options].find(o => (o.textContent || '').toLowerCase().trim().includes(t)); if (o) { s.value = o.value; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); return { ok: true, msg: 'Selected option: ' + (a.target || '') }; } }
                return { ok: false, notfound: true, msg: 'Could not find: ' + (a.target || '') };
              }
              fireClick(el); return { ok: true, msg: 'Clicked: ' + (a.target || '') };
            }
            if (a.type === 'type') {
              const el = _local() || _byIdx(a.target) || findEl(a.target) || (visible(document.activeElement) ? document.activeElement : null);
              if (!el) return { ok: false, notfound: true, msg: 'No field to type into.' };
              if (el.tagName === 'SELECT') return setSelectByText(el, a.text) ? { ok: true, msg: 'Selected ' + (a.text || '') + ' in ' + (a.target || 'dropdown') } : { ok: false, msg: 'Option not found in dropdown.' };
              typeInto(el, a.text || ''); return { ok: true, msg: 'Typed into: ' + (a.target || 'field') };
            }
            if (a.type === 'pastenote') {
              function isEd(el2) { if (!el2) return false; var tg = (el2.tagName || '').toUpperCase(); if (tg === 'TEXTAREA') return true; if (tg === 'INPUT') return /^(text|search|email|url|tel|)$/i.test(el2.type || ''); return !!el2.isContentEditable; }
              var cs = [...document.querySelectorAll('textarea,[contenteditable=""],[contenteditable="true"]')].filter(function (el2) { if (!visible(el2)) return false; var rr = el2.getBoundingClientRect(); return rr.width > 120 && rr.height > 36; });
              cs.sort(function (x, y) { var rx = x.getBoundingClientRect(), ry = y.getBoundingClientRect(); return (ry.width * ry.height) - (rx.width * rx.height); });
              var pe = cs[0] || (isEd(document.activeElement) ? document.activeElement : null);
              if (!pe) return { ok: false, notfound: true, msg: 'No note field found to paste into.' };
              pe.scrollIntoView({ block: 'center' }); typeInto(pe, a.text || '');
              return { ok: true, msg: 'Pasted the note into the chart field (' + ((a.text || '').length) + ' chars).' };
            }
            if (a.type === 'scroll') { window.scrollBy(0, a.dir === 'up' ? -600 : 600); return { ok: true, msg: 'Scrolled.' }; }
            if (a.type === 'read') { return { ok: true, msg: 'Read the screen.' }; }
            return { ok: false, msg: 'Unknown action.' };
          }
          });
          const res = (r && r.result) || {};
          if (res.ok || !res.notfound || i === tries - 1) break; // stop on success, hard error, or last try
          await new Promise(res2 => setTimeout(res2, 350)); // settle, then retry
        }
        sendResponse((r && r.result) || { ok: false, msg: 'No result.' });
      } catch (e) { sendResponse({ ok: false, msg: 'Action failed: ' + e.message }); }
    })();
    return true;
  }
  // Paste the drafted note into the note field of the CURRENT tab, searching
  // EVERY frame (top + iframes). This is what the panel's "Paste note into chart"
  // button uses so it works on iframe-based EMRs like athenaOne and Epic.
  if (msg.type === 'mlsPasteHere') {
    (async () => {
      try {
        const note = String(msg.note || '');
        if (!note.trim()) return sendResponse({ ok: false });
        let tabId = sender && sender.tab && sender.tab.id;
        if (!tabId) { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); tabId = t && t.id; }
        if (!tabId) return sendResponse({ ok: false });
        const measureFn = () => {
          function vis(el){ try{ if(el.disabled||el.readOnly) return false; var s=getComputedStyle(el); if(s.display==='none'||s.visibility==='hidden'||parseFloat(s.opacity||'1')<.05) return false; var r=el.getBoundingClientRect(); return r.width>120&&r.height>30; }catch(e){ return false; } }
          var cs=[].slice.call(document.querySelectorAll('textarea,[contenteditable=""],[contenteditable="true"]')).filter(vis);
          var best=0; cs.forEach(function(el){ var r=el.getBoundingClientRect(); var a=r.width*r.height; if(a>best) best=a; });
          return { area: best };
        };
        let measure = [];
        try { measure = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: measureFn }); }
        catch (e) { measure = await chrome.scripting.executeScript({ target: { tabId }, func: measureFn }); }
        let winnerFrame = null, maxArea = 0;
        (measure || []).forEach(function (m) { if (m && m.result && m.result.area > maxArea) { maxArea = m.result.area; winnerFrame = (m.frameId != null ? m.frameId : 0); } });
        if (winnerFrame === null || maxArea <= 0) return sendResponse({ ok: false });
        const [r] = await chrome.scripting.executeScript({
          target: { tabId, frameIds: [winnerFrame] },
          args: [note],
          func: (text) => {
            function vis(el){ try{ if(el.disabled||el.readOnly) return false; var s=getComputedStyle(el); if(s.display==='none'||s.visibility==='hidden'||parseFloat(s.opacity||'1')<.05) return false; var r=el.getBoundingClientRect(); return r.width>120&&r.height>30; }catch(e){ return false; } }
            var cs=[].slice.call(document.querySelectorAll('textarea,[contenteditable=""],[contenteditable="true"]')).filter(vis);
            cs.sort(function(a,b){ var ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect(); return (rb.width*rb.height)-(ra.width*ra.height); });
            var el=cs[0]; if(!el) return { ok:false };
            try{ el.scrollIntoView({block:'center'}); el.focus(); }catch(e){}
            try{ el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true})); }catch(e){}
            if(el.isContentEditable){ try{ el.dispatchEvent(new InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:text})); }catch(e){} if(!document.execCommand('insertText',false,text)){ el.textContent=text; } }
            else { var p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; var st=Object.getOwnPropertyDescriptor(p,'value'); if(st&&st.set) st.set.call(el,text); else el.value=text; }
            try{ el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text})); }catch(e){ el.dispatchEvent(new Event('input',{bubbles:true})); }
            el.dispatchEvent(new Event('change',{bubbles:true}));
            try{ el.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true})); }catch(e){}
            return { ok:true, into: (el.getAttribute&&(el.getAttribute('aria-label')||el.getAttribute('name')))||el.tagName.toLowerCase() };
          }
        });
        sendResponse((r && r.result && r.result.ok) ? { ok: true, into: r.result.into } : { ok: false });
      } catch (e) { sendResponse({ ok: false, error: e.message }); }
    })();
    return true;
  }
  if (msg.type === 'mlsAppCaptureRequest') {
    (async () => {
      try {
        const tabs = await chrome.tabs.query({});
        const cands = tabs.filter(t => /^https?:/.test(t.url || '') && !/mlsscribe\.com/.test(t.url || ''));
        cands.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        const tab = cands[0];
        if (!tab) return sendResponse({ error: 'No EMR tab is open. Open the patient in your EMR in another tab, then try again.' });
        let pageText = '';
        try {
          const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => (document.body && document.body.innerText || '').slice(0, 20000) });
          pageText = (r && r.result) || '';
        } catch (e) { return sendResponse({ error: 'Could not read the EMR tab (' + e.message + ').' }); }
        if (!pageText.trim()) return sendResponse({ error: 'The EMR tab had no readable text.' });
        const res = await callBackend('/api/assist/extract', { pageText, url: tab.url });
        sendResponse(Object.assign({ fromTab: tab.url }, res));
      } catch (e) { sendResponse({ error: 'Capture failed: ' + e.message }); }
    })();
    return true;
  }
  // Send a finished MLS note INTO the EMR: find the patient's note field (across
  // frames, so Athena's iframes work), then paste — measuring first so it only ever
  // pastes into ONE field, never duplicates across frames.
  if (msg.type === 'mlsAppPasteRequest') {
    (async () => {
      try {
        const note = String(msg.note || '');
        if (!note.trim()) return sendResponse({ error: 'Nothing to send.' });
        const tabs = await chrome.tabs.query({});
        const cands = tabs.filter(t => /^https?:/.test(t.url || '') && !/mlsscribe\.com/.test(t.url || ''));
        cands.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        const tab = cands[0];
        if (!tab) return sendResponse({ error: 'No EMR tab is open. Open the patient in your EMR in another tab, then try again.' });
        try { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); } catch (e) {}
        const measureFn = () => {
          function vis(el){ try{ if(el.disabled||el.readOnly) return false; var s=getComputedStyle(el); if(s.display==='none'||s.visibility==='hidden'||parseFloat(s.opacity||'1')<.05) return false; var r=el.getBoundingClientRect(); return r.width>120&&r.height>34; }catch(e){ return false; } }
          var cs=[].slice.call(document.querySelectorAll('textarea,[contenteditable=""],[contenteditable="true"]')).filter(vis);
          var best=0; cs.forEach(function(el){ var r=el.getBoundingClientRect(); var a=r.width*r.height; if(a>best) best=a; });
          return { area: best };
        };
        let measure = [];
        try { measure = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: measureFn }); }
        catch (e) { measure = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: measureFn }); }
        let winnerFrame = null, maxArea = 0;
        (measure || []).forEach(function (m) { if (m && m.result && m.result.area > maxArea) { maxArea = m.result.area; winnerFrame = (m.frameId != null ? m.frameId : 0); } });
        if (winnerFrame === null || maxArea <= 0) return sendResponse({ error: 'Could not find a note field on the EMR page. Open the patient and click into the note area, then try again.' });
        const [r] = await chrome.scripting.executeScript({
          target: { tabId: tab.id, frameIds: [winnerFrame] },
          args: [note],
          func: (text) => {
            function vis(el){ try{ if(el.disabled||el.readOnly) return false; var s=getComputedStyle(el); if(s.display==='none'||s.visibility==='hidden'||parseFloat(s.opacity||'1')<.05) return false; var r=el.getBoundingClientRect(); return r.width>120&&r.height>34; }catch(e){ return false; } }
            var cs=[].slice.call(document.querySelectorAll('textarea,[contenteditable=""],[contenteditable="true"]')).filter(vis);
            cs.sort(function(a,b){ var ra=a.getBoundingClientRect(),rb=b.getBoundingClientRect(); return (rb.width*rb.height)-(ra.width*ra.height); });
            var el=cs[0]; if(!el) return { ok:false };
            try{ el.scrollIntoView({block:'center'}); el.focus(); }catch(e){}
            if(el.isContentEditable){ if(!document.execCommand('insertText',false,text)){ el.textContent=text; el.dispatchEvent(new Event('input',{bubbles:true})); } }
            else { var p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; var st=Object.getOwnPropertyDescriptor(p,'value'); if(st&&st.set) st.set.call(el,text); else el.value=text; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); el.dispatchEvent(new KeyboardEvent('keyup',{bubbles:true})); }
            return { ok:true, into: (el.getAttribute&&(el.getAttribute('aria-label')||el.getAttribute('name')))||el.tagName.toLowerCase() };
          }
        });
        const res = (r && r.result) || { ok: false };
        if (res.ok) sendResponse({ ok: true, into: res.into });
        else sendResponse({ error: 'Found a note field but could not paste. Click into the EMR note area, then try again.' });
      } catch (e) { sendResponse({ error: 'Send failed: ' + e.message }); }
    })();
    return true;
  }
  if (msg.type === 'mlsAssistCapture') {
    try { chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl) => sendResponse({ dataUrl: dataUrl || '' })); }
    catch (e) { sendResponse({ dataUrl: '' }); }
    return true;
  }
});


// Self-update notifier: badge the icon when a newer version is published.
async function mlsCheckBadge() {
  try {
    const cur = chrome.runtime.getManifest().version;
    const r = await fetch('https://mlsscribe.com/extension-version.json?t=' + Date.now());
    const d = await r.json();
    const cmp = (a, b) => { a = String(a).split('.').map(Number); b = String(b).split('.').map(Number); for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] || 0, y = b[i] || 0; if (x > y) return 1; if (x < y) return -1; } return 0; };
    if (d && d.version && cmp(d.version, cur) > 0) { chrome.action.setBadgeText({ text: '↑' }); chrome.action.setBadgeBackgroundColor({ color: '#1f7ae0' }); }
    else chrome.action.setBadgeText({ text: '' });
  } catch (e) {}
}
try { mlsCheckBadge(); } catch (e) {}
try { chrome.runtime.onStartup.addListener(mlsCheckBadge); } catch (e) {}
try { chrome.runtime.onInstalled.addListener(mlsCheckBadge); } catch (e) {}


// ===========================================================================
// NIGHTLY BACKUP (browser-side). At the chosen local time, the extension finds
// your logged-in EMR tab, captures the open chart, then walks the patient-list
// links it can see and captures each chart — sending them to MLS (encrypted).
// REQUIRES: this computer ON, Chrome running, and the EMR tab still SIGNED IN.
// Best-effort by design: web-UI scraping can miss patients an API sync wouldn't.
// ===========================================================================
const BK_KEY = 'mlsBackup';
function getBackup() { return new Promise(r => chrome.storage.local.get([BK_KEY], c => r(Object.assign({ enabled: false, hour: 2, minute: 0, maxPatients: 250 }, c[BK_KEY] || {})))); }
function setBackup(v) { return new Promise(r => chrome.storage.local.set({ [BK_KEY]: v }, () => r(v))); }

async function scheduleBackupAlarm() {
  try { await chrome.alarms.clear('mlsNightlyBackup'); } catch (e) {}
  const b = await getBackup();
  if (!b.enabled) return;
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), (b.hour | 0), (b.minute | 0), 0, 0);
  if (next.getTime() <= now.getTime() + 5000) next.setDate(next.getDate() + 1);
  try { chrome.alarms.create('mlsNightlyBackup', { when: next.getTime(), periodInMinutes: 1440 }); } catch (e) {}
}
try { chrome.alarms.onAlarm.addListener(a => { if (a && a.name === 'mlsNightlyBackup') runNightlyBackup('schedule'); }); } catch (e) {}
try { chrome.runtime.onStartup.addListener(scheduleBackupAlarm); } catch (e) {}
try { chrome.runtime.onInstalled.addListener(scheduleBackupAlarm); } catch (e) {}
scheduleBackupAlarm();

function findEmrTab(tabs) {
  const c = tabs.filter(t => /^https?:/.test(t.url || '') && !/mlsscribe\.com|\/\/github\.com|mail\.google\.com|console\.twilio|dashboard\.stripe/.test(t.url || ''));
  const ath = c.find(t => /athena/i.test((t.url || '') + ' ' + (t.title || '')));
  if (ath) return ath;
  c.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
  return c[0] || null;
}
async function tabInnerText(tabId, max) {
  try { const [r] = await chrome.scripting.executeScript({ target: { tabId }, args: [max || 20000], func: (m) => (document.body && document.body.innerText || '').slice(0, m) }); return (r && r.result) || ''; }
  catch (e) { return ''; }
}
function waitTabComplete(tabId, timeout) {
  return new Promise(res => {
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; try { chrome.tabs.onUpdated.removeListener(l); } catch (e) {} res(); } }, timeout || 15000);
    function l(id, info) { if (id === tabId && info.status === 'complete') { done = true; clearTimeout(to); try { chrome.tabs.onUpdated.removeListener(l); } catch (e) {} res(); } }
    chrome.tabs.onUpdated.addListener(l);
  });
}
async function collectRoster(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => {
      const out = [], seen = new Set();
      const re = /patient|chart|clinical|encounter|\bexam\b|chartid|enc=|patientid|deptid|pat_id/i;
      for (const a of document.querySelectorAll('a[href]')) {
        const href = a.href || '', raw = a.getAttribute('href') || '', txt = (a.innerText || '').trim();
        if (!/^https?:/.test(href)) continue;
        if (!re.test(href) && !re.test(raw)) continue;
        if (seen.has(href)) continue; seen.add(href);
        out.push({ href, txt: txt.slice(0, 80) });
        if (out.length >= 400) break;
      }
      return out;
    }});
    return (r && r.result) || [];
  } catch (e) { return []; }
}
async function runNightlyBackup(trigger) {
  const started = Date.now();
  const cfg = await getBackup();
  const finish = async (res) => { await setBackup(Object.assign(await getBackup(), { lastRun: res.at, lastResult: res })); return res; };
  const tabs = await chrome.tabs.query({});
  const emr = findEmrTab(tabs);
  if (!emr) return finish({ ok: false, error: 'No EMR tab is open. Leave an Athena tab open and signed in.', at: new Date().toISOString() });
  const firstText = await tabInnerText(emr.id, 6000);
  if (firstText.length < 1500 && /\b(log\s?in|sign\s?in|password|username)\b/i.test(firstText)) {
    return finish({ ok: false, error: 'The EMR tab looks signed out — nothing was backed up. Stay signed in to Athena overnight.', at: new Date().toISOString() });
  }
  let captured = 0, patients = 0, errors = 0;
  // 1) capture the chart currently open
  if (firstText.trim()) {
    const c = await callBackend('/api/assist/extract', { pageText: firstText, url: emr.url });
    if (c && c.ok) { captured++; if (c.patient) patients++; } else if (c && c.error) { errors++; }
  }
  // 2) walk patient-list links and capture each
  const roster = await collectRoster(emr.id);
  const origUrl = emr.url;
  const cap = Math.min(roster.length, cfg.maxPatients || 250);
  for (let i = 0; i < cap; i++) {
    try {
      await chrome.tabs.update(emr.id, { url: roster[i].href });
      await waitTabComplete(emr.id, 15000);
      await new Promise(r => setTimeout(r, 1300));
      const txt = await tabInnerText(emr.id, 20000);
      if (!txt.trim()) continue;
      const c = await callBackend('/api/assist/extract', { pageText: txt, url: roster[i].href });
      if (c && c.ok) { captured++; if (c.patient) patients++; } else if (c && c.error) { errors++; }
    } catch (e) { errors++; }
    await new Promise(r => setTimeout(r, 400));
  }
  try { await chrome.tabs.update(emr.id, { url: origUrl }); } catch (e) {}
  return finish({ ok: true, captured, patients, errors, scanned: roster.length, trigger: trigger || 'manual', at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000) });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === 'mlsGetBackup') { getBackup().then(sendResponse); return true; }
  if (msg.type === 'mlsSetBackup') { setBackup(Object.assign({ enabled: false, hour: 2, minute: 0, maxPatients: 250 }, msg.value || {})).then(scheduleBackupAlarm).then(() => sendResponse({ ok: true })); return true; }
  if (msg.type === 'mlsRunBackupNow') { runNightlyBackup('manual').then(sendResponse); return true; }
});
