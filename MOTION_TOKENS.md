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

## The four laws

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
| stage dots | scale + colour as the stage advances | `--mls-base` `--mls-spring` |

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

## Known nit, not fixed

`#mlsStages .bar i` transitions `width` — a layout property, against law 1. It is dead code
(nothing sets that width), which is why it has never been seen. Converting it to
`transform:scaleX()` needs the writer that does not exist yet.
