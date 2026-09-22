/* axr-1.0 (3.0.52 candidate) - the CLINCMP/ax-native encounter reader.
 * STATUS: COMPLETE DRAFT, not yet spliced. Splice + gate + ship in the next
 * train. Anchors marked VERIFY below must be count-checked against the live
 * background.js before running (the srr splices moved offsets).
 *
 * EVIDENCE BASIS (honest scope): James's briefing census (shadow-root nav,
 * one /ax/encounter/<id>/summary anchor, REFRESH CHART present, self-recycle
 * only under hot exam-prep context) + 4 chartSurface-tagged ax successes.
 * The multi-chart census DID NOT accumulate (sampler watched the wrong tab -
 * 61 sightings all my dashboard). Therefore: THE READER IS ITS OWN CENSUS -
 * every ax read records the surface signatures it saw into receipt diags,
 * and identity detection is a feature-detected PROBE LIST that fails closed
 * with the observed signature when nothing matches. A refusal teaches the
 * next probe shape; a guess could read the wrong patient. Never a guess.
 *
 * DESIGN (full contract in tests/live-e2e-artifacts/2026-08-08-ax-native-reader-design.md):
 *
 * 1. NEW INJECTED OP 'axHarvest' (joins the op family in the visits injected fn):
 *    - shadow-aware walk (copy the srr-1.2 collector shape: 2 levels, bounded 900)
 *    - collect anchors matching /\/(\d+)\/\d+\/ax\/encounter\/(\d+)\/(\w+)/
 *    - return { ok:true, encounters:[{eid, route, hrefPath}], surfaceSig:
 *      { route: location.pathname masked, testids: sorted top-20, shadowN } }
 *
 * 2. NEW INJECTED OP 'axSummaryRead' (runs INSIDE the navigated summary frame):
 *    - identity probe LIST, feature-detected in order:
 *      a. [data-testid="patient-header"], [data-testid*="patient-banner"]
 *      b. header/nav element whose text matches /^[A-Z][a-z]+.*\d{2}\/\d{2}\/\d{4}/
 *         (name + DOB line - the ax header shape seen on the briefing)
 *      c. any element with aria-label containing patient name tokens
 *      Each probe returns {name, dob?, mrn?}; NO probe matching returns
 *      { ok:false, reason:'ax-identity-not-found', surfaceSig } - FAIL CLOSED.
 *    - body capture: visibility-aware innerText discipline (hc-1.0 shape),
 *      shadow-walked, 90k cap.
 *    - return { ok, identity, raw, surfaceSig }
 *
 * 3. ENGINE PATH (background.js, inside the visits read, AFTER the classic walk
 *    would return no-chart-frame-candidate AND after the srr-1.2 re-expand
 *    also failed):  VERIFY anchor: the `gate = { ok:false, reason:
 *    'no-chart-frame-candidate' }` post-loop region.
 *    - exec axHarvest over chart frames; accept the candidate frame whose
 *      harvest returns encounters.length > 0.
 *    - per encounter (bounded by the same maxVisits/budget admission):
 *      * navigate THAT frame to the summary hrefPath (engine-owned, in-lease)
 *      * bounded settle; exec axSummaryRead
 *      * visitIdentityGate(frozenHint, axIdentity) - THE SAME GATE; mismatch
 *        -> refuse the encounter, count, continue (fail-closed per encounter)
 *      * visit = { date/type from header line, raw, source:'athena-copy',
 *        binding:{ rowKey:'enc:'+eid, encounterId:eid, index:i }, ... }
 *    - receipt: chartSurface:'clincmp-ax-route', axEncounters:N, axRefused:N,
 *      axSigs:[surfaceSig x brief], and the tally contract UNCHANGED
 *      (visits.length === clinicalTotal where clinicalTotal = encounters kept).
 *    - REFUSAL TAXONOMY (supervisor 2026-08-09, set BEFORE the first ax run so
 *      defensive refusals are never misread as regression): unknown-shape
 *      refusals get their OWN named reason 'ax-identity-shape-unknown' with
 *      the observed signature attached - distinct from no-chart-frame-candidate,
 *      in-use, and every classic reason. Day summaries report them as a
 *      SEPARATE line: "N read, M refused (unknown ax shape - signatures
 *      captured)", never folded into failures. Early refusals ARE the corpus
 *      filling; the number falls build over build as probe shapes are added -
 *      a high first number is the mechanism working, and the report says so.
 *    - timing: stamp axRouteMs per chart beside stageMs for the side-by-side.
 *
 * 4. TESTS (tests/ax-native-reader.test.js):
 *    - source pins: op registration, probe-list order, fail-closed reason,
 *      SAME visitIdentityGate call, enc: rowKey form, receipt fields, the
 *      trigger ORDER (classic walk -> re-expand -> ax route, never before).
 *    - functional vm: href regex against fixture anchors (id extraction,
 *      practice-id masking, non-encounter hrefs rejected); probe-list runner
 *      against three fixture header shapes + a no-match arm asserting the
 *      fail-closed return.
 *    - control arm: strip the ax block -> pins fail (>=6).
 *
 * 5. RELEASE: manifest 3.0.52 + digest + zip + sweep (clone sweep-3051 pattern:
 *    3.0.51->3.0.52, new sha, chk3052 rotation, notes) + gate + bump + push +
 *    serve x2 + install (SAME folder) + devReload + RELOAD MY WORK TAB (the
 *    orphaned-content-script trap) + pong + live acceptance on whichever
 *    rotating-membership charts the day rolls.
 *
 * ACCEPTANCE: a day where the stm.esp lottery charts read to content-verified
 * via the ax route, with per-chart axRouteMs beside classic stageMs, and the
 * classic path byte-untouched on classic charts. */
console.log('axr-1.0 draft - see header; do not run');
