# 019 - Stand down the birthday classifier while birthdays are visible

## Measured problem

`mls-connect.js:31943-31959` runs `applyCtl()` every two seconds.

On every tick, its birthday branch queries every `span`, `em`, `i`, `b`, and
`div` in the document, then inspects each leaf node. That is 30 page-wide scans
per minute even under the default `birthdays: true` setting, where the
`mls-r44-bday` class has no visible effect.

The disposable browser preflight exposed the mutation race directly. Repeated
runs alternated between passing the date matrix and failing its identical-DOM
contract because the two-second classifier added `mls-r44-bday` to newly
rendered DOB spans between snapshots. Failures appeared on different fixture
dates, while the immediately preceding run passed the same date matrix.

The scan recognizes the cake icon used by the canonical DOB label, so it can
touch every rendered appointment DOB. It is not limited to an actual birthday.

## Change

Keep the existing classifier and hide behavior unchanged when the user turns
birthdays off.

When `c.birthdays` is true, skip the page-wide classification scan. The body
does not carry `mls-r44-hidebday` in that state, so adding the class cannot
change rendering.

Add an exact performance-contract assertion for the stand-down guard.

`mls-connect.js` is read and written with Latin-1 encoding.

## Expected effect

- Default sessions avoid 30 full-document selector scans per minute.
- New appointment rows no longer receive no-effect class mutations two seconds
  after rendering.
- The date-matrix DOM remains stable across selected days.
- Turning birthdays off still classifies and hides current and later DOB chips
  on the existing two-second cadence.
- Turning birthdays back on still reveals them by removing the body hide class.

## Risks

Low.

The optimization changes only the state where birthday/DOB content is visible.
In that state the classifier class is styling-inert. The disabled state keeps
the original scan, class assignment, and CSS behavior. The patch does not
change strings, patient records, extension files, or satellite bytes.
