# The MLS motion vocabulary

**One vocabulary. If a new surface needs to move, it uses these — it does not pick a number.**

Declared on `:root` in `ScribeFlow.html` and `ScribeFlow-staging.html`, unconditionally, before
the first module runs. Pinned by `tests/motion-tokens-are-page-level-and-cannot-strand.test.js`.

| token | value | use it for |
|---|---|---|
| `--mls-dur-1` | `120ms` | press, hover — anything under the finger |
| `--mls-dur-2` | `200ms` | a state change: a chip turning on, a colour settling |
| `--mls-dur-3` | `300ms` | an entrance: a menu, a fan, a highlight moving between destinations |
| `--mls-dur-4` | `420ms` | a whole panel arriving |
| `--mls-ease-out` | `cubic-bezier(.2,.7,.3,1)` | something **arriving** and staying |
| `--mls-ease-inout` | `cubic-bezier(.4,0,.2,1)` | something **moving in place**, or leaving |
| `--mls-ease-spring` | `cubic-bezier(.2,.9,.3,1.06)` | something **summoned** — overshoots ~1% and settles |

### The legacy four are aliases, not a second set

`feat_mls_calm_shell.js` declares four older names that 23 rules in that file still reference.
They are **aliases** and the gate keeps them that way:

```
--mls-spring : var(--mls-ease-out, cubic-bezier(.32,.72,0,1))
--mls-fast   : var(--mls-dur-2, 180ms)
--mls-base   : var(--mls-dur-3, 260ms)
--mls-slow   : var(--mls-dur-4, 380ms)
```

The old literals survive **only as the `var()` fallback**, so a surface that somehow gets that
stylesheet without the page's `:root` degrades to its previous behaviour rather than to none.
Re-pinning a literal there re-forks the app's timing and the only symptom is that two surfaces
move at slightly different speeds — which is why the gate fails on it.

---

## The laws

(Law 5 — *a declaration is not motion* — is below, with the three ways declared motion dies.)

1. **transform and opacity only.** Nothing else. Boot's TBT here is already dominated by forced
   layout, and an animated `width`/`height`/`top` is a reflow every frame.
2. **Nothing over ~250ms on interaction.** Entrances may go to `--mls-dur-4`.
3. **Every animation must be un-strandable.** No `both` or `backwards` fill on a keyframe that
   starts from `opacity:0`. See below — this has bitten four times.
4. **`prefers-reduced-motion: reduce` kills all of it.** Motion here is decoration; the UI must
   work identically without it.

### Law 3, spelled out, because it keeps happening

```css
/* WRONG — the surface is invisible until the animation runs, and if it never
   runs (occluded tab, cancelled animation, a currentTime:0 freeze) it stays
   invisible, with a green suite and nothing in the console */
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.thing{animation:fadeIn var(--mls-dur-3) var(--mls-ease-out) both}

/* RIGHT — no fill. The to-state IS the resting state, so "never ran" and
   "finished" look identical */
.thing{animation:fadeIn var(--mls-dur-3) var(--mls-ease-out)}
```

Found and fixed by this rule so far: `mlsMdlIn`, `mlsMdlCard`, `mlsMoRise` (b680), `mlsVoIn`
(b686+, in a file the gate could not see), and 13 `mlsRise` uses across six **patient-facing**
pages — `booking.html`, `intake.html`, `patient-portal.html`, `appointment.html`, `phone.html`,
`best-doctors-optout.html`.

---

## What moves today, and on which token

| surface | move | timing |
|---|---|---|
| any button / chip, pressed | `scale(.97)` | `--mls-dur-1` `--mls-ease-out` |
| dock highlight pill | glides between destinations, lands with a settle | `--mls-dur-3` `--mls-ease-spring` |
| dock active icon | 1px lift + 8% scale, same settle | `--mls-dur-3` `--mls-ease-spring` |
| dock itself, on first mount | rise + scale from below | `--mls-slow` `--mls-spring` |
| modal backdrop | fade | `--mls-dur-2` `--mls-ease-out` |
| modal card | 10px lift + `scale(.985)` | `--mls-dur-3` `--mls-ease-out` |
| Copilot drawer | slide from the right **and** fade | `--mls-dur-4` / `--mls-dur-2` `--mls-ease-out` |
| Copilot scrim | fade | `--mls-dur-2` `--mls-ease-out` |
| voice fan (disclosure) | grows from its trigger: `scale(.96)` + 4px, origin `top center` | `--mls-dur-2` `--mls-ease-spring` |
| Tools menu | `mlsPop`, origin `bottom left` | `--mls-base` `--mls-spring` |
| toast, arriving | 14px rise | `--mls-dur-3` `--mls-ease-spring` |
| toast, leaving | quicker fade down | `--mls-dur-2` `--mls-ease-inout`, opacity `--mls-dur-1` |
| right-now bar | rise on summon | `--mls-dur-3` `--mls-ease-spring` |
| stage dot | scale + colour + ring bloom as the stage advances | `--mls-dur-3` `--mls-ease-spring`, colour linear |
| stage connector | fills `scaleX(0→1)` from the left edge | `--mls-dur-4` `--mls-ease-out` |
| Copilot drawer, FIRST open | same slide+fade as every later open | see "a declaration is not motion" |

### The press rule, and its three exclusions

One rule, `scale(.97)`, in the page stylesheet. It carries `!important` because the 31 rules it
replaces live in files four other lanes own. Three surfaces are **deliberately** outside it:

- **`#mlsDock`** — untouchable, and its own `scale(.93)` is tuned for a 64px tap target.
- **`.ez3-big`** — the full-width record hero. `.97` on a 400px control is a 12px lurch; large
  surfaces scale less.
- **typing surfaces** — `input`/`textarea`/`select`/`[contenteditable]` never move under the
  cursor while someone is dictating into them. `[disabled]` is excluded too: a disabled control
  that presses back is lying.

---

## There is no view-switch animation, and that is deliberate

Do not add one. `feat_mls_calm_shell.js` records that b653 shipped one and it was wrong twice:
`showView` writes only `.style.display`, so the rule could never match, **and**
`ScribeFlow.html` records the owner's reverted verdict that *"whole-view fades made every
navigation feel like a screen-level pop."* Re-adding it re-ships a rejected design over a
documented revert.

---

## Law 5 — a declaration is not motion

Added after three defects on 2026-07-26 that were all **correctly declared and could never
run**. Every motion suite was green the whole time, because every motion suite read
declarations. If you add motion, prove it MOVED on the running page — sample
`document.getAnimations()` or the computed value across the change. "The CSS is right" is not
evidence.

The three ways declared motion dies, all found live, all now gated by
`tests/motion-that-cannot-run-is-not-motion.test.js`:

**1. The host rebuilds its children.** A transition needs the SAME element present when the
value changes. `renderStages()` did `el.innerHTML = parts.join('')` on every stage change, so
all nine rail nodes were replaced with their final classes already applied. Measured across a
real Prep→Review move: **0 animations, 0 of 9 nodes surviving.** Build once, then move only
classes and inline transforms — and guard both writes, because this runs on the shell tick and
`classList.add`/`remove` re-commit unconditionally (`toggle(name, force)` does not).

**2. The element is created and classed in one task.** `openCopilotDock()` appended the drawer
and added `.open` in the same synchronous block, so there was no computed starting style.
Measured: **first open 1 distinct position, second open 22.** Every open but the first was
perfect. Force one style read (`void el.offsetWidth`) before the class, gated on first build.
**Never `requestAnimationFrame`** — it does not fire in an occluded tab, so the panel would stay
*shut* rather than merely un-animated. The class must land synchronously so that "never
animated" and "finished" end in the same place.

**3. The rule is trapped in a media query.** The whole motion block sat inside
`@media (max-width:760px)` because the phone query's closing brace was the LAST line of the CSS
array and everything added since had landed above it. Measured through `document.styleSheets`:
**121 of 143 shell rules page-level, 14 trapped, 5 of them motion** — including `mlsMoRise` and
the `.mls-mo` safety prohibition, which therefore protected only phones. Grep cannot see this;
the selectors are built by string concatenation and only the CSSOM resolves where a rule lives.

## Known nit, not fixed

Nothing outstanding on the stage rail. (An earlier revision of this document called
`#mlsStages .bar i` "dead code (nothing sets that width)". That was wrong — `renderStages` wrote
`style="width:N%"` inline on every rebuild. It was never *seen* for reason 1 above, not because
nothing wrote it. The layout-property violation and the missing motion were one bug wearing two
faces, and both are fixed.)

**391 literal timings survive across 88 files** (`mls-connect.js` 115, `ScribeFlow.html` 41,
`feat_mls_redesign.js` 21, the six patient pages ~5 each). They are not forked *tokens* — they
are pre-token bespoke curves. Rewriting them blind across files four lanes are editing buys no
behavioural change and guarantees conflicts, so the standing rule stays: **nothing NEW invents a
timing.** If one of those surfaces is being touched for another reason, move it onto tokens then.
