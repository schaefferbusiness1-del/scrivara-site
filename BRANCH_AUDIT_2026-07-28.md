# Branch audit — 2026-07-28

Fourteen worker branches plus the perf branch, audited for **content** rather than commit
counts. Answer: **merge none of them.** Thirteen are empty relative to HEAD, and the
fourteenth would move the product backwards.

Do not repeat this audit. Do not merge `worker-a-ui`.

---

## Method — and the three tools that got it wrong first

This matters more than the result, because three separate instruments produced confident
wrong answers on this repo **in a single day**:

| tool | what it said | what was true |
|---|---|---|
| grep for marker strings | `HEAD:0  perfbranch:0` | the strings existed in **neither** branch; read as "absent from HEAD" |
| `git diff HEAD...branch` | would report the perf branch as **975 lines** | real delta was **2 lines** — three-dot diffs merge-base..branch, so rebased content still shows |
| `git merge-tree` | "changed in both", **zero** conflict markers | the real merge produced **3 conflicts** |

**Exactly one instrument was right three times out of three:**

> Merge the branch into a **throwaway detached worktree** and read the **staged diff against
> HEAD** (`git merge --no-commit`, `git add -A`, `git diff --cached --stat HEAD`).

That answers the actual question — *what would applying this branch change about my tree* —
rather than *what did this branch change since it forked*, which is a different question and
the one that produced the 975-line phantom. The live repo is never touched; the lane is
removed afterwards.

Script: `scratchpad/audit-worker-branches.sh` (session scratch, reproducible).

---

## Result

| branch | files | +lines | conflicts | verdict |
|---|---|---|---|---|
| **worker-a-ui** | 2 | 28 | 2 | **REAL CONTENT — do not merge, see below** |
| worker-d-visit | 0 | 0 | 0 | empty — already in HEAD |
| worker-d2-advworkspace | 0 | 0 | 0 | empty |
| worker-e-views | 0 | 0 | 0 | empty |
| worker-e2-studio | 0 | 0 | 0 | empty |
| worker-e3-studio | 0 | 0 | 0 | empty |
| worker-f-theme | 0 | 0 | 0 | empty |
| worker-f2-motion | 0 | 0 | 0 | empty |
| worker-f3-motion | 0 | 0 | 0 | empty |
| worker-g-voice | 0 | 0 | 0 | empty |
| worker-g2-voice | 0 | 0 | 0 | empty |
| worker-h-polish | 0 | 0 | 0 | empty |
| worker-i-parse | 0 | 0 | 0 | empty |
| worker-j-ext322 | 0 | 0 | 0 | empty |

`perf/workspace-hydration-20260727` was audited separately by the same method: 9 commits
"behind", real delta **`mls-connect.js | 4 ++--`**. Content already rebased into HEAD as
`002585f`…`3a28fe6`; only the pointer was never fast-forwarded. Two commits sharing the
subject *"perf: skip hidden workspace renders during hydration"* with different SHAs is the
signature.

---

## Why `worker-a-ui` must NOT be merged

Its four commits are real work:

    ui: secondary text becomes a theme token, not four hard-coded greys
    ui: a section heading stops announcing itself as its own toolbar
    public pages: the two text colours that actually fail AA
    ui: the blue-grey secondary label family meets AA too

**That work is already in HEAD**, and the evidence is gate output rather than inspection —
a measurement from a passing suite, not a reading of source:

- `PASS secondary text is a theme token: 4 retired greys absent from 263 app files, light
  --muted #636E66 agrees across both declarations and clears AA on all 8 app surfaces
  (worst 4.75:1)`
- `PASS headings do not swallow their controls: 45 <h2> blocks scanned, 22 heading(s) with
  controls carry an explicit accessible name, 0 unguarded`

What actually differs is **stale, and worse than what ships today**:

| | HEAD | worker-a-ui |
|---|---|---|
| `.auth-card` border-radius | `22px` | `20px` — predates the 4-token radius scale |
| admin refresh buttons | "Refresh users", "Refresh billing", "Refresh codes", "Refresh backups", "Refresh team data" | **"Refresh" ×4** and "Refresh data" |

Merging it would collapse five distinctly-labelled admin buttons into five reading
"Refresh" — the general form of the owner's *"WHY IS THERE 2 GENERATE NITES HERE"*, and
exactly the class `tests/live-standing-ui-sweeps.js` was written to detect. A merge here
manufactures the defect the sweep exists to catch.

---

## Branch pointers are deliberately NOT deleted

They cost nothing where they are, and deletion is the only irreversible action in this
audit. Cleanup is a quiet-day job. This file exists so the next person neither repeats the
audit nor merges `worker-a-ui` on the reasonable-looking assumption that four AA commits
must be worth having.
