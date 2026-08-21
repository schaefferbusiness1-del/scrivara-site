/* MLS Scribe 1p preview -- exact Athena Revenue & Usage occurrence search.
   Read-only Athena bridge; local/ephemeral results; explicit, strict import handoff. */
(function () {
  'use strict';
  if (!window.__MLS_P1_PREVIEW || window.__MLS_P1_PREVIEW.enabled !== true) return;
  var script = document.currentScript, loader = window.__mlsP1AthenaOccurrenceLoader;
  if (!script || !loader || loader.installed !== true || loader.version !== 'p1-athena-occurrence-1.0.0' ||
      !loader.installToken || script.getAttribute('data-mls-install-token') !== loader.installToken ||
      script.getAttribute('data-mls-asset') !== 'feat_mls_athena_occurrence.js') return;
  window.__mlsP1AthenaOccurrenceInstallToken = loader.installToken;
})();
(function () {
  'use strict';
  var loader = window.__mlsP1AthenaOccurrenceLoader, script = document.currentScript;
  if (!window.__MLS_P1_PREVIEW || window.__MLS_P1_PREVIEW.enabled !== true || !loader || loader.installed !== true ||
      !script || script.getAttribute('data-mls-install-token') !== loader.installToken ||
      window.__mlsP1AthenaOccurrenceInstallToken !== loader.installToken) return;
(function () {
  'use strict';
  try { var priorLease=window.__mlsP1AthenaReadLease; if (priorLease && priorLease.version === 'p1-athena-read-lease-1.0.0' && ['claim','ready','owns','touch','release','busy','state'].every(function(k){return typeof priorLease[k]==='function';})) return; } catch (e0) {}
  var active = null, seq = 0;
  function S(v) { return String(v == null ? '' : v); }
  function liveScheduleLease() { try { var l = window.__mlsSchedulePullLease; if (l && Date.now() - Number(l.at || 0) < 180000) return l; } catch (e) {} return null; }
  function claim(kind, maxMs) {
    var now = Date.now();
    /* An acquired Web Lock is the authoritative cross-tab owner. Never evict
       it because background-tab timer throttling delayed a heartbeat; only
       its explicit terminal release may unlock it. */
    if (active && active.webHeld !== true && now - Number(active.at || 0) >= Number(active.staleMs || 180000)) { try { if (active.unlock) active.unlock(); if (liveScheduleLease() && window.__mlsSchedulePullLease.id === active.token) delete window.__mlsSchedulePullLease; } catch (e0) {} active = null; }
    if (active || liveScheduleLease()) return null;
    var token = 'p1-athena-read-' + now.toString(36) + '-' + (++seq).toString(36), ttl = Math.max(90000, Math.min(420000, Number(maxMs || 0) || 180000));
    var resolveReady=null,readyPromise=new Promise(function(resolve){resolveReady=resolve;});
    active = { token: token, kind: S(kind || 'read'), at: now, staleMs: ttl, deadlineAt: now + ttl, readyPromise: readyPromise, resolveReady: resolveReady, webHeld: false, unlock: null };
    try { window.__mlsSchedulePullLease = { id: token, kind: active.kind, at: now }; window.__mlsPullBusyAt = now; } catch (e1) { active = null; return null; }
    var owned=active;
    try {
      if (window.navigator && window.navigator.locks && typeof window.navigator.locks.request === 'function') {
        Promise.resolve(window.navigator.locks.request('mls-managed-athena-pull', { ifAvailable: true }, function (lock) {
          if (!active || active !== owned || active.token !== token || !lock) { try { resolveReady(false); } catch (_) {} return; }
          active.webHeld = true; try { resolveReady(true); } catch (_) {}
          return new Promise(function (unlock) { if (active && active === owned) active.unlock = unlock; else unlock(); });
        })).catch(function () { try { resolveReady(false); } catch (_) {} });
      } else resolveReady(true);
    } catch (e2) { try { resolveReady(false); } catch (_) {} }
    return token;
  }
  function touch(token) { if (!active || active.token !== token) return false; active.at = Date.now(); active.deadlineAt=active.at+active.staleMs; try { var l = window.__mlsSchedulePullLease; if (l && l.id === token) { l.at = active.at; window.__mlsPullBusyAt = active.at; } } catch (e) {} return true; }
  function ready(token) { return active && active.token === token ? active.readyPromise : Promise.resolve(false); }
  function release(token) { if (!active || active.token !== token) return false; var old=active; try { if(old.resolveReady&&!old.webHeld)old.resolveReady(false);if(old.unlock)old.unlock();var l = window.__mlsSchedulePullLease; if (l && l.id === token) { delete window.__mlsSchedulePullLease; window.__mlsPullBusyAt = 0; } } catch (e) {} active = null; return true; }
  window.__mlsP1AthenaReadLease = { version: 'p1-athena-read-lease-1.0.0', claim: claim, ready: ready, owns:function(token){return !!(active&&active.token===token);}, touch: touch, release: release, busy: function () { return !!active; }, state: function () { return active ? { kind: active.kind, draining: true, webHeld:active.webHeld===true, deadlineAt: active.deadlineAt } : { kind: '', draining: false, webHeld:false, deadlineAt: 0 }; } };
})();
(function () {
  'use strict';
  var VERSION = 'p1-athena-occurrence-1.0.0';
  var INSTALL_TOKEN = loader.installToken;
  var PANEL_ID = 'mlsOccPanel';
  var MAX_RESULTS = 100;
  var MAX_PAGES = 60;
  var MAX_TEXT = 300000;
  var priorApi = window.__mlsAthenaOccurrence;
  if (priorApi && priorApi.version === VERSION && priorApi.installed === true && priorApi.installToken === INSTALL_TOKEN) return;
  if (priorApi && priorApi.installed === true) {
    if (typeof priorApi.revert !== 'function') return;
    try { priorApi.revert(); } catch (takeoverErr) { return; }
    if (window.__mlsAthenaOccurrence === priorApi && priorApi.installed === true) return;
  }

  function S(v) { return String(v == null ? '' : v); }
  function clean(v) { return S(v).replace(/\s+/g, ' ').trim(); }
  function lower(v) { return clean(v).toLowerCase(); }
  function esc(v) { return S(v).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function uniq(a) { var seen = {}, out = []; (a || []).forEach(function (v) { var k = S(v).toUpperCase(); if (k && !seen[k]) { seen[k] = 1; out.push(k); } }); return out; }
  function alnum(v) { return S(v).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function digits(v) { return S(v).replace(/\D/g, ''); }
  function nameKey(v) { return lower(v).replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(function (x) { return x.length > 1; }).sort().join('|'); }
  function dobKey(v) {
    var s = clean(v), m = s.match(/^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
    if (m) return ('0' + m[2]).slice(-2) + ('0' + m[3]).slice(-2) + m[1];
    m = s.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
    if (!m) return '';
    var y = m[3]; if (y.length === 2) y = (parseInt(y, 10) > 30 ? '19' : '20') + y;
    return ('0' + m[1]).slice(-2) + ('0' + m[2]).slice(-2) + y;
  }
  function hash(v) { var s = S(v), h = 2166136261, i; for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); } return (h >>> 0).toString(36); }

  var FACILITIES = [
    { key: 'sccc_hospital', name: 'POSM ASC Chester County Hospital', departmentId: '', aliases: ['sccc hospital', 'posm asc chester county hospital', 'chester county hospital'] },
    { key: 'sccc', name: 'POSM ASC Chester County', departmentId: '744', aliases: ['sccc', 'posm asc chester county', 'chester county surgery center', 'asc chester county'] }
  ];
  function resolveFacility(value) {
    var raw = clean(value), key = lower(raw).replace(/[?.!,;:]+$/g, '');
    var ordered = FACILITIES.slice().sort(function (a, b) { return b.name.length - a.name.length; });
    for (var i = 0; i < ordered.length; i++) {
      var f = ordered[i], names = [lower(f.name)].concat(f.aliases || []);
      for (var j = 0; j < names.length; j++) if (key === lower(names[j])) return { key: f.key, name: f.name, departmentId: f.departmentId, resolved: true, input: raw };
    }
    if (/\b(?:sccc|chester county)\s+hospital\b/.test(key)) return { key: 'sccc_hospital', name: 'POSM ASC Chester County Hospital', departmentId: '', resolved: true, input: raw };
    if (/\bsccc\b/.test(key) || (/\bposm asc chester county\b/.test(key) && !/\bhospital\b/.test(key))) return { key: 'sccc', name: 'POSM ASC Chester County', departmentId: '744', resolved: true, input: raw };
    return raw ? { key: 'exact', name: raw, departmentId: '', resolved: false, input: raw } : { key: '', name: '', departmentId: '', resolved: false, input: '' };
  }
  function facilityFromLine(line) {
    var t = lower(line);
    if (t.indexOf('posm asc chester county hospital') >= 0) return 'POSM ASC Chester County Hospital';
    if (t.indexOf('posm asc chester county') >= 0) return 'POSM ASC Chester County';
    return '';
  }
  function parseQuery(query, facilityInput) {
    var q = clean(query);
    var codes = uniq((q.match(/\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{5}\b/gi) || []).map(function (x) { return x.toUpperCase(); }));
    var qm = q.match(/\b(?:at|facility|location|site)\s+(?:the\s+)?(.+?)(?:\s*[?.!]|$)/i);
    var fac = resolveFacility(clean(facilityInput) || (qm ? qm[1].replace(/^all\s+(?:done\s+)?/i, '') : ''));
    var words = q.replace(/\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{5}\b/gi, ' ')
      .replace(/\b(?:who|which|patients?|people|had|have|has|procedure|cpt|code|all|done|performed|received|underwent|find|show|me)\b/gi, ' ')
      .replace(/\b(?:at|facility|location|site)\b[\s\S]*$/i, ' ').replace(/[^a-z0-9\- ]/gi, ' ');
    var keywords = clean(words) ? [lower(words)] : [];
    return { ok: !!(codes.length && fac.name), query: q, codes: codes, keywords: keywords, exactCpt: codes.length > 0, facility: fac, label: (codes.length ? ('CPT ' + codes.join(', ')) : 'procedure') + (fac.name ? (' at ' + fac.name) : ''), from: '', to: '' };
  }

  function dateParts(s) { var k = dobKey(s); return k ? { key: k, year: parseInt(k.slice(4), 10) } : null; }
  function classifyDates(dates) {
    var now = new Date().getFullYear(), parsed = (dates || []).map(function (d) { var p = dateParts(d.s); return p ? { s: d.s, idx: d.idx, year: p.year } : null; }).filter(Boolean);
    if (!parsed.length) return { dob: '', svc: '', dobIdx: -1, svcIdx: -1 };
    if (parsed.length > 1) {
      var byYear = parsed.slice().sort(function (a, b) { return a.year - b.year; });
      return { dob: byYear[0].s, svc: byYear[byYear.length - 1].s, dobIdx: byYear[0].idx, svcIdx: byYear[byYear.length - 1].idx };
    }
    return now - parsed[0].year >= 2 ? { dob: parsed[0].s, svc: '', dobIdx: parsed[0].idx, svcIdx: -1 } : { dob: '', svc: parsed[0].s, dobIdx: -1, svcIdx: parsed[0].idx };
  }
  function patientNameFromLine(raw, dates, facility) {
    var c = classifyDates(dates), segment = raw;
    if (c.svcIdx >= 0 && c.dobIdx > c.svcIdx) segment = raw.slice(c.svcIdx + c.svc.length, c.dobIdx);
    else if (c.dobIdx > 0) segment = raw.slice(0, c.dobIdx);
    if (facility) segment = segment.replace(new RegExp(facility.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
    segment = segment.replace(/\b(?:patient\s+name\s*\/\s*id\s*\/\s*dob|patient\s+id|patient\s+name|claim\s+id|patient|mrn|claim)\b\s*[:#]?/gi, ' ').replace(/\b\d{5,}\b/g, ' ').replace(/\s+/g, ' ').trim();
    var m = segment.match(/([A-Z][A-Za-z'\-]+)\s*,\s*([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]*){0,2})/);
    if (m) return clean(m[1] + ', ' + m[2]);
    var caps = segment.match(/\b[A-Z][A-Za-z'\-]{1,}\b/g) || [];
    var stop = /^(POSM|ASC|CPT|DOS|Service|Department|Chester|County|Hospital|Procedure|Code|Date|Patient|Claim)$/i;
    caps = caps.filter(function (x) { return !stop.test(x); });
    return caps.length >= 2 ? caps.slice(0, Math.min(3, caps.length)).join(' ') : '';
  }
  function parseRows(text) {
    var out = [], dateRe = /\b([01]?\d[\/.\-][0-3]?\d[\/.\-]\d{2,4})\b/g;
    S(text).split(/\r?\n/).forEach(function (line) {
      var raw = clean(line); if (raw.length < 8) return;
      var pipe = raw.indexOf('|') >= 0 ? raw.split('|').map(clean).filter(Boolean) : [];
      var dates = [], dm; dateRe.lastIndex = 0; while ((dm = dateRe.exec(raw))) dates.push({ s: dm[1], idx: dm.index });
      /* Revenue & Usage output has exactly one patient/claim occurrence per
         DOM row.  If the frozen fallback flattened more than that, decline it
         instead of joining CPT/facility evidence across occurrences. */
      var patientLabels = (raw.match(/\bpatient(?:\s+name)?(?:\s*\/\s*id(?:\s*\/\s*dob)?)?\b/gi) || []).length;
      var claimLabels = (raw.match(/\bclaim(?:\s+id)?\b/gi) || []).length;
      var knownFacilities = uniq([/\bPOSM\s+ASC\s+Chester\s+County\s+Hospital\b/i.test(raw) ? 'H' : '', /\bPOSM\s+ASC\s+Chester\s+County\b/i.test(raw.replace(/POSM\s+ASC\s+Chester\s+County\s+Hospital/ig, '')) ? 'S' : ''].filter(Boolean));
      if (dates.length > 2 || patientLabels > 1 || claimLabels > 1 || knownFacilities.length > 1) return;
      var facility = facilityFromLine(raw), dc = classifyDates(dates), name = '', patientId = '', claimId = '', codes = [];
      /* Revenue & Usage places DOS before the patient composite and DOB inside
         it. Preserve that structural order even for infant/same-year dates;
         year-sorting cannot distinguish two 2026 dates. */
      if(dates.length===2){dc.svc=dates[0].s;dc.svcIdx=dates[0].idx;dc.dob=dates[1].s;dc.dobIdx=dates[1].idx;}
      if (pipe.length >= 5) {
        var pc = pipe.filter(function (c) { return /[A-Za-z'\-]+\s*,\s*[A-Za-z'\-]+/.test(c) && /\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4}/.test(c); })[0] || '';
        var pmc = pc.match(/^\s*([^/]+?)\s*\/\s*([A-Z0-9\-]{3,})\s*\/\s*(\d{1,4}[\/.\-]\d{1,2}[\/.\-]\d{1,4})\s*$/i);
        if (pmc) { name = clean(pmc[1]); patientId = clean(pmc[2]); dc.dob = pmc[3]; }
        var codeCell = pipe[pipe.length - 1], codeMatches = codeCell.match(/\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{5}\b/gi) || [];
        codes = uniq(codeMatches);
        if (pipe.length >= 2) claimId = clean(pipe[pipe.length - 2].replace(/^claim(?:\s+id)?\s*[:#]?\s*/i, ''));
      }
      if (!pipe.length && facility && dates.length === 2) {
        /* The frozen reader collapses each <tr> to one space-normalized line.
           Recover the slash-delimited patient composite by its structural
           boundaries, not an ASCII-only name guess, and consume the complete
           trailing procedure cell.  Nothing before the service date or after
           that closed tail may be silently dropped. */
        var svcEnd=dc.svcIdx>=0?dc.svcIdx+dc.svc.length:-1,dobSlash=raw.match(/\/\s*(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})\s+/),firstSlash=svcEnd>=0?raw.indexOf('/',svcEnd):-1;
        if(firstSlash>svcEnd&&dobSlash&&dobSlash.index>firstSlash){
          var idPart=clean(raw.slice(firstSlash+1,dobSlash.index)),namePart=clean(raw.slice(svcEnd,firstSlash));
          var tail=clean(raw.slice(dobSlash.index+dobSlash[0].length)),tailMatch=tail.match(/^([A-Z0-9][A-Z0-9\-]{0,79})\s+((?:(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{5})(?:\s*[,;]\s*(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{5})*)(?:\s+[A-Za-z][A-Za-z\s\-]{0,80})?\s*$/i);
          var safeName=/^[\p{L}][\p{L}\p{M}'\u2019.\-]+\s*,\s*[\p{L}][\p{L}\p{M}'\u2019.\-]+(?:\s+(?:[\p{L}][\p{L}\p{M}'\u2019.\-]*|Jr\.?|Sr\.?|II|III|IV)){0,4}$/iu.test(namePart);
          if(safeName&&/^[A-Z0-9\-]{3,80}$/i.test(idPart)&&tailMatch){
            name=namePart.replace(/[\u2018\u2019]/g,"'");patientId=idPart;dc.dob=dobSlash[1];claimId=tailMatch[1];codes=uniq(tailMatch[2].match(/\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{5}\b/gi)||[]);
          }
        }
      }
      var pm = raw.match(/\bpatient\s+id\s*[:#]?\s*([A-Z0-9\-]{3,})\b/i);
      if (!patientId && pm) patientId = pm[1];
      var cm = raw.match(/\bclaim(?:\s+id)?\s*[:#]?\s*([A-Z0-9\-]{1,})\b/i);
      if (!claimId && cm && !/^id$/i.test(cm[1])) claimId = cm[1];
      var labeled = raw.match(/\bprocedure\s+code(?:\(s\)|s)?\s*[:#]?\s*((?:(?:[A-Z0-9]{5})[\s,;]*)+)/i);
      if (labeled) codes = uniq(labeled[1].match(/\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{5}\b/gi) || []);
      if (!codes.length && !pipe.length && facility && dates.length === 2 && patientId && claimId) {
        var tail = raw.match(/\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{5}\b\s*$/i);
        if (tail && alnum(tail[0]) !== alnum(patientId) && alnum(tail[0]) !== alnum(claimId)) codes = [clean(tail[0]).toUpperCase()];
      }
      if (!name) name = patientNameFromLine(raw, dates, facility);
      name = clean(name).replace(/\s+ID$/i, '');
      if (!name || !dobKey(dc.dob) || !facility || !codes.length) return;
      out.push({ name: name, dob: dc.dob, svc: dc.svc, codes: codes, facility: facility, patientId: patientId, claimId: claimId, line: raw, occurrenceKey: hash(raw) });
    });
    return out;
  }
  function exactFacilityMatch(row, wanted) {
    var target = resolveFacility(wanted), got = clean(row && row.facility) || facilityFromLine(row && row.line);
    if (!target.name || !got) return false;
    return lower(got) === lower(target.name);
  }
  function inRange(svc, from, to) {
    if (!from && !to) return true;
    var sk = dobKey(svc); if (!sk) return false;
    var ymd = sk.slice(4) + sk.slice(0, 2) + sk.slice(2, 4), fk = from ? S(from).replace(/\D/g, '') : '', tk = to ? S(to).replace(/\D/g, '') : '';
    if (fk && ymd < fk) return false; if (tk && ymd > tk) return false; return true;
  }
  function filterRows(rows, spec) {
    var codes = uniq(spec && spec.codes), kw = (spec && spec.keywords || []).map(lower).filter(Boolean);
    return (rows || []).filter(function (r) {
      var codeHit = codes.length && (r.codes || []).some(function (c) { return codes.indexOf(S(c).toUpperCase()) >= 0; });
      var kwHit = !codes.length && kw.length && kw.some(function (k) { return lower(r.line).indexOf(k) >= 0; });
      if (codes.length ? !codeHit : (kw.length && !kwHit)) return false;
      if (spec && spec.facility && spec.facility.name && !exactFacilityMatch(r, spec.facility.name)) return false;
      return inRange(r.svc, spec && spec.from, spec && spec.to);
    });
  }
  function dedupeForDisplay(rows) {
    var claimSeen = {}, occurrenceSeen = {}, unique = [];
    (rows || []).forEach(function (r) {
      var ck = clean(r.claimId) ? ('claim|' + alnum(r.claimId)) : '';
      var ok = ck || ('occ|' + nameKey(r.name) + '|' + dobKey(r.dob) + '|' + dobKey(r.svc) + '|' + (r.codes || []).slice().sort().join(',') + '|' + lower(r.facility) + '|' + r.occurrenceKey);
      if ((ck && claimSeen[ck]) || occurrenceSeen[ok]) return;
      if (ck) claimSeen[ck] = 1; occurrenceSeen[ok] = 1; unique.push(r);
    });
    var groups = {}, out = [];
    unique.forEach(function (r) {
      var pk = clean(r.patientId) ? ('id|' + alnum(r.patientId) + '|' + nameKey(r.name) + '|' + dobKey(r.dob)) : ('person|' + nameKey(r.name) + '|' + dobKey(r.dob));
      if (!groups[pk]) { var c = {}; Object.keys(r).forEach(function (k) { c[k] = r[k]; }); c.occurrences = []; groups[pk] = c; out.push(c); }
      groups[pk].occurrences.push(r);
    });
    out.forEach(function (r) { r.occurrenceCount = r.occurrences.length; });
    return out;
  }
  function retrievalReceipt(resp) {
    resp = resp || {}; var text = S(resp.text), pages = Math.max(0, parseInt(resp.pages, 10) || 0);
    var truncated = resp.truncated === true || resp.partial === true || text.length >= MAX_TEXT || pages >= MAX_PAGES;
    var explicitComplete = resp.complete === true || resp.paginationComplete === true || resp.authoritativeComplete === true;
    var complete = explicitComplete && !truncated;
    return { complete: complete, partial: !complete, truncated: truncated, pages: pages, chars: text.length, reason: complete ? 'verified-complete' : (truncated ? 'truncated-or-page-limit' : 'legacy-completeness-unverified') };
  }

  function identityDecision(row, patients) {
    patients = Array.isArray(patients) ? patients : [];
    var rid = alnum(row && row.patientId), nk = nameKey(row && row.name), dk = dobKey(row && row.dob), byId = [];
    if (rid) byId = patients.filter(function (p) { return [p && p.athenaId, p && p.athenaPatientId, p && p.mrn].some(function (v) { return alnum(v) && alnum(v) === rid; }); });
    if (byId.length > 1) return { action: 'review', reason: 'duplicate Athena patient identity in MLS' };
    if (byId.length === 1) {
      if (nk && dk && nameKey(byId[0].name) === nk && dobKey(byId[0].dob) === dk) return { action: 'already', patient: byId[0], via: 'athena-id' };
      return { action: 'review', reason: 'Athena patient ID conflicts with name or DOB' };
    }
    if (!nk || !dk) return { action: 'review', reason: 'name and DOB are required for strict verification' };
    var exact = patients.filter(function (p) { return nameKey(p && p.name) === nk && dobKey(p && p.dob) === dk; });
    if (exact.length > 1) return { action: 'review', reason: 'duplicate MLS patients match this name and DOB' };
    if (exact.length === 1) { var storedId = alnum(exact[0] && (exact[0].athenaId || exact[0].athenaPatientId || exact[0].mrn)); if (rid && storedId && rid !== storedId) return { action: 'review', reason: 'name and DOB match an MLS patient with a different Athena patient ID' }; return { action: 'already', patient: exact[0], via: 'name-dob' }; }
    return { action: 'import' };
  }
  function batchVerdict(candidateCount, selectedIndexes, statuses, retrieval, cancelled) {
    var indexes = (selectedIndexes || []).map(function (x) { return parseInt(x, 10); }).filter(function (x, i, a) { return x >= 0 && a.indexOf(x) === i; });
    var selectedCount = indexes.length;
    var counts = { imported: 0, already: 0, failed: 0, review: 0 };
    indexes.forEach(function (k) { var s = statuses && statuses[k] && statuses[k].code; if (counts[s] != null) counts[s]++; });
    var processed = counts.imported + counts.already + counts.failed + counts.review;
    var fullSelection = selectedCount > 0 && selectedCount === candidateCount;
    var selectedComplete = selectedCount > 0 && !cancelled && processed === selectedCount && counts.failed === 0 && counts.review === 0;
    var complete = selectedComplete && fullSelection && !!(retrieval && retrieval.complete);
    return { complete: complete, selectedComplete: selectedComplete, coverageComplete: complete, partial: !complete, selectedCount: selectedCount, candidateCount: candidateCount, fullSelection: fullSelection, processed: processed, counts: counts, reason: complete ? 'complete' : (cancelled ? 'cancelled' : (!selectedComplete ? 'patient-pull-incomplete' : (!fullSelection ? 'partial-selection' : 'retrieval-incomplete'))) };
  }

  var seq = 0, epoch = 0, lease = null, snapshot = null, boundaryHandler = null, studyHandler = null;
  function makeRun(kind, panel) { if (lease) return null; lease = { id: ++seq, kind: kind, panel: panel, cancelled: false, settled: false }; return lease; }
  function current(run) { return !!(run && lease === run && !run.settled); }
  function cancelRun() { if (!lease || lease.settled) return false; lease.cancelled = true; try { if (typeof lease.abortPreDispatch === 'function') lease.abortPreDispatch(); } catch (e) {} return true; }
  function finishRun(run) { if (!current(run)) return false; run.settled = true; lease = null; return true; }
  function livePanel(panel) { try { return document.getElementById(PANEL_ID) === panel && Number(panel.__mlsOccEpoch) === epoch; } catch (e) { return false; } }
  function setBusy(panel, busy) {
    var b = panel && panel.querySelector('#mlsOccSearch'), c = panel && panel.querySelector('#mlsOccCancel');
    if (b) b.disabled = !!busy; if (c) { c.disabled = !busy; c.style.display = busy ? '' : 'none'; }
  }
  function claimAthena(run, kind, maxMs) {
    var mgr = window.__mlsP1AthenaReadLease, token = mgr && typeof mgr.claim === 'function' ? mgr.claim(kind, maxMs) : null;
    if (!token) return false;
    run.bridgeToken = token;
    run.bridgeTouch = setInterval(function () { try { mgr.touch(token); } catch (e) {} }, 25000);
    return true;
  }
  function releaseAthena(run) {
    if (!run) return;
    if (run.bridgeTouch) { try { clearInterval(run.bridgeTouch); } catch (e0) {} run.bridgeTouch = null; }
    if (run.bridgeToken) { try { var mgr = window.__mlsP1AthenaReadLease; if (mgr && typeof mgr.release === 'function') mgr.release(run.bridgeToken); } catch (e1) {} run.bridgeToken = '' ; }
  }
  function awaitAthena(run) { try { var mgr=window.__mlsP1AthenaReadLease; return mgr&&typeof mgr.ready==='function'?Promise.resolve(mgr.ready(run.bridgeToken)):Promise.resolve(true); } catch(e) { return Promise.resolve(false); } }
  function status(panel, html) { var n = panel && panel.querySelector('#mlsOccOut'); if (n) n.innerHTML = html; }

  function bridgeSearch(params, cfg, say, authorized, boundRun) {
    return new Promise(function (resolve, reject) {
      var pong = false, sent = false, timedOut = false, tries = 0, done = false, iv = null, timeout = null;
      function allowed() { try { return typeof authorized !== 'function' || authorized() === true; } catch (e) { return false; } }
      function cancelledError() { var ce = new Error('Search canceled before Athena work started.'); ce.code = 'CANCELLED_PRE_DISPATCH'; return ce; }
      function abortPreDispatch() { if (!sent && !done) { settle(reject, cancelledError()); return true; } return false; }
      function cleanup() { try { window.removeEventListener('message', onMessage); } catch (e) {} if (iv) clearInterval(iv); if (timeout) clearTimeout(timeout); if (boundRun && boundRun.abortPreDispatch === abortPreDispatch) boundRun.abortPreDispatch = null; }
      function settle(fn, value) { if (done) return; done = true; cleanup(); fn(value); }
      function onMessage(e) {
        try { if ((e.source && e.source !== window) || (e.origin && window.location && e.origin !== window.location.origin)) return; } catch (trustErr) { return; }
        var d = e && e.data; if (!d || d.source !== 'mls-ext') return;
        if (d.type === 'mlsPong' && !pong) { if (!allowed()) { abortPreDispatch(); return; } pong = true; if (iv) clearInterval(iv); try { say('Running the read-only Athena Revenue and Usage search...'); } catch (x) {} try { window.postMessage({ source: 'mls-app', type: 'mlsAppSearchProcedure', params: params, cfg: cfg }, '*'); sent = true; } catch (err) { settle(reject, err); } return; }
        if (!sent) return;
        if (d.type === 'mlsAppSearchProgress') { try { say(d.msg || 'Reading Athena results...'); } catch (x2) {} return; }
        if (d.type === 'mlsAppSearchResult') {
          if (timedOut) { var te = new Error('The timed-out Athena search finished and was discarded. The reader is safe to retry.'); te.code = 'UNCORRELATED_TIMEOUT_DRAINED'; settle(reject, te); return; }
          var r = d.resp || {}, controls = r.ranControls || {};
          if (!r.ok) { var er = new Error(r.error || 'Athena search failed.'); er.code = r.code || ''; settle(reject, er); }
          else if (controls.filledCpt !== true || controls.clickedRun !== true) { var ce = new Error('Athena did not prove that it filled the exact CPT and ran the open report. No rows were accepted.'); ce.code = 'CONTROLS_UNVERIFIED'; settle(reject, ce); }
          else settle(resolve, r);
        }
      }
      if (boundRun) boundRun.abortPreDispatch = abortPreDispatch;
      if (!allowed()) { abortPreDispatch(); return; }
      window.addEventListener('message', onMessage);
      try { say('Looking for MLS Assist...'); window.postMessage({ source: 'mls-app', type: 'mlsPing' }, '*'); } catch (e) { settle(reject, e); return; }
      iv = setInterval(function () { if (pong) return; if (!allowed()) { abortPreDispatch(); return; } tries++; if (tries > 8) settle(reject, new Error('MLS Assist is not responding. Keep signed-in athenaOne open and retry.')); else try { window.postMessage({ source: 'mls-app', type: 'mlsPing' }, '*'); } catch (e) {} }, 350);
      /* The frozen extension does not echo a request id for report searches.
         Once dispatched, timeout/cancel therefore cannot safely release the
         bridge: a late old result could satisfy a newer listener. Keep this
         listener plus the shared Web Lock quarantined until its terminal
         result drains, or until page reload destroys the whole operation. */
      timeout = setTimeout(function () {
        if (!sent || done) { var pe = new Error('The read-only Athena search timed out before it started.'); pe.code = 'PRE_DISPATCH_TIMEOUT'; settle(reject, pe); return; }
        timedOut = true; timeout = null;
        try { say('Athena is still finishing the timed-out search. Its reader is quarantined until Athena returns or this preview is reloaded; no late result will be accepted.'); } catch (e) {}
      }, 360000);
    });
  }
  function chartReceiptComplete(resp, requestId, startedAt, deadlineAt) {
    var r = resp && resp.receipt, expected = r && Number(r.expectedClinicalFrames || 0), captured = r && Number(r.capturedAt || 0);
    var fresh = Number(startedAt || 0) > 0 && Number(deadlineAt || 0) > Number(startedAt || 0) && captured >= Number(startedAt) - 5000 && captured <= Number(deadlineAt);
    return !!(r && r.kind === 'athena-chart-coverage' && r.complete === true && r.truncated !== true && String(r.readerVersion || '') === '2.9.19-chart-r3' && String(r.requestId || '') === requestId && String(resp.requestId || '') === requestId && r.identityObserved === true && clean(r.identityVia) && fresh && expected >= 1 && Number(r.readClinicalFrames || 0) === expected && Number(r.boundClinicalFrames || 0) === expected && Number(r.unboundClinicalFrames || 0) === 0 && Number(r.oversizeClinicalFrames || 0) === 0 && Number(r.unreadFrames || 0) === 0 && Number(r.omittedForCap || 0) === 0 && Number(r.textChars || 0) === S(resp.text).length);
  }
  function resolvedLine(spec) { return '<div class="mls-occ-resolved">Resolved facility: <b>' + esc(spec.facility.name) + '</b>' + (spec.facility.departmentId ? (' &middot; Athena department ' + esc(spec.facility.departmentId)) : '') + '. Exact CPT: <b>' + esc(spec.codes.join(', ')) + '</b>.</div>'; }
  function receiptHtml(r) {
    var p = r.pages ? (r.pages + ' page' + (r.pages === 1 ? '' : 's')) : 'page count unavailable';
    return r.complete ? '<div class="mls-occ-ok">Verified complete retrieval &middot; ' + esc(p) + '.</div>' : '<div class="mls-occ-warn">Completeness not verified (' + esc(r.reason) + ', ' + esc(p) + '). Matching evidence is shown, but this search is not reported as complete.</div>';
  }
  function maskedClaim(v) { var s = clean(v); if (!s) return ''; return s.length <= 4 ? '••••' : ('••••' + s.slice(-4)); }
  function occurrenceEvidence(r, spec) {
    var occurrences = Array.isArray(r.occurrences) && r.occurrences.length ? r.occurrences : [r];
    return occurrences.map(function (o) { return '<span class="mls-occ-occ">DOS ' + esc(o.svc || 'unreadable') + ' &middot; CPT ' + esc((o.codes || spec.codes).join(', ')) + ' &middot; ' + esc(o.facility || spec.facility.name) + (o.claimId ? (' &middot; claim ' + esc(maskedClaim(o.claimId))) : '') + '</span>'; }).join('');
  }
  function renderResults(panel, snap) {
    if (!livePanel(panel) || snapshot !== snap) return;
    var rows = snap.candidates, html = resolvedLine(snap.spec) + receiptHtml(snap.receipt);
    if (!rows.length) { status(panel, html + '<div class="mls-occ-empty">0 same-occurrence matches. No patient was pulled.</div>'); return; }
    html += '<div class="mls-occ-summary"><b>' + rows.length + '</b> named patient result' + (rows.length === 1 ? '' : 's') + ' passed the same-row CPT and facility gate.</div>';
    html += '<div class="mls-occ-select"><button type="button" id="mlsOccAll" class="mls-study-btn ghost">Select all</button><button type="button" id="mlsOccNone" class="mls-study-btn ghost">Clear all</button></div><div class="mls-occ-list">';
    rows.forEach(function (r, i) {
      html += '<label class="mls-occ-row"><input type="checkbox" class="mls-occ-check" data-i="' + i + '"><span class="mls-occ-name">' + esc(r.name) + '<small>' + esc(r.dob || 'DOB unreadable') + '</small></span><span class="mls-occ-evidence">' + occurrenceEvidence(r, snap.spec) + '</span><span class="mls-occ-state" id="mlsOccState' + i + '">Ready</span></label>';
    });
    html += '</div><label class="mls-occ-confirm"><input type="checkbox" id="mlsOccConfirm"> I reviewed the exact CPT/facility evidence for <b id="mlsOccCount">0 of ' + rows.length + ' selected</b> and want to pull only that selection into MLS.</label><div class="mls-study-actions"><button type="button" id="mlsOccPull" class="mls-study-btn" disabled>Pull 0 selected into MLS</button><button type="button" id="mlsOccRetry" class="mls-study-btn ghost" style="display:none">Retry failed only</button></div><div id="mlsOccBatch" aria-live="polite"></div>';
    status(panel, html); wireResultActions(panel, snap);
  }
  function selectedIndexes(panel) { return Array.prototype.map.call(panel.querySelectorAll('.mls-occ-check:checked'), function (n) { return parseInt(n.getAttribute('data-i'), 10); }).filter(function (i) { return i >= 0; }); }
  function wireResultActions(panel, snap) {
    var all = panel.querySelector('#mlsOccAll'), none = panel.querySelector('#mlsOccNone'), confirm = panel.querySelector('#mlsOccConfirm'), pull = panel.querySelector('#mlsOccPull'), retry = panel.querySelector('#mlsOccRetry');
    function enable(resetConsent) { var n = selectedIndexes(panel).length, count = panel.querySelector('#mlsOccCount'); if (resetConsent && confirm) confirm.checked = false; if (count) count.textContent = n + ' of ' + snap.candidates.length + ' selected'; if (pull) { pull.textContent = 'Pull ' + n + ' selected into MLS'; pull.disabled = !(confirm && confirm.checked && n); } }
    if (all) all.addEventListener('click', function () { panel.querySelectorAll('.mls-occ-check').forEach(function (n) { n.checked = true; }); enable(true); });
    if (none) none.addEventListener('click', function () { panel.querySelectorAll('.mls-occ-check').forEach(function (n) { n.checked = false; }); enable(true); });
    panel.querySelectorAll('.mls-occ-check').forEach(function (n) { n.addEventListener('change', function () { enable(true); }); });
    if (confirm) confirm.addEventListener('change', function () { enable(false); });
    if (pull) pull.addEventListener('click', function () { runImport(panel, snap, selectedIndexes(panel), false); });
    if (retry) retry.addEventListener('click', function () { var failed = Object.keys(snap.statuses).filter(function (k) { return snap.statuses[k].code === 'failed'; }).map(function (k) { return parseInt(k, 10); }); runImport(panel, snap, failed, true); });
  }
  function patients() { try { return typeof window.getPatients === 'function' ? (window.getPatients() || []) : []; } catch (e) { return []; } }
  function paintRow(panel, i, label, cls) { var n = panel.querySelector('#mlsOccState' + i); if (n) { n.textContent = label; n.className = 'mls-occ-state ' + (cls || ''); } }
  function importOne(row, snap, say, stillAuthorized, ownerToken) {
    var fn = window.__mlsVerifiedCandidateImport;
    if (typeof fn !== 'function') return Promise.resolve({ code: 'failed', label: 'Failed', reason: 'canonical candidate importer unavailable' });
    /* Report text/claim evidence stops at this local panel.  The canonical
       chart importer receives only the closed identity + display-independent
       procedure/date fields needed to open a fresh exact-patient chart. */
    var candidate={name:clean(row&&row.name),dob:clean(row&&row.dob),patientId:clean(row&&row.patientId),svc:clean(row&&row.svc),codes:uniq(row&&row.codes)};
    try{Object.freeze(candidate.codes);Object.freeze(candidate);}catch(e0){}
    return Promise.resolve(fn(candidate, snap.spec.label, { onStatus: say || function () {}, isCurrent: stillAuthorized, athenaOwnerToken:ownerToken||'' })).then(function (r) {
      var code = r && r.code;
      if (!/^(?:imported|already|failed|review)$/.test(code)) code = r && r.status === 'review' ? 'review' : 'failed';
      return { code: code, label: code === 'imported' ? 'Imported' : (code === 'already' ? 'Already present' : (code === 'review' ? 'Needs identity review' : 'Failed')), reason: r && r.reason || '' };
    }, function () { return { code: 'failed', label: 'Failed', reason: 'canonical candidate import failed' }; });
  }
  function runImport(panel, snap, indexes, retryOnly) {
    if (api && !ownsInstall()) return Promise.resolve({ started: false, reason: 'stale-owner' });
    if (!livePanel(panel) || snapshot !== snap) return Promise.resolve({ started: false, reason: 'stale-panel' });
    indexes = (indexes || []).filter(function (i, p, a) { return i >= 0 && i < snap.candidates.length && a.indexOf(i) === p; }).slice(0, MAX_RESULTS);
    var batch = panel.querySelector('#mlsOccBatch');
    if (!indexes.length) { if (batch) batch.innerHTML = '<div class="mls-occ-warn">Select at least one patient. Nothing was pulled.</div>'; return Promise.resolve({ started: false, reason: 'zero-selected' }); }
    var run = makeRun('import', panel); if (!run) { if (batch) batch.innerHTML = '<div class="mls-occ-warn">Another Athena task is still finishing. Wait for it before retrying.</div>'; return; } run.epoch = epoch;
    if (!claimAthena(run, 'p1-occurrence-patient-pull', Math.min(420000, indexes.length * 105000 + 5000))) { finishRun(run); if (batch) batch.innerHTML = '<div class="mls-occ-warn">Another Athena read or schedule pull is active. Nothing started; retry after it finishes.</div>'; return Promise.resolve({ started: false, reason: 'busy' }); }
    var resolveDone; var donePromise = new Promise(function(resolve){ resolveDone = resolve; });
    setBusy(panel, true); var pos = 0;
    if (batch) batch.textContent = (retryOnly ? 'Retrying' : 'Pulling') + ' 0 / ' + indexes.length + '...';
    function step() {
      if (!current(run)) return;
      if (!livePanel(panel) || snapshot !== snap) run.cancelled = true;
      if (run.cancelled || pos >= indexes.length) {
        if (run.cancelled) for (var z = pos; z < indexes.length; z++) { var zi = indexes[z]; snap.statuses[zi] = { code: 'failed', label: 'Failed', reason: 'cancelled before pull' }; paintRow(panel, zi, 'Failed', 'bad'); }
        var verdict = batchVerdict(snap.candidates.length, indexes, snap.statuses, snap.receipt, run.cancelled);
        releaseAthena(run); finishRun(run); setBusy(panel, false);
        if (batch && livePanel(panel)) batch.innerHTML = '<div class="' + (verdict.selectedComplete ? 'mls-occ-ok' : 'mls-occ-warn') + '">' + (verdict.selectedComplete ? 'Selected pull finished safely.' : 'Selected pull incomplete: ' + esc(verdict.reason) + '.') + (verdict.complete ? ' Full query coverage is verified.' : ' This does not claim complete query coverage.') + ' Imported ' + verdict.counts.imported + ' &middot; Already present ' + verdict.counts.already + ' &middot; Failed ' + verdict.counts.failed + ' &middot; Needs identity review ' + verdict.counts.review + '.</div>';
        var remainingFailed = Object.keys(snap.statuses).some(function (k) { return snap.statuses[k] && snap.statuses[k].code === 'failed'; });
        var retry = panel.querySelector('#mlsOccRetry'); if (retry) retry.style.display = remainingFailed ? '' : 'none';
        if (resolveDone) resolveDone({ started: true, verdict: verdict });
        return;
      }
      var idx = indexes[pos], row = snap.candidates[idx]; paintRow(panel, idx, 'Checking...', 'wait');
      importOne(row, snap, function (m) { if (current(run) && !run.cancelled && batch && livePanel(panel)) batch.textContent = clean(m) + ' (' + (pos + 1) + '/' + indexes.length + ')'; }, function () { return current(run) && !run.cancelled && livePanel(panel) && snapshot === snap; },run.bridgeToken).then(function (res) {
        if (!current(run)) return;
        snap.statuses[idx] = res; paintRow(panel, idx, res.label, res.code === 'imported' || res.code === 'already' ? 'ok' : (res.code === 'review' ? 'warn' : 'bad'));
        pos++; if (batch && livePanel(panel)) batch.textContent = 'Pulled ' + pos + ' / ' + indexes.length + '...'; setTimeout(step, 80);
      });
    }
    awaitAthena(run).then(function (ok) {
      if (!current(run)) { releaseAthena(run); return; }
      if (run.cancelled || !livePanel(panel) || snapshot !== snap || run.epoch !== epoch) { releaseAthena(run); finishRun(run); setBusy(panel, false); if(resolveDone)resolveDone({started:false,reason:'cancelled-before-read'}); return; }
      if (!ok) { releaseAthena(run); finishRun(run); setBusy(panel, false); if (batch && livePanel(panel)) batch.innerHTML='<div class="mls-occ-warn">Another MLS tab owns the Athena reader. Nothing started; retry after it finishes.</div>'; if(resolveDone)resolveDone({started:false,reason:'other-tab'}); return; }
      step();
    });
    return donePromise;
  }
  function runSearch(panel) {
    if (api && !ownsInstall()) return;
    var query = panel.querySelector('#mlsOccQuery'), facility = panel.querySelector('#mlsOccFacility'), spec = parseQuery(query && query.value, facility && facility.value), out = panel.querySelector('#mlsOccOut');
    if (!spec.codes.length) { if (out) out.innerHTML = '<div class="mls-occ-warn">Enter one exact CPT/HCPCS code. Keywords never substitute for an exact supplied code.</div>'; return; }
    if (!spec.facility.name || spec.facility.resolved !== true) { if (out) out.innerHTML = '<div class="mls-occ-warn">Choose a supported exact facility alias. SCCC resolves to POSM ASC Chester County (department 744); SCCC Hospital stays separate.</div>'; return; }
    var run = makeRun('search', panel); if (!run) { if (out) out.innerHTML = '<div class="mls-occ-warn">The previous Athena request is still draining. Wait before starting another.</div>'; return; } run.epoch = epoch;
    if (!claimAthena(run, 'p1-occurrence-report', 365000)) { finishRun(run); if (out) out.innerHTML = '<div class="mls-occ-warn">Another Athena read or schedule pull is active. Nothing started; retry after it finishes.</div>'; return; }
    /* A newly accepted search owns the visible question now. Do not retain the
       previous named cohort invisibly while the replacement reads or fails. */
    snapshot = null;
    setBusy(panel, true); status(panel, resolvedLine(spec) + '<div class="mls-occ-warn">Before this click, keep Athena Revenue &amp; Usage report 268 open with Post Date = Show All and Service Date = Show All. MLS can fill the exact CPT and click Run, but this frozen extension cannot navigate to that report or set those Show All controls.</div><div class="mls-occ-summary" id="mlsOccProgress">Starting the read-only search...</div>');
    function say(m) { if (current(run) && !run.cancelled && livePanel(panel)) { var n = panel.querySelector('#mlsOccProgress'); if (n) n.textContent = clean(m); } }
    var params = { reportId: '268', reportName: 'Revenue and Usage', postDateMode: 'all', serviceDateMode: 'all', cpt: spec.codes, procedureName: '', departmentId: spec.facility.departmentId, facilityName: spec.facility.name, readOnly: true };
    var cfg = { maxPages: MAX_PAGES, cptFieldLabels: ['procedure code(s)', 'procedure code', 'cpt', 'hcpcs'], dateFromLabels: ['service date from'], dateToLabels: ['service date to'], runLabels: ['run report', 'run', 'view report', 'search'] };
    awaitAthena(run).then(function (lockOk) {
      if (!current(run)) { releaseAthena(run); return; }
      if (run.cancelled || !livePanel(panel) || run.epoch !== epoch) { releaseAthena(run); finishRun(run); setBusy(panel, false); return; }
      if (!lockOk) { releaseAthena(run); finishRun(run); setBusy(panel, false); if (livePanel(panel)) status(panel,'<div class="mls-occ-warn">Another MLS tab owns the Athena reader. Nothing started; retry after it finishes.</div>'); return; }
    bridgeSearch(params, cfg, say, function () { return current(run) && !run.cancelled && livePanel(panel) && run.epoch === epoch; }, run).then(function (resp) {
      if (!current(run)) { releaseAthena(run); return; }
      var wasCancelled = run.cancelled; releaseAthena(run); finishRun(run); setBusy(panel, false);
      if (wasCancelled || !livePanel(panel)) { if (livePanel(panel)) status(panel, '<div class="mls-occ-warn">Search canceled. No result was accepted or stored.</div>'); return; }
      var parsed = parseRows(resp.text || ''), matches = filterRows(parsed, spec), candidates = dedupeForDisplay(matches).slice(0, MAX_RESULTS), receipt = retrievalReceipt(resp);
      if (dedupeForDisplay(matches).length > MAX_RESULTS) receipt = { complete: false, partial: true, truncated: true, pages: receipt.pages, chars: receipt.chars, reason: 'local-result-limit' };
      snapshot = { id: run.id, epoch: run.epoch, spec: spec, candidates: candidates, receipt: receipt, statuses: {} }; renderResults(panel, snapshot);
    }).catch(function (err) {
      if (!current(run)) { releaseAthena(run); return; } var wasCancelled = run.cancelled; releaseAthena(run); finishRun(run); setBusy(panel, false);
      if (livePanel(panel)) status(panel, '<div class="mls-occ-warn">' + (wasCancelled ? 'Search canceled. No result was accepted or stored.' : ('Search failed: ' + esc(err && err.message || 'unknown error'))) + '</div>');
    });
    });
  }
  function updateResolution(panel) {
    if (api && !ownsInstall()) return;
    var q = panel.querySelector('#mlsOccQuery'), f = panel.querySelector('#mlsOccFacility'), spec = parseQuery(q && q.value, f && f.value), n = panel.querySelector('#mlsOccResolved');
    if (!n) return; n.innerHTML = spec.facility.name ? ('Will match exact facility: <b>' + esc(spec.facility.name) + '</b>' + (spec.facility.departmentId ? (' (Athena department ' + esc(spec.facility.departmentId) + ')') : '') + (spec.codes.length ? (' &middot; exact CPT ' + esc(spec.codes.join(', '))) : '')) : 'Type a facility; SCCC resolves to the exact surgery-center department.';
    if (snapshot) { snapshot = null; status(panel, '<div class="mls-occ-warn">The question or facility changed. Prior results and confirmation were cleared; run the exact search again.</div>'); }
    if (lease && lease.kind === 'search') cancelRun();
  }
  function injectCss() {
    if (document.getElementById('mlsOccCss')) return; var s = document.createElement('style'); s.id = 'mlsOccCss';
    s.textContent = '#mlsOccPanel{border:1px solid #b9d7c8;background:#f7fcf9;border-radius:12px;padding:12px;margin:0 0 12px}.mls-occ-head{font-weight:750;font-size:13.5px;margin-bottom:5px}.mls-occ-grid{display:grid;grid-template-columns:1.5fr 1fr;gap:9px}.mls-occ-resolved,#mlsOccResolved{font-size:11.5px;color:#3f6a55;margin:7px 0}.mls-occ-warn{background:#fff7ec;border:1px solid #efc687;color:#744b12;border-radius:8px;padding:8px 10px;margin:7px 0}.mls-occ-ok{background:#eaf8f0;border:1px solid #b9dec9;color:#176b43;border-radius:8px;padding:8px 10px;margin:7px 0}.mls-occ-summary{font-weight:650;margin:8px 0}.mls-occ-select{display:flex;gap:7px;margin:8px 0}.mls-occ-list{max-height:270px;overflow:auto}.mls-occ-row{display:grid;grid-template-columns:auto minmax(120px,.75fr) minmax(190px,1.5fr) auto;gap:8px;align-items:start;border:1px solid #e1ebe5;border-radius:8px;padding:7px;margin:5px 0;background:#fff}.mls-occ-name{font-weight:650}.mls-occ-name small{display:block;font-weight:500;color:#66766d}.mls-occ-evidence{font-size:11px;color:#5b6b64;display:grid;gap:3px}.mls-occ-occ{display:block}.mls-occ-state{font-size:11px;font-weight:700}.mls-occ-state.ok{color:#16734a}.mls-occ-state.warn{color:#a35d08}.mls-occ-state.bad{color:#b42318}.mls-occ-confirm{display:flex;gap:8px;align-items:flex-start;font-size:11.5px;margin:10px 0}.mls-occ-empty{padding:12px;color:#66766d}@media(max-width:650px){.mls-occ-grid{grid-template-columns:1fr}.mls-occ-row{grid-template-columns:auto 1fr}.mls-occ-evidence,.mls-occ-state{grid-column:2}}';
    (document.head || document.documentElement).appendChild(s);
  }
  function ownsInstall() { return window.__mlsAthenaOccurrence === api && api && api.installed === true && api.installToken === INSTALL_TOKEN && window.__mlsP1AthenaOccurrenceLoader === loader && loader.installed === true; }
  function mount() {
    if (api && !ownsInstall()) return;
    if (document.getElementById(PANEL_ID)) return;
    var anchor = document.getElementById('mlsStudyBAuto'); if (!anchor) return;
    var section = anchor.closest ? anchor.closest('.mls-study-sec') : null; if (!section || !section.parentNode) return;
    injectCss(); var p = document.createElement('div'); p.id = PANEL_ID; p.__mlsOccEpoch = epoch;
    p.innerHTML = '<div class="mls-occ-head">Exact Athena procedure + facility search <span class="mls-study-badge live">read-only</span></div><p class="mls-study-help"><b>First open Athena Reports &gt; Report Library &gt; Revenue and Usage (268), set Post Date and Service Date to Show All, and leave that report open.</b> MLS fills the exact CPT and clicks Run; it cannot navigate or set those Show All controls. The facility is gated locally on each separate claim occurrence because the frozen extension cannot set Athena\'s facility control. Search results stay local until you explicitly Pull; selected patients then use normal MLS chart import and storage.</p><div class="mls-occ-grid"><div><label class="mls-study-lab" for="mlsOccQuery">Question</label><input id="mlsOccQuery" class="mls-study-in" placeholder="Who had MILD procedure CPT 62330, all done at SCCC?" /></div><div><label class="mls-study-lab" for="mlsOccFacility">Facility (optional if named in question)</label><input id="mlsOccFacility" class="mls-study-in" placeholder="SCCC" /></div></div><div id="mlsOccResolved">SCCC resolves to POSM ASC Chester County, Athena department 744.</div><div class="mls-study-actions"><button type="button" id="mlsOccSearch" class="mls-study-btn">Fill exact CPT and run open report</button><button type="button" id="mlsOccCancel" class="mls-study-btn ghost" style="display:none" disabled>Cancel</button></div><div id="mlsOccOut" aria-live="polite" aria-atomic="true"></div>';
    section.parentNode.insertBefore(p, section); p.querySelector('#mlsOccSearch').addEventListener('click', function () { runSearch(p); }); p.querySelector('#mlsOccCancel').addEventListener('click', function () { if (cancelRun()) { var n = p.querySelector('#mlsOccProgress'); if (n) n.textContent = 'Canceling safely after the current read...'; } }); p.querySelector('#mlsOccQuery').addEventListener('input', function () { updateResolution(p); }); p.querySelector('#mlsOccFacility').addEventListener('input', function () { updateResolution(p); });
  }
  function sessionBoundary() {
    if (api && !ownsInstall()) return;
    epoch++; cancelRun(); snapshot = null;
    try { var p = document.getElementById(PANEL_ID); if (p) p.remove(); } catch (e) {}
    setTimeout(function () { try { if (ownsInstall()) mount(); } catch (e2) {} }, 0);
  }
  function studyLifecycle(event) {
    if (api && !ownsInstall()) return;
    epoch++; cancelRun(); snapshot = null;
    try { var p = document.getElementById(PANEL_ID); if (p) p.remove(); } catch (e) {}
    var reason = ''; try { reason = String(event && event.detail && event.detail.reason || ''); } catch (e2) {}
    if (reason === 'render') setTimeout(function () { try { if (ownsInstall()) mount(); } catch (e3) {} }, 0);
  }
  function overlaySweep() {
    if (api && !ownsInstall()) return;
    var overlay = null, panel = null; try { overlay = document.getElementById('mlsStudyOv'); panel = document.getElementById(PANEL_ID); } catch (e) {}
    if (!overlay && (panel || snapshot || lease)) { epoch++; cancelRun(); snapshot = null; if (panel) try { panel.remove(); } catch (e2) {} return; }
    if (ownsInstall()) mount();
  }
  function boot() { if (api && !ownsInstall()) return; try { mount(); boundaryHandler = sessionBoundary; studyHandler = studyLifecycle; window.addEventListener('mls:session-boundary', boundaryHandler, true); window.addEventListener('mls:study-lifecycle', studyHandler, true); } catch (e) {} }
  function revert() { if (window.__mlsAthenaOccurrence !== api || api.installToken !== INSTALL_TOKEN) return false; try { cancelRun(); epoch++; if (boundaryHandler) window.removeEventListener('mls:session-boundary', boundaryHandler, true); if (studyHandler) window.removeEventListener('mls:study-lifecycle', studyHandler, true); var p = document.getElementById(PANEL_ID); if (p) p.remove(); var c = document.getElementById('mlsOccCss'); if (c) c.remove(); } catch (e) {} api.installed = false; snapshot = null; return true; }
  function debugState() { return { epoch: epoch, hasSnapshot: !!snapshot, candidateCount: snapshot && snapshot.candidates ? snapshot.candidates.length : 0, lease: lease ? { id: lease.id, kind: lease.kind, cancelled: !!lease.cancelled, settled: !!lease.settled } : null }; }
  function liveMutation(fn, staleValue) { return function () { if (!ownsInstall()) return staleValue; return fn.apply(null, arguments); }; }
  var api = { installed: true, version: VERSION, installToken: loader.installToken, mount: liveMutation(mount, false), cancel: liveMutation(cancelRun, false), revert: revert,
    _sessionBoundary: liveMutation(sessionBoundary, false), _studyLifecycle: liveMutation(studyLifecycle, false), _updateResolution: liveMutation(updateResolution, false),
    _parseQuery: parseQuery, _resolveFacility: resolveFacility, _parseRows: parseRows, _filterRows: filterRows,
    _dedupeForDisplay: dedupeForDisplay, _retrievalReceipt: retrievalReceipt, _identityDecision: identityDecision,
    _batchVerdict: batchVerdict, _chartReceiptComplete: chartReceiptComplete, _makeRun: liveMutation(makeRun, null),
    _finishRun: liveMutation(finishRun, false), _currentRun: current, _bridgeSearch: liveMutation(bridgeSearch, Promise.resolve(null)), _wireResultActions: liveMutation(wireResultActions, false),
    _renderResults: liveMutation(function(panel,snap){snapshot=snap;renderResults(panel,snap);}, false),
    _runImport: liveMutation(function(panel,snap,indexes,retryOnly){snapshot=snap;return runImport(panel,snap,indexes,retryOnly);}, Promise.resolve({started:false,reason:'stale-owner'})),
    _runSearch: liveMutation(runSearch, false), _snapshot: function(){return ownsInstall()?snapshot:null;}, _setSnapshot: liveMutation(function(v){snapshot=v||null;return snapshot;}, null), _debugState: function(){return ownsInstall()?debugState():{stale:true};} };
  window.__mlsAthenaOccurrence = api;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
})();
