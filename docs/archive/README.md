# Archive

Historical handoff notes, worker reports and audits from earlier work lanes
(July–September 2026). They were moved out of the repository root on
2026-09-22 because no code, test, script or skill references them. They are
kept for context only and describe past states of the app, not the current one.

`scripts/` holds one-shot release helpers (`*-splice.js`, `sweep-*`,
`restamp-*`) from past MLS Assist trains. Each one patched a specific build
once and is not meant to run again; nothing references them. The newest pin
sweep, `scripts/sweep-30113.js`, stays in `scripts/` as the template for the
next release. Helpers that tests still read also stay in `scripts/`.
