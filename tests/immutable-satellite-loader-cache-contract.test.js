'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const staging = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');

/* Every entry below changed after its previous immutable URL shipped. A
 * versioned service-worker request is cache-first, so reusing the old token
 * would deterministically replay stale code for an existing clinician. */
const assets = [
  /* feat_athena_doctor.js left this list on 2026-08-06. Its loader no longer
     carries a hand-maintained token at all — it uses the __MLS_AV form, so
     there is nothing here to pin. It was removed the way the entry below for
     feat_mls_redesign.js was ALMOST removed, and for a related reason: the
     token last moved at b430 (2026-07-19) while the module changed at b770 and
     b803, so any browser holding a cache entry under that URL would have been
     replaying b430 code. Scope that honestly — a live QA pass on 2026-08-06
     fetched this frozen URL through the owner's service worker and compared it
     to a cache-busted origin fetch: 37,499 bytes, byte-identical. HIS browser
     was not stale. The exposure was real, this instance of it did not fire.
     tests/cache-token-cannot-go-stale.test.js could not have caught it either
     way — the last edit predates that suite's b844 seed, so the asset was
     skipped as untouched, which is what every seed advance quietly buys. A
     literal token is only as good as the human bumping it; this one now
     follows the build number and cannot go stale again. */
  ['feat_athena_tooltip_dedupe.js', '20260726ui125', '20260725ui124'],
  ['feat_b18_qa.js', '20260726b18v10', '20260719b18v9'],
  ['feat_copilot_slim.js', '20260719csp211', '20260716csp210'],
  ['feat_mls_asst_fix.js', '20260802asst145', '20260719asst143'],
  ['feat_mls_b121_pack.js', '20260728p2c6', '20260728p2c5'],
  ['feat_mls_calbox_uniform.js', '20260727cb110', '20260625cb1c1'],
  ['feat_mls_checker.js', '20260806chk3045', '20260803chk3044'],
  ['feat_mls_pull_device_picker.js', '20260729pdp110', '20260717pdp100'],
  ['feat_mls_caldedupe_render.js', '20260727dd110', '20260629dd1c1'],
  ['feat_mls_force_full_phone.js', '20260719ffp200', '20260630c1'],
  ['feat_mls_header_exact.js', '20260802hx303', '20260716hx301'],
  ['feat_mls_loading_calm.js', '20260719lb204', '20260719lb203'],
  ['feat_mls_provider_passthrough.js', '20260722pp1c5', '20260702pp1c1'],
  ['feat_mls_recentpts.js', '20260727rp210', '20260722rp3'],
  /* Bumped, not reshaped: two suites pin this asset to a LITERAL token, and the
     service worker serves versioned assets cache-first. It had drifted - the
     file changed three times after '20260728rd328' while the token stood still,
     so a returning browser kept the cached copy. Caught by
     tests/cache-token-cannot-go-stale.test.js. */
  ['feat_mls_redesign.js', '20260804rd331', '20260802rd330'],
  ['feat_mls_simple_exact.js', '20260719simx142', '20260716simx141'],
  ['feat_mls_study_calm.js', '20260802sg2f', '20260713sg2d'],
  ['feat_mls_wb_console.js', '20260802wbc132', '20260630wbc1c1-B177'],
    /* 2026-08-06: the deck's empty state was #C9DCD2 on white (~1.4:1) and
     effectively invisible; it now follows --muted. The service worker serves
     this cache-first, so the token must move or a returning clinician keeps
     the unreadable copy. */
  ['feat_mls_widget_deck.js', '20260806wd112', '20260802wd111'],
  ['feat_mls_widgetinsert.js', '20260802wi4', '20260624wi2c1'],
  ['feat_mls_topbar_unify.js', '20260722tb111', '20260719tb109'],
  ['feat_mls_command_palette.js', '20260724cmd104', '20260719cmd103'],
  ['feat_mls_copilot_request_safety.js', '20260802crs121', '20260718crs111'],
  ['feat_mls_copilot_dock_fix.js', '20260726cdf210', '20260716cdf200'],
  ['feat_mls_dictate_anywhere.js', '20260719da111h1', "s.src='feat_mls_dictate_anywhere.js?v='+(window.__MLS_AV||Date.now())"],
  ['feat_mls_pervisit_unify.js', '20260725pvu1c2', '20260629pvu1c1'],
  ['feat_mls_progress_stages.js', '20260722ps131', "s.src='feat_mls_progress_stages.js?v='+(window.__MLS_AV||Date.now())"],
  ['feat_task3_frontsync.js', '20260727t3110', '20260727t3109'],
  /* 2026-08-05, unr-1.1.0 -> unr-1.1.1: the module's boot() poll re-ran its
     three installers 60 times while each guarded only on its own window marker,
     so a co-wrapper that did not carry that marker forward made the poll
     re-point a module-level orig the first wrapper still read at call time.
     Measured with the real modules and the polls replayed: _calLoadNextUp and
     _renderTodayPatients each reached their base 0 times (RangeError) in one
     load order — the Up-Next hero and today's patient list froze silently.
     Same class as b870's renderProfile cycle. The token MUST move or a
     returning browser keeps the cycling copy cache-first. Pinned by
     tests/wrapper-chains-reach-their-base.test.js. */
  ['feat_mls_upnow_realtime.js', '20260805unr111', '20260723unr110'],
  /* 2026-08-06: feat_visits.js LEAVES this table. It gained the history identity
     binding and immediately went stale against '20260729vis11' — the third
     hand-maintained token to go stale in one evening, each hiding a fix from
     returning browsers. It now rides the shared build-number cache-buster, which
     follows the build and cannot go stale, so there is no per-release token for
     this table to police. Its guarantees are not dropped: the assertion below
     pins the FORM and keeps BOTH retired tokens unreachable. */
  /* 2026-08-05 adversarial-review repairs: all three copilot/avatar satellites
     changed after their b871/b872 immutable URLs shipped — the receipts-append
     signature, the coverage source, fail-open setup form, mutate-before-save
     import, and the still-loading guard. Retired tokens must be unreachable. */
  /* 2026-08-05 round-2 enhancements (cpw-1.2.0 avatarCheckins in the snapshot;
     av-1.2.0 ready-cache + interview preview + copy-summary): both files
     changed after their b873 URLs shipped. */
  /* 2026-08-05 round 4: cpw-1.3.0 appControl registry (Copilot's whitelisted
     hands on the app's own safe openers); av-1.3.1 deferred-load boot fix
     (the Visit card now mounts at login, not only after a view switch) +
     the tone setting. */
  ['feat_mls_copilot_power.js', '20260805cpw130', '20260805cpw120'],
  /* 2026-08-05 round 5 (av-2.0.0, owner UX order): the Visit card moves to the
     TOP of the visit view with inline bullets + Add-to-visit-transcript, and
     Setup gains a real per-question editor. */
  /* 2026-08-05 av-3.0.0 (owner rounds 6.5+7): the OFFICE kiosk — full-screen
     patient-facing interview on the doctor's machine with emotion states —
     plus the talking Setup preview. av201 (b882) retired. */
  /* 2026-08-05 av-4.0.0 (owner: "awful, requires send — rethink"): the speak
     engine defeats Chrome's utterance GC (held refs + duration watchdog), mic
     preflight happens up front, and the kiosk becomes a hands-free loop with
     a silence nudge and stall recovery — it can never dead-end into typing. */
  /* 2026-08-05 av-5.0.0 (owner: "speech is aweful... the aveitor isnt made...
     no facial expretions"): the natural backend voice (OpenAI TTS proxy) with
     amplitude lip-sync, a drawn SVG character with real expressions (blink,
     gaze, brows, mouth), portrait tinting, and true requestFullscreen. */
  /* 2026-08-06 av-5.1.0 (owner round 10): the patient buttons are GONE (the
     conversation is the interface), End interview gates behind a server-
     verified exit PIN, and the face can be the doctor's stylized photo.
     av-5.2.0 (round 11, same day): warmer smile, 1.3s quiet threshold,
     silence auto-finish, summary-on-unlock. av510 rode main in b895/b896 and
     may be briefly served when the Pages queue clears — it retires here. */
  /* 2026-08-06 av-5.3.0: the customizable face (colours, hair, glasses, beard,
     derived from the doctor's photo), the retired typed preview, and six
     adversarial-review repairs incl. the fail-OPEN exit gate. */
    /* av-5.3.1: cold-start hardening - a finished interview refuses further
     answers, and the harness rejects the first turn with an HTML 502. */
  /* av-5.4.0: AMBIENT ROOM MODE - the same PIN pad now has a second outcome,
     keep the room microphone open through the consultation and hand the
     doctor one transcript with the check-in and the visit in it.
     av-5.5.0 (2026-08-07, owner: 'have it conform to the picture of the
     person better'): Match applies exactly the knobs the photo answered,
     and reads brow weight, lip fullness, nose width and top colour. */
  ['feat_mls_avatar.js', '20260807av565', '20260807av564'],
  /* feat_mls_copilot_actions.js left this list on 2026-08-06: token ca211 was
     set at 08-05 11:00 and the file changed again at 08-05 14:21 - the commit
     that added `appControl` to the still-loading guard. Same calendar day, so
     cache-token-cannot-go-stale (which compares DATES) was blind and the
     owner's browser kept the 11:00 bytes, where an appControl fired before the
     Power module landed NAVIGATED instead of waiting. The loader now follows
     the build number, so there is no literal left to pin. */
];

assert.strictEqual(new Set(assets.map(entry => entry[1])).size, assets.length,
  'changed immutable satellites must not share a release token');

for (const [asset, token, retired] of assets) {
  assert(connect.includes(asset), `${asset} production loader is missing`);
  assert.strictEqual(connect.split(token).length - 1, 1,
    `${asset} must have exactly one production loader using ${token}`);
  assert(!connect.includes(retired), `${asset} still exposes retired cache token ${retired}`);
}

/* feat_visits.js: the form is the pin now, and both retired tokens stay dead. */
for (const [label, text] of [['production', connect], ['staging', staging]]) {
  assert(text.includes("feat_visits.js?v='+(window.__MLS_AV||Date.now())"),
    label + ': feat_visits must load with the build-number cache-buster');
  assert(!/feat_visits\.js\?v=20\d{6}/.test(text),
    label + ': a hand-maintained feat_visits token came back — it will go stale at the next change');
}

assert(staging.includes('feat_mls_checker.js?v=20260806chk3045'),
  'staging checker loader must use the same corrected immutable URL');
assert(!staging.includes('feat_mls_checker.js?v=20260714chk2922r1'),
  'staging checker loader still exposes the retired immutable URL');
assert(staging.includes('feat_mls_command_palette.js?v=20260724cmd104'),
  'staging must load the same canonical Ctrl/Cmd+K owner as production');

console.log('PASS immutable satellite loaders: ' + assets.length + ' changed assets use fresh, unique cache URLs and retired URLs are unreachable');
