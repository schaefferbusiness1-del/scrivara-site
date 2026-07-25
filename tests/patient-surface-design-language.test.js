'use strict';

/* The four surfaces a patient touches must speak ONE visual language.
 *
 * The owner approved a direction from a reference screenshot; it shipped first
 * on patient-portal.html's sign-in screen, and booking.html / intake.html were
 * built to match. What went unnoticed for several builds is that the MIDDLE of
 * the journey never moved: patient-portal.html's own signed-in surface, and
 * every modal it injects at runtime, kept the older kit. A patient went
 *
 *   sign in (new) -> set password (old) -> their records (old)
 *      -> request appointment (new) -> intake (new)
 *
 * crossing the seam twice inside one flow, on the two screens carrying the most
 * trust: choosing a password, and reading their own chart.
 *
 * Two properties are asserted, and they fail for different reasons:
 *
 *   1. Every page declares the approved base geometry. Catches a page being
 *      added, or a base rule being edited back toward the old kit.
 *   2. No FIELD or BUTTON anywhere in these files sits on a small radius.
 *      This is the one that actually caught the bug — the runtime modals are
 *      styled INLINE, so a stylesheet-only check reported all four pages clean
 *      while three inline surfaces were still on 10px.
 *
 * Cards, banners, chips and callouts legitimately use small radii, so the
 * second check is deliberately scoped to control-ish context only.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const PAGES = ['patient-portal.html', 'booking.html', 'intake.html', 'appointment.html'];

/* the approved kit */
const FIELD_RADIUS = '14px';
const PILL = '999px';

/* ---- 1. base geometry is declared, per page ---- */
for (const page of PAGES) {
  const src = fs.readFileSync(path.join(root, page), 'utf8');

  const btn = /\.btn\{[^}]*\}/.exec(src);
  assert.ok(btn, page + ': no .btn rule — the primary action must be styled');
  assert.ok(
    btn[0].includes('border-radius:' + PILL),
    page + ': primary action is not a pill. The approved direction makes the one ' +
    'primary action unmistakable; a square primary reads as a different product.'
  );

  /* appointment.html is a read-only confirmation screen and has no fields */
  const hasFields = /<input|<select|<textarea/.test(src);
  if (hasFields) {
    const field = /(?:^|\n)\s*input[^{\n]*\{[^}]*\}/.exec(src);
    assert.ok(field, page + ': has fields but declares no base field rule');
    assert.ok(
      field[0].includes('border-radius:' + FIELD_RADIUS),
      page + ': base field radius is not ' + FIELD_RADIUS + ' — found: ' +
      field[0].replace(/\s+/g, ' ').slice(0, 120)
    );
    assert.ok(
      /select/.test(field[0]) && /textarea/.test(field[0]),
      page + ': base field rule does not cover <select>/<textarea>. patient-portal ' +
      'styled only <input> for several builds, leaving 10 dropdowns and text areas ' +
      'on browser defaults next to styled inputs.'
    );
  }
}

/* ---- 2. nothing inline slipped back to the old kit ---- */
const SMALL_RADIUS = /border-radius:(9|10|11|12)px/g;
const CONTROLish = /input|button|\.btn|select|textarea|cursor:pointer/i;
/* how far back to look for the control tag. A real inline field carries
 * width + padding + border before it reaches border-radius, which already eats
 * ~60 chars; 90 was cutting it close enough that a slightly longer style
 * attribute would have hidden the tag and reported the page clean. */
const LOOKBACK = 140;

const stragglers = [];
for (const page of PAGES) {
  const src = fs.readFileSync(path.join(root, page), 'utf8');
  let match;
  SMALL_RADIUS.lastIndex = 0;
  while ((match = SMALL_RADIUS.exec(src))) {
    const context = src.slice(Math.max(0, match.index - LOOKBACK), match.index + 20).replace(/\s+/g, ' ');
    if (CONTROLish.test(context)) {
      stragglers.push(page + ': …' + context.slice(-80));
    }
  }
}

assert.deepStrictEqual(
  stragglers, [],
  'Field/button still on the old radius:\n  ' + stragglers.join('\n  ') +
  '\nInline styles beat the stylesheet, so these are invisible to a CSS-only ' +
  'check and must be edited as strings.'
);

/* ---- 3. the guard itself must be able to fail ----
 * The probe is the VERBATIM shape of the defect this suite was written for —
 * the set-password field as it shipped before this build. An earlier version of
 * this self-check used a made-up style string with no control tag in it; it
 * failed, correctly, because it never exercised the CONTROLish gate at all. A
 * guard proven against a fake defect proves nothing. */
{
  const probe =
    '<input id="pwsP1" type="password" autocomplete="new-password" ' +
    'style="width:100%;padding:11px 12px;border:1px solid #E4E1D8;' +
    'border-radius:10px;font-size:16px;box-sizing:border-box" />';
  let caught = 0;
  SMALL_RADIUS.lastIndex = 0;
  let m;
  while ((m = SMALL_RADIUS.exec(probe))) {
    const context = probe.slice(Math.max(0, m.index - LOOKBACK), m.index + 20);
    if (CONTROLish.test(context)) caught++;
  }
  assert.strictEqual(
    caught, 1,
    'the straggler detector no longer recognises an old-kit inline field — ' +
    'it would report clean regardless of the files'
  );
}

/* ---- 4. the checkbox rows a patient taps one-handed ----
 * Measured live at 375px: the "Show password" checkbox renders 13x13. It is
 * wrapped by its <label>, so the label is the real tap target — but the label
 * is a flex row with no min-height and settled at 20px, under the WCAG 2.5.8
 * (AA) 24x24 floor. It appears three times: sign-in, set-password modal, and
 * claim-account modal — and it is exactly the control someone fumbling a
 * password on a phone needs to hit.
 *
 * The raw checkbox is left alone deliberately; growing the LABEL is what
 * changes the hit area, and a flex row with align-items:center grows without
 * moving the text. */
{
  const src = fs.readFileSync(path.join(root, 'patient-portal.html'), 'utf8');
  const rows = src.match(/<label[^>]*display:flex[^>]*>\s*<input type="checkbox"/g) || [];
  assert.ok(
    rows.length >= 3,
    'expected at least 3 checkbox rows in patient-portal.html, found ' + rows.length +
    ' — if the markup moved, this guard is measuring nothing'
  );
  const undersized = rows.filter(row => {
    const mh = /min-height:(\d+)px/.exec(row);
    return !mh || parseInt(mh[1], 10) < 44;
  });
  assert.deepStrictEqual(
    undersized, [],
    'checkbox row(s) with no 44px min-height — the label IS the tap target, and ' +
    'without it the row settles at ~20px:\n  ' + undersized.join('\n  ')
  );
}

console.log('PASS patient-surface-design-language: ' + PAGES.length +
  ' patient surfaces share one field/button language, inline styles included, ' +
  'and every checkbox row clears 44px');
