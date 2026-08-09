# The ax-native reader (3.0.52 candidate) — design from evidence, not guesses

**Why it exists (the night's converging evidence):** the residual July-1 class is the
classic stm.esp empty-frame lottery with ROTATING membership (~3-4 charts/day; one
re-expand helps, does not close it). Meanwhile chartSurface's first live distribution
showed **4/18 charts reading CLEAN on clincmp-ax (≥22% of one roster)** with sr=0 —
the ax route never enters the lottery and never recycles outside exam-prep context.
The CLINCMP rollout only moves one way. The ax reader is therefore BOTH the cure for
the residual class and the pace play (no click, no slideout wait, no settle race,
no recycle exposure between click and read).

**Evidence corpus (build against this, never one chart):**
- `localStorage.__pxAxCensus` on the athena work tab — passive 2s-cadence sampler
  running through the whole July month resume; signature-deduped sightings carrying
  route forms, encounter-anchor counts, testid sets, node counts; SELF-TIMING
  (cost.ticks / msTotal / msMax) so the month's pace dataset carries a stated
  instrument overhead. Harvest at month end.
- James's briefing census (2026-08-08): /ax/briefing/<pid> hosts the SPA; nav behind
  shadow roots (3-5, shallow); ONE /ax/encounter/<id>/summary anchor on the briefing
  (most-recent encounter, id in href); "REFRESH CHART" control exists in the walked
  set; the surface self-recycles ~25-30s ONLY while the exam-prep/appointment context
  is hot (frame ages 3s/11s across 95s), and settles once the context idles (529s+).
- Monday/July-1 chartSurface rows: the ax-read charts saved through the EXISTING
  pipeline unchanged — the classic reader already works when athena routes ax and the
  visits panel renders; the reader below is for when it does NOT.

**Contract (same gates, cleaner transport):**
1. TRIGGER: after the classic walk exhausts (would return no-chart-frame-candidate)
   OR when the accepted surface is ax with an empty/absent visits panel.
2. HARVEST: shadow-aware anchor walk (reuse the srr-1.2 collector shape) across chart
   frames for `/(\d+)/\d+/ax/encounter/(\d+)/(summary|\w+)` — encounter ids from
   hrefs, zero clicking. If the briefing shows only the latest encounter, the
   encounters LIST route (census will name it — watch for /ax/encounters/<pid> or a
   list container testid) supplies the full set; do NOT ship until the census shows
   the list form on ≥3 distinct charts.
3. READ per encounter: navigate the SAME frame the anchor lived in (frame-local
   location, engine-owned tab, one encounter at a time) to the summary route; wait
   bounded; identity-verify ON THE LOADED SUMMARY via the SAME visitIdentityGate
   (patient header in the ax page — census will name its testids); FAIL CLOSED on
   mismatch, count refusals per chart. A cleaner contract is not a weaker gate.
4. BIND: encounter id from the URL is the rowKey (`enc:<id>` — the strong form the
   classic binder already prefers); date/type from the summary header; body from the
   summary content (shadow-walked innerText discipline, visibility-aware capture as
   in hc-1.0).
5. RECEIPTS: chartSurface='clincmp-ax-route'; per-encounter ops; the tally contract
   (visits.length === clinicalTotal) unchanged; administrative rows honest as ever.
6. TIMING: per-chart wall time recorded next to the classic path's — the ax-vs-classic
   side-by-side the supervisor asked for, in the same run wherever a day has both.

**Safety notes:** navigation is engine-owned (inside the read lease, work tab only);
never navigate while another engine op is mid-flight on the tab; the four-layer
sign/order/billing block untouched; PHI stays in-tab (ids are athena-internal).

**Test plan:** source pins + control arms (run the OLD code against the NEW test);
functional vm harness for the href-parse + rowKey binding; live acceptance = the
rotating-membership charts (whichever 3-4 the day rolls) reading to ✓ on a day that
previously starved them, with the classic path untouched on classic charts.
