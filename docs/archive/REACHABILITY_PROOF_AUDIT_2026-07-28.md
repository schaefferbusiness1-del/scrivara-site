# Reachability proofs — which suites can certify a defect

**22 of 38** suites that claim a control is reachable prove it by **matching source text**
rather than by exercising the shipped resolver. Those proofs cannot fail while the literal is
present, regardless of whether the control renders.

This is not hypothetical. It has already happened once, and the suite that did it existed
specifically to prevent the defect it certified.

---

## The confirmed case

`tests/shell-hidden-controls-keep-reach.test.js` exempts a hidden wrapper because
`#mlsDsVisitBodies` **"is offered as 'Full visit notes'"**, and proves *offered* like this:

```js
const TOOLS = /\{\s*id:\s*'([^']+)'/g;
while ((m = TOOLS.exec(shell))) offered.add(m[1]);
```

It regex-extracts id literals out of the shell **source** into a set, then checks membership.
The spec literal was always present. The Tools row was **always absent** — `toolsResolve`
rejected it one line before `spec.as` was read, because `textOf` finds no text on a bare
`<input type=checkbox>` whose label lives on the wrapper.

So the control had **zero reach** under the Calm Shell — hidden in the strip, absent from
Tools — while a passing suite asserted the opposite. Fixed in b760.

**The category:** *a receipt that measures the wrong thing is worse than no receipt, because
it converts absence of evidence into evidence of absence.* Three instances now:

| receipt | measured | should have measured |
|---|---|---|
| `shell-hidden-controls-keep-reach` | the spec literal exists in source | the row resolves at runtime |
| the pull census (pre-b752) | a carried-forward allergy | a field freshly read this pass |
| the walk-count verdict | patients navigated to | characters actually written to the store |

---

## Method, and its own control

For every suite whose claim is *reachability* — offered / available / keeps reach / not
stranded / in the menu — classify by whether it ever **executes** shipped code (`vm`,
`new Function`, jsdom) or only **reads** it.

**The control is mandatory.** The first version of this sweep pattern-matched idioms
(`.includes`, `.indexOf`, assert-adjacent regex), missed the confirmed case entirely because
it used `regex.exec()` in a while-loop, and reported 86 suites from a blind instrument. The
current version asserts that `shell-hidden-controls-keep-reach` appears in the SOURCE-TEXT
list, and refuses its own output if it does not.

Script: `scratchpad/reachability-claim-table.js`.

---

## Result

| | count |
|---|---|
| BEHAVIOURAL — executes the shipped resolver | 9 |
| **SOURCE-TEXT — matches shipped source** | **22** |
| fixture-only — reads no shipped artefact | 7 |

### The three that map onto items counted as FIXED

These share the confirmed failure's exact shape — **named is not resolved**:

- **`visit-focus-keeps-every-route`** — passes with *"19 hide rules, 19 named routes, 0 inline
  hides"*. It counts routes **named in source**. A named route that never resolves at runtime
  passes, which is exactly how the Tools row died.
- **`calendar-list-keeps-its-exit`** — the owner-reported navigation trap. Proven textually.
- **`voice-cluster-expands-never-decides`** / **`visit-voice-one-expands-never-decides`** —
  *"routes preserved"*, *"9 real controls behind them"*, both counted from source.

### Four are mine, written during this effort

`b749-incomplete-fixes-finished`, `phone-dock-fits-and-targets-reach-44`,
`record-verb-names-the-patient-once`, `live-measured-occlusion-regressions`.

The phone one names itself *"targets reach 44px"* and proves it by matching CSS text. Its
geometry **was** separately measured live at real viewports (320 / 347 / 360), and its header
says it pins the contract — but the name overclaims relative to the method. Listed here rather
than exempted.

---

## What this does NOT say

Source-text pinning is legitimate and this repo uses it deliberately — encoding lanes, pinned
literals, the cache-token triplet, staging parity. Those are claims **about the source**, and
matching source is the correct proof for them.

The problem is narrower: a claim about **runtime reachability**, proved by source text. Only
those can certify a defect. This is a screening result. Each of the 22 needs reading before
being called wrong.

**The real unit is the assertion, not the suite.** `shell-hidden-controls-keep-reach` is
textual throughout, but a mixed suite could execute most things and prove the critical one by
regex — and this sweep would clear it. A per-assertion audit is the deeper version and is not
done.

---

## Consequence for "verified"

Any item whose verified status traces to one of the 22 is not verified. It is **claimed by a
proof that cannot fail**, which is worse than unverified because it has been counted as done.
`HONEST_STATE_2026-07-28.md` carries this as its own category.
