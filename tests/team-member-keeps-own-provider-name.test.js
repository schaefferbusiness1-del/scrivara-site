'use strict';
/* A team member keeps their own Provider name (teamname-1.0.0, 2026-09-25).

   R3 of the Settings rebuild spec. /api/me returns `practice` built from the
   PRACTICE HEAD's preferences for a team member (the backend's practiceId() is
   the head's id when head_id is set), and marks provider_source 'preference'
   whenever the head set a Provider name. refreshMe() wrote that provider_name
   into the team member's own uns('providerName') on EVERY sign-in, and that
   name signs the member's notes and scopes the member's Athena pulls.

   Pinned here:
   - a team member who signs their own notes (role doctor or user with a
     head_id, the roles suIsProvider() counts) is never given the head's
     Provider name by /api/me; the member's own name, set in Settings on this
     computer or held in the member's own account copy, survives sign-in;
   - a practice name the server INVENTS when none is set ("<login name>
     Practice", "Medical practice"; name_source 'none') is never stored as if
     the doctor had typed it; a 'provider-derived' name (from the Provider name
     the doctor set) is stored as before.
   Guards (behaviour that must NOT change, green before and after):
   - a nurse and a front-desk login keep the head's Provider name exactly as
     before, fresh or not (their Athena pulls are scoped by it, and a nurse's
     documents carry it); a lawyer is seeded as before too;
   - a solo doctor and a practice head still get their own provider
     preference, and the login-account fallback still never seeds it;
   - the head's practice-level fields still reach a team member;
   - a sign-in posts nothing to the account copy (settings sync is untouched).

   Runs the REAL refreshMe(), the REAL settings sync block and the REAL
   loadPrefsFromServer() from every shell (the two /1p twins and the derived
   production shell) in a vm, with fetch answering /api/me and /api/prefs (the
   member's own account copy). Nothing leaves the process.

   Every check runs and reports; a failure list is printed at the end. A check
   tagged [fix] pins the teamname-1.0.0 change and is RED on the build before
   it; a check tagged [guard] pins behaviour that stays exactly as it was. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html'];
const tally = { fix: 0, guard: 0, fixFailed: 0, guardFailed: 0 };
const failures = [];
function record(kind, pass, m) {
  tally[kind]++;
  if (!pass) { tally[kind + 'Failed']++; failures.push(`[${kind}] ${m}`); }
}
function fixEq(a, b, m) { record('fix', a === b, `${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); }
function guardEq(a, b, m) { record('guard', a === b, `${m} (expected ${JSON.stringify(b)}, got ${JSON.stringify(a)})`); }

function slice(src, start, end, name) {
  const a = src.indexOf(start);
  if (a < 0) throw new Error(`${name}: ${start} not found`);
  const b = src.indexOf(end, a);
  if (b <= a) throw new Error(`${name}: ${end} not found after ${start}`);
  return src.slice(a, b);
}

function memoryStorage(seed) {
  const m = new Map(Object.entries(seed || {}));
  return {
    getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: (k) => { m.delete(String(k)); },
    key: (i) => Array.from(m.keys())[i] || null,
    get length() { return m.size; }
  };
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };

function context(source, name, me, localStorage, account, fetched, posts, syncCalls) {
  const ctx = {
    console, Promise, setTimeout, clearTimeout, JSON, Object, Array, String, Number, Error, AbortController,
    localStorage,
    window: {},
    document: { getElementById() { return null; } },
    session: null, bkUser: null, currentView: 'patients', sfSessionUiAccount: '',
    backendMode: () => true, bkToken: () => 'tok', bkBase: () => 'http://127.0.0.1:9',
    getSessionEmail: () => (ctx.session && ctx.session.email) || '',
    setSessionEmail: () => {},
    sfNormalizeSessionAccount: (e) => String(e || '').trim().toLowerCase(),
    uns: (k) => `sf_u::${(ctx.session && ctx.session.email) || '_'}::${k}`,
    sfStartupValid: () => true, sfNoteGateTrouble() {}, sfGateResponseTrouble() {}, handle401() {},
    sfRouteIncompatibleSetupAccount: () => false, sfP1ReleaseMarketingIdentity() {},
    sfResetSessionBoundary() {}, applyAccessUI() {}, sfAwaitStartupHydrationQuiet: async () => true,
    loadPatientsFromServer: async () => false, loadRecordsFromServer: async () => false,
    handleAccountSetupRequired: async () => {}, _studioMergeFromCloud: () => false,
    STUDIO_CLOUD_BUDGET: 250000, _studioCloudPlan: (arr) => ({ list: arr }),
    CustomEvent: typeof CustomEvent === 'function' ? CustomEvent : function () {},
    dispatchEvent() { return true; }, addEventListener() {}, removeEventListener() {},
    __mlsDraftTuning: { cloudLoad: async () => ({ ok: true, legacy: false }), cloudSync: async () => ({ ok: true, legacy: false }) },
    toast() {},
    applyAppearance() {}, renderDocPrefs() {}, updateNavCounts() {}, renderPatients() {}, renderProfile() {}, renderHistory() {},
    fetch: async (url, init) => {
      fetched.push(String(url));
      if (/\/api\/prefs$/.test(String(url))) {
        if (init && init.method === 'POST') {
          const body = JSON.parse(init.body).prefs;
          posts.push(body);
          account.copy = body;
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: true, status: 200, json: async () => (account.copy ? { prefs: JSON.parse(JSON.stringify(account.copy)) } : {}) };
      }
      if (!/\/api\/me$/.test(String(url))) throw new Error(`${name}: refreshMe fetched ${url}`);
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(me)) };
    }
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx, { filename: `${name}-refreshMe.js` });
  /* a sign-in must not sync: every call is counted, none is run */
  ctx.syncPrefsToServer = (o) => { syncCalls.push(o || null); return Promise.resolve(false); };
  return ctx;
}

/* one computer signing in. seed: this computer's own values for the account;
   opt.ownCopy: the account's own copy on the server; opt.again: sign in once
   more on the same computer (a reload or the next sign-in without a purge). */
async function signIn(source, name, me, seed, opt) {
  opt = opt || {};
  const EMAIL = me.user.email;
  const ns = (k) => `sf_u::${EMAIL}::${k}`;
  const localStorage = memoryStorage({});
  Object.keys(seed || {}).forEach((k) => { localStorage.setItem(ns(k), seed[k]); });
  const account = { copy: opt.ownCopy === undefined ? null : JSON.parse(JSON.stringify(opt.ownCopy)) };
  const fetched = [], posts = [], syncCalls = [];
  const ctx = context(source, name, me, localStorage, account, fetched, posts, syncCalls);
  let result = await ctx.refreshMe({});
  await settle();
  if (opt.again) { result = (await ctx.refreshMe({})) && result; await settle(); }
  const out = {};
  ['providerName', 'practiceName', 'clinicPhone', 'clinicAddress', 'acctTz', 'npi'].forEach((k) => { out[k] = localStorage.getItem(ns(k)); });
  return { result, stored: out, posts, syncCalls, account, loaded: fetched.some((u) => /\/api\/prefs$/.test(u)), ctx };
}

const HEAD_PRACTICE = {
  name: 'Chester County Spine Care', name_source: 'preference',
  provider_name: 'Dr Head Of Practice', provider_source: 'preference',
  phone: '610-555-0100', address: '1 Practice Way', google_business_url: 'https://g.page/r/example-practice',
  timezone: 'America/New_York'
};
/* the practice fields a sign-in seeds, already in a member's own account copy */
const PRACTICE_COPY = { practiceName: 'Chester County Spine Care', clinicPhone: '610-555-0100', clinicAddress: '1 Practice Way', googleBusinessUrl: 'https://g.page/r/example-practice' };
const headInCopy = Object.assign({}, PRACTICE_COPY, { providerName: 'Dr Head Of Practice', npi: '1234567893' });

(async () => {
  for (const name of SHELLS) {
    const src = fs.readFileSync(path.join(ROOT, name), 'utf8');
    const source = slice(src, 'var _refreshMeInFlight=null', '/* 401 from the backend', name) + '\n' +
      slice(src, 'const PREF_SYNC_KEYS=', 'async function loadPrefsFromServer(opts){', name) + '\n' +
      slice(src, 'async function loadPrefsFromServer(opts){', '/* b940 -> qol-2.0', name);
    const noSync = (r, who) => guardEq(r.posts.length + r.syncCalls.length, 0, `${name}: ${who}'s sign-in pushed to the account copy`);
    const signedIn = (r, who) => guardEq(r.result === true && r.loaded, true, `${name}: ${who}'s synthetic sign-in did not complete and load the account copy`);

    /* 0. The role table: exactly the team members who sign their own notes. */
    {
      const probe = await signIn(source, name, { user: { email: 'probe@example.test', role: 'head', head_id: null }, practice: {} }, {});
      const fn = probe.ctx.sfTeamMemberSignsOwnNotes;
      fixEq(typeof fn, 'function', `${name}: sfTeamMemberSignsOwnNotes is missing`);
      const table = [
        [{ role: 'doctor', head_id: 7 }, true], [{ role: 'user', head_id: 7 }, true], [{ role: 'Doctor', head_id: '7' }, true],
        [{ head_id: 7 }, true],
        [{ role: 'nurse', head_id: 7 }, false], [{ role: 'receptionist', head_id: 7 }, false], [{ role: 'lawyer', head_id: 7 }, false],
        [{ role: 'doctor', head_id: null }, false], [{ role: 'head', head_id: null }, false], [null, false]
      ];
      table.forEach(([u, want]) => {
        let got; try { got = typeof fn === 'function' ? fn(u) : undefined; } catch (e) { got = 'threw ' + e.message; }
        fixEq(got, want, `${name}: sfTeamMemberSignsOwnNotes(${JSON.stringify(u)})`);
      });
    }

    /* 1. A team member who set their own Provider name in Settings keeps it
          at the next sign-in and the one after (no purge in between). */
    const member = { user: { email: 'member@example.test', role: 'doctor', head_id: 7 }, practice: HEAD_PRACTICE };
    let r = await signIn(source, name, member, { providerName: 'Dr Team Member' }, { ownCopy: Object.assign({}, PRACTICE_COPY, { providerName: 'Dr Team Member' }), again: true });
    signedIn(r, 'a team doctor');
    fixEq(r.stored.providerName, 'Dr Team Member',
      `${name}: a team member's own Provider name, set in Settings, was replaced by the practice head's on sign-in`);
    /* the shared practice's own fields still arrive for a team member */
    guardEq(r.stored.practiceName, 'Chester County Spine Care', `${name}: a team member lost the practice name the head set`);
    guardEq(r.stored.clinicPhone, '610-555-0100', `${name}: a team member lost the practice phone`);
    guardEq(r.stored.clinicAddress, '1 Practice Way', `${name}: a team member lost the practice address`);
    noSync(r, 'a team doctor');
    /* the same, set on this computer only (the account copy has none yet) */
    r = await signIn(source, name, member, { providerName: 'Dr Team Member' });
    fixEq(r.stored.providerName, 'Dr Team Member', `${name}: a team member's own Provider name on this computer was replaced by the practice head's`);

    /* 2. A team member with NO Provider name yet is not given the head's. */
    r = await signIn(source, name, member, {});
    fixEq(r.stored.providerName, null,
      `${name}: a team member with no Provider name was given the practice head's; it would sign the member's notes`);
    noSync(r, 'a fresh team doctor');
    /* role 'user' signs its own notes too */
    const teamUser = { user: { email: 'user.member@example.test', role: 'user', head_id: 7 }, practice: HEAD_PRACTICE };
    r = await signIn(source, name, teamUser, {});
    fixEq(r.stored.providerName, null, `${name}: a team member with role "user" was given the practice head's Provider name`);
    r = await signIn(source, name, teamUser, { providerName: 'Dr Team User' });
    fixEq(r.stored.providerName, 'Dr Team User', `${name}: a team member with role "user" lost their own Provider name to the head's`);

    /* 3. A member's own name in their own account copy comes back on a
          purged (fresh) computer, beside the other signing fields. */
    r = await signIn(source, name, member, {}, { ownCopy: Object.assign({}, PRACTICE_COPY, { providerName: 'Dr Own Name', npi: '1234567893' }) });
    fixEq(r.stored.providerName, 'Dr Own Name', `${name}: a member's own Provider name did not come back from the member's account copy on a fresh computer`);
    guardEq(r.stored.npi, '1234567893', `${name}: the load lost another signing field (npi)`);
    noSync(r, 'a team doctor on a fresh computer');
    r = await signIn(source, name, teamUser, {}, { ownCopy: { providerName: 'Dr Own User' } });
    fixEq(r.stored.providerName, 'Dr Own User', `${name}: a role "user" member's own Provider name did not come back from the account copy`);
    /* a member whose copy already holds the head's name gets exactly that back,
       as before: nothing is cleared, nothing is pushed */
    r = await signIn(source, name, member, {}, { ownCopy: headInCopy });
    guardEq(r.stored.providerName, 'Dr Head Of Practice', `${name}: the account copy's Provider name did not come back`);
    noSync(r, 'a team doctor whose copy holds the head\'s name');
    r = await signIn(source, name, member, { providerName: 'Dr Head Of Practice' }, { ownCopy: headInCopy });
    guardEq(r.stored.providerName, 'Dr Head Of Practice', `${name}: a Provider name this computer holds (the head's) was cleared`);

    /* 4. A solo doctor and a practice head still get their own provider
          preference; the login-account fallback never seeds it. */
    const solo = { user: { email: 'solo@example.test', role: 'doctor', head_id: null }, practice: Object.assign({}, HEAD_PRACTICE, { provider_name: 'Dr Solo Doctor' }) };
    r = await signIn(source, name, solo, {});
    signedIn(r, 'a solo doctor');
    guardEq(r.stored.providerName, 'Dr Solo Doctor', `${name}: a solo doctor's own provider preference no longer seeds providerName`);
    noSync(r, 'a solo doctor');
    r = await signIn(source, name, solo, { providerName: 'Dr Old Solo Name' });
    guardEq(r.stored.providerName, 'Dr Solo Doctor', `${name}: a solo doctor's account preference no longer seeds over this computer's value, as before`);
    const head = { user: { email: 'head@example.test', role: 'head', head_id: null }, practice: HEAD_PRACTICE };
    r = await signIn(source, name, head, {});
    guardEq(r.stored.providerName, 'Dr Head Of Practice', `${name}: a practice head's own provider preference no longer seeds providerName`);
    r = await signIn(source, name, { user: solo.user, practice: Object.assign({}, HEAD_PRACTICE, { provider_name: 'Login Name', provider_source: 'account-fallback' }) }, {});
    guardEq(r.stored.providerName, null, `${name}: the login-account fallback seeded the clinical provider identity`);

    /* 5. A NURSE keeps the old seeding exactly: the head's Provider name
          scopes their Athena pulls and heads their documents. */
    const nurse = { user: { email: 'nurse@example.test', role: 'nurse', head_id: 7 }, practice: HEAD_PRACTICE };
    r = await signIn(source, name, nurse, {});
    signedIn(r, 'a nurse');
    guardEq(r.stored.providerName, 'Dr Head Of Practice', `${name}: a fresh nurse sign-in no longer seeds the head's Provider name`);
    noSync(r, 'a nurse');
    r = await signIn(source, name, nurse, {}, { ownCopy: Object.assign({}, PRACTICE_COPY, { providerName: 'Dr Somebody Else' }) });
    guardEq(r.stored.providerName, 'Dr Head Of Practice', `${name}: a nurse's Provider name no longer follows the head's over the account copy, as before`);
    r = await signIn(source, name, nurse, { providerName: 'Nurse Own Entry' });
    guardEq(r.stored.providerName, 'Dr Head Of Practice', `${name}: a nurse sign-in no longer seeds the head's name over a local value, as before`);

    /* 6. A FRONT-DESK login: the same, fresh or not. */
    const desk = { user: { email: 'desk@example.test', role: 'receptionist', head_id: 7 }, practice: HEAD_PRACTICE };
    r = await signIn(source, name, desk, {});
    guardEq(r.stored.providerName, 'Dr Head Of Practice', `${name}: a fresh front-desk sign-in no longer seeds the head's Provider name`);
    noSync(r, 'a front-desk login');
    r = await signIn(source, name, desk, { providerName: 'Desk Own Entry' });
    guardEq(r.stored.providerName, 'Dr Head Of Practice', `${name}: a front-desk sign-in no longer seeds the head's name over a local value, as before`);

    /* 7. A LAWYER is seeded as before. */
    const lawyer = { user: { email: 'lawyer@example.test', role: 'lawyer', head_id: 7 }, practice: HEAD_PRACTICE };
    r = await signIn(source, name, lawyer, {});
    guardEq(r.stored.providerName, 'Dr Head Of Practice', `${name}: a lawyer sign-in no longer behaves as before (the head's preference seeded)`);
    noSync(r, 'a lawyer');
    r = await signIn(source, name, lawyer, { providerName: 'Lawyer Own Entry' });
    guardEq(r.stored.providerName, 'Dr Head Of Practice', `${name}: a lawyer sign-in no longer seeds the head's name over a local value, as before`);

    /* 8. An invented practice name is never stored; a provider-derived one
          and one from a server that does not send name_source are, as before. */
    const unset = {
      user: { email: 'fresh@example.test', role: 'head', head_id: null },
      practice: { name: 'Login Name Practice', name_source: 'none', provider_name: 'Login Name', provider_source: 'account-fallback',
        phone: '', address: '', google_business_url: '', timezone: 'America/New_York' }
    };
    r = await signIn(source, name, unset, {});
    fixEq(r.stored.practiceName, null, `${name}: the server's invented practice name was stored as the doctor's`);
    guardEq(r.stored.acctTz, 'America/New_York', `${name}: the account time zone stopped arriving`);
    noSync(r, 'an unconfigured account');
    r = await signIn(source, name, { user: unset.user, practice: Object.assign({}, unset.practice, { name: 'Medical practice', provider_name: '', provider_source: 'none' }) }, {});
    fixEq(r.stored.practiceName, null, `${name}: "Medical practice" (no name set) was stored as the practice name`);
    /* a doctor's own local value is left alone by an invented one */
    r = await signIn(source, name, unset, { practiceName: 'My Own Clinic' });
    fixEq(r.stored.practiceName, 'My Own Clinic', `${name}: an invented practice name overwrote the doctor's own`);
    /* and on a fresh computer the account copy's own practice name comes back */
    r = await signIn(source, name, unset, {}, { ownCopy: { practiceName: 'Own Copy Clinic' } });
    fixEq(r.stored.practiceName, 'Own Copy Clinic', `${name}: an invented practice name kept the account copy's own practice name from coming back`);
    /* the same for a team member whose head never named the practice */
    r = await signIn(source, name, { user: member.user, practice: Object.assign({}, HEAD_PRACTICE, { name: 'Synthetic Head Login Practice', name_source: 'none', provider_name: 'Synthetic Head Login', provider_source: 'account-fallback' }) }, {});
    fixEq(r.stored.practiceName, null, `${name}: a team member was given the invented practice name of an unconfigured head`);
    /* 'provider-derived' comes from the Provider name the doctor set;
       handouts and letterheads show it (the server's own display name does too) */
    const derived = { name: 'Dr Solo Doctor Practice', name_source: 'provider-derived', provider_name: 'Dr Solo Doctor', provider_source: 'preference' };
    r = await signIn(source, name, { user: unset.user, practice: Object.assign({}, unset.practice, derived) }, {});
    guardEq(r.stored.practiceName, 'Dr Solo Doctor Practice', `${name}: a provider-derived practice name was dropped; documents fall back to "MLS"`);
    r = await signIn(source, name, { user: nurse.user, practice: Object.assign({}, HEAD_PRACTICE, { name: 'Dr Head Of Practice Practice', name_source: 'provider-derived' }) }, {});
    guardEq(r.stored.practiceName, 'Dr Head Of Practice Practice', `${name}: a nurse lost the head's provider-derived practice name`);
    r = await signIn(source, name, { user: member.user, practice: Object.assign({}, HEAD_PRACTICE, { name: 'Dr Head Of Practice Practice', name_source: 'provider-derived' }) }, {});
    guardEq(r.stored.practiceName, 'Dr Head Of Practice Practice', `${name}: a team member lost the head's provider-derived practice name`);
    const older = Object.assign({}, HEAD_PRACTICE, { name: 'Older Server Clinic' }); delete older.name_source;
    r = await signIn(source, name, { user: solo.user, practice: older }, {});
    guardEq(r.stored.practiceName, 'Older Server Clinic', `${name}: a practice name from a server that sends no name_source was dropped`);
  }

  const summary = `fix checks ${tally.fix} (failed ${tally.fixFailed}), guard checks ${tally.guard} (failed ${tally.guardFailed})`;
  if (failures.length) {
    failures.forEach((f) => console.log('FAIL ' + f));
    console.log(`FAIL team member keeps own provider name: ${failures.length} of ${tally.fix + tally.guard} checks failed; ${summary}`);
    process.exit(1);
  }
  console.log(`PASS team member keeps own provider name: ${tally.fix + tally.guard} checks over ${SHELLS.length} shells (${summary}) - a team member who signs their own notes (role doctor or user with a head_id) is never given the practice head's Provider name at sign-in, and the member's own name, set in Settings or held in the member's account copy, survives; a nurse, the front desk and a lawyer keep the head's name exactly as before; a solo doctor's and a head's own preference still seed it; an invented practice name (name_source 'none') is never stored, a provider-derived one is; and a sign-in posts nothing to the account copy`);
})().catch((e) => { console.error(e); process.exit(1); });
