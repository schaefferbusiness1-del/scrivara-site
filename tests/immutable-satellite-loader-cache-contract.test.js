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
  ['feat_b18_qa.js', '20260808b18v14perf2', '20260808b18v13perf1'],
  ['feat_copilot_slim.js', '20260719csp211', '20260716csp210'],
  ['feat_mls_asst_fix.js', '20260802asst145', '20260719asst143'],
  ['feat_mls_assistant_exact.js', '20260808asst220perf1', '20260725asst217'],
  /* feat_mls_b121_pack.js left this list on 2026-08-07 (px train): the pack
     changed (matchRow lost its name-only merge leg - the cross-patient weld)
     and rather than mint 20260807p2c7 for the same date-granularity blindness
     that bit copilot_actions, its loader now follows the build number. The
     build-form + dead-literal assertions live below with feat_visits'. */
  ['feat_mls_calbox_uniform.js', '20260727cb110', '20260625cb1c1'],
  ['feat_mls_checker.js', '20260808chk3056', '20260808chk3055'],
  ['feat_mls_pull_device_picker.js', '20260729pdp110', '20260717pdp100'],
  ['feat_mls_caldedupe_render.js', '20260727dd110', '20260629dd1c1'],
  ['feat_mls_force_full_phone.js', '20260719ffp200', '20260630c1'],
  ['feat_mls_header_exact.js', '20260802hx303', '20260716hx301'],
  ['feat_mls_loading_calm.js', '20260719lb204', '20260719lb203'],
  ['feat_mls_provider_passthrough.js', '20260722pp1c5', '20260702pp1c1'],
  /* Bumped, not reshaped: two suites pin this asset to a LITERAL token, and the
     service worker serves versioned assets cache-first. It had drifted - the
     file changed three times after '20260728rd328' while the token stood still,
     so a returning browser kept the cached copy. Caught by
     tests/cache-token-cannot-go-stale.test.js. */
  ['feat_mls_patientpick.js', '20260808pick162perf1', '20260716pick161'],
  ['feat_mls_study_calm.js', '20260802sg2f', '20260713sg2d'],
  ['feat_mls_strip_day_couple.js', '20260808sdc202perf1', '20260719sdc201'],
  ['feat_mls_wb_console.js', '20260802wbc132', '20260630wbc1c1-B177'],
  ['feat_mls_widgetinsert.js', '20260802wi4', '20260624wi2c1'],
  ['feat_mls_topbar_unify.js', '20260722tb111', '20260719tb109'],
  ['feat_mls_command_palette.js', '20260808cmd106perf2', '20260808cmd105perf1'],
  ['feat_mls_copilot_request_safety.js', '20260802crs121', '20260718crs111'],
  ['feat_mls_copilot_dock_fix.js', '20260726cdf210', '20260716cdf200'],
  ['feat_mls_dictate_anywhere.js', '20260719da111h1', "s.src='feat_mls_dictate_anywhere.js?v='+(window.__MLS_AV||Date.now())"],
  ['feat_mls_pervisit_unify.js', '20260725pvu1c2', '20260629pvu1c1'],
  ['feat_mls_progress_stages.js', '20260722ps131', "s.src='feat_mls_progress_stages.js?v='+(window.__MLS_AV||Date.now())"],
  ['feat_task3_frontsync.js', '20260808t3113perf2', '20260808t3112perf1'],
  ['feat_mls_upnow_activeselect.js', '20260808uas5perf1', '20260804uas4'],
  ['feat_mls_upnow_sync.js', '20260808uns6perf2', '20260808uns5perf1'],
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
  /* feat_mls_avatar.js LEFT THIS LIST on 2026-08-07, at av-5.7.0, for the
     reason recorded under feat_mls_copilot_actions.js below: this file changes
     several times in a single day, and the staleness gate that guards these
     literals compares CALENDAR DATES. av567 and av566 were both set on
     2026-08-07 - the same day av-5.7.0 rewrote the listen loop, the consent
     gate and the photo matcher - so a literal bump is protection that expires
     the moment the next edit lands, which on this file is the same afternoon.
     The loader now follows the build number and there is no literal left to
     pin; the form itself is asserted below, and both retired tokens stay dead. */
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

/* These high-churn performance owners follow the shared build token. That
   makes the cache URL move with every release instead of relying on a second
   hand-maintained version that can drift from the file it serves. */
for (const [label, text] of [['production', connect], ['staging', staging]]) {
  assert(text.includes("var A='feat_athena_tooltip_dedupe.js'") &&
    text.includes("s.src=A+'?v='+(window.__MLS_AV||Date.now())"),
    label + ': tooltip/UI owner must use the shared build cache token');
  assert(!text.includes('20260808ui127perf2') && !text.includes('20260808ui126perf1'),
    label + ': a retired hand-maintained tooltip/UI token is still reachable');
  assert(text.includes("s.src=A+'?v='+(window.__MLS_AV||Date.now())") &&
    text.includes("var A='feat_mls_redesign.js',V='3.2.4'"),
    label + ': redesign must use the shared build cache token with its version-aware loader');
  assert(!text.includes('20260808rd332perf2') && !text.includes('20260804rd331'),
    label + ': a retired hand-maintained redesign token is still reachable');
  assert(text.includes("feat_mls_upnow_realtime.js?v='+(window.__MLS_AV||Date.now())"),
    label + ': UP NOW realtime must follow the build-number cache-buster');
  assert(!text.includes('20260808unr122perf1') && !text.includes('20260805unr111'),
    label + ': a retired UP NOW realtime cache token is still reachable');
  assert(text.includes("var A='feat_mls_datalink_exact.js'") &&
    text.includes("s.src=A+'?v='+(window.__MLS_AV||Date.now())"),
    label + ': event-driven data link must follow the shared build cache token');
  assert(!text.includes('20260727dl2'),
    label + ': retired polling data-link URL is still reachable');
  assert(text.includes('var A="feat_mls_allergy_strip.js"') &&
    text.includes('s.src=A+"?v="+(window.__MLS_AV||Date.now())'),
    label + ': event-driven allergy strip must follow the shared build cache token');
  assert(!text.includes('20260727hcep2'),
    label + ': retired polling allergy-strip URL is still reachable');
  assert(text.includes("var A='feat_mls_simple_exact.js'") &&
    text.includes("s.src=A+'?v='+(window.__MLS_AV||Date.now())"),
    label + ': Simple Visit input fast path must follow the shared build cache token');
  assert(!text.includes('20260719simx142') && !text.includes('20260624simx5'),
    label + ': retired Simple Visit URL is still reachable');
  assert(text.includes("feat_mls_copilot_unify.js?v='+(window.__MLS_AV||Date.now())"),
    label + ': Copilot active-id fast path must follow the shared build cache token');
  assert(!text.includes('20260716unify110'),
    label + ': retired Copilot conversation-owner URL is still reachable');
  assert(text.includes('var A="feat_mls_recentpts.js"') &&
    text.includes('s.src=A+"?v="+(window.__MLS_AV||Date.now())'),
    label + ': exact-event Recent Patients must follow the shared build cache token');
  assert(!text.includes('20260808rp220perf1') && !text.includes('20260727rp210'),
    label + ': retired polling Recent Patients URL is still reachable');
}
assert(connect.includes("feat_mls_store_cache.js?v='+(window.__MLS_AV||Date.now())"),
  'production: exact-key store cache must follow the build-number cache-buster');
assert(!connect.includes('20260808sc14perf1') && !connect.includes('20260806sc13b924'),
  'production: a retired exact-key store cache token is still reachable');
assert(connect.includes("var A='feat_mls_writeback_safety.js'") &&
  connect.includes("s.src=A+'?v='+(window.__MLS_AV||Date.now())"),
  'production: event-driven writeback preview must follow the shared build cache token');
assert(!connect.includes('20260717wbs110-b356'),
  'production: retired polling writeback-safety URL is still reachable');
assert(connect.includes('var A="feat_mls_widget_deck.js"') &&
  connect.includes('s.src=A+"?v="+(window.__MLS_AV||Date.now())'),
  'production: event-driven widget deck must follow the shared build cache token');
assert(!connect.includes('20260806wd112') && !connect.includes('20260802wd111'),
  'production: a retired widget-deck cache token is still reachable');

/* TWO LANES, ONE CURE, 2026-08-07. The px train and the avatar train reached the
   same conclusion about this list independently and on the same afternoon: a
   hand-maintained token cannot protect a file that changes more than once a day,
   because the staleness gate that guards these literals compares CALENDAR DATES.
   Both retirements are kept - they are additive and describe different files. The
   only judgement in this resolution was the checker token, where the px train's
   20260808chk3056 supersedes the base's chk3045. Trial-merged and gated at 512
   before either landed, so this is the resolution as planned, not as improvised. */
/* feat_mls_b121_pack.js: same cure as feat_visits/copilot_actions (px train,
   2026-08-07) - the loader follows the build number; hand tokens stay dead. */
assert(connect.includes("feat_mls_b121_pack.js?v='+(window.__MLS_AV||Date.now())"),
  'production: feat_mls_b121_pack must load with the build-number cache-buster');
assert(!/feat_mls_b121_pack\.js\?v=20\d{6}/.test(connect),
  'production: a hand-maintained feat_mls_b121_pack token came back — it will go stale at the next change');

/* feat_mls_avatar.js, same rule, from av-5.7.0. See the note in the list above:
   this file changes more than once a day, which is exactly the drift a
   date-granular staleness gate cannot see. */
assert(connect.includes("feat_mls_avatar.js?v='+(window.__MLS_AV||Date.now())"),
  'the avatar must load with the build-number cache-buster');
assert(!/feat_mls_avatar\.js\?v=20\d{6}/.test(connect),
  'a hand-maintained avatar token came back — on this file it goes stale the same afternoon');
for (const dead of ['20260807av567', '20260807av566']) {
  assert(!connect.includes(dead), 'retired avatar cache token ' + dead + ' is back in the loader');
}

assert(staging.includes('feat_mls_checker.js?v=20260808chk3056'),
  'staging checker loader must use the same corrected immutable URL');
assert(!staging.includes('feat_mls_checker.js?v=20260714chk2922r1'),
  'staging checker loader still exposes the retired immutable URL');
assert(staging.includes('feat_mls_command_palette.js?v=20260808cmd106perf2'),
  'staging must load the same canonical Ctrl/Cmd+K owner as production');
assert(staging.includes('feat_mls_assistant_exact.js?v=20260808asst220perf1') &&
  !staging.includes('20260725asst217'),
  'staging must use the current assistant asset URL and retire the prior one');
for (const assetUrl of [
  'feat_mls_patientpick.js?v=20260808pick162perf1',
  'feat_mls_upnow_sync.js?v=20260808uns6perf2'
]) {
  assert(staging.includes(assetUrl), 'staging must use the current performance asset URL: ' + assetUrl);
}

console.log('PASS immutable satellite loaders: ' + assets.length + ' changed assets use fresh, unique cache URLs and retired URLs are unreachable');
