# Security report to athenahealth

## athenaOne does not clear rendered PHI when a session ends

**Date:** 2026-07-31
**From:** Scrivara / MLS Assist — athenaOne integration partner
**Practice context:** live practice, single clinician, normal clinic use
**Class:** Session hygiene / client-side PHI residue
**Severity in our assessment:** Moderate — unauthenticated PHI exposure at the
workstation, with no server-side audit record of the access
**Explicitly not claimed:** authentication bypass, credential replay, or any
unauthorized access to athenahealth servers

---

## 1. The defect

When an athenaOne session ends — by explicit sign-out or by idle timeout —
athenaOne interrupts *navigation* but does not *purge* the PHI it has already
rendered into the browser tab.

athenaOne's Day view is a frameset. On session end, the sign-in or "Refresh
timed out" surface renders in one frame. The sibling frames keep their painted
content: patient names, appointment times, appointment identifiers, and provider
attribution for the entire clinic day. That content stays in the DOM, readable,
until the tab is navigated away or closed.

Two properties make it worse than a transient artifact:

- **The frameset's top-level URL does not change.** Session state is not
  observable from the tab's URL; it can only be determined by inspecting
  rendered content for a sign-in form or a timeout heading.
- **Reading the residue produces no server-side event.** The access generates no
  request to athenahealth, so it appears in no access log. Post-sign-out reads of
  this PHI are invisible to audit.

## 2. Proof it is broken

### 2.1 Live capture, 2026-07-22

Recorded contemporaneously during a scheduled acceptance session on a live
practice, not reconstructed afterward. Verbatim from our log
(`tests/live-e2e-artifacts/2026-07-22-acceptance.md:22`):

> "Schedule phase fine (18 rows now — an 18th appointment was added mid-clinic;
> 17 updated post-click). ALL 17 history reads refused… **Screenshot proof: the
> Athena tab was sitting on identity.athenahealth.com sign-in** — the athenaNet
> session idle-expired between 09:52 and 10:36."

Read the two halves against each other:

| | Result | Requires |
|---|---|---|
| Chart / history reads (17) | **All refused** | Navigation → a live session |
| Day schedule (18 rows) | **Fully returned** | Nothing — the grid was already painted |

The session was demonstrably dead: the tab was displaying the
`identity.athenahealth.com` sign-in page, and every navigation-dependent
operation failed. Yet a complete 18-row clinic schedule was still readable —
**including an 18th appointment added mid-clinic**, which shows the residue was
not a trivially stale fragment but the practice's working schedule as of expiry.

This asymmetry is the proof. Everything requiring your servers was correctly
denied. Everything already rendered remained exposed.

### 2.2 The exposure is not mediated by any request to athenahealth

Our integration makes **zero** network calls to athenahealth. Every read is a
DOM read of a tab the clinician already has open. Verifiable in our shipped
extension source:

```
$ grep -n "fetch(\|XMLHttpRequest\|sendBeacon" background.js content.js | grep -i athena
(no matches)

$ grep -o "fetch('https://[^']*" background.js | sort -u
fetch('https://mlsscribe.com/extension-version.json
fetch('https://mlsscribe.com/mls-assist-config.json
fetch('https://scrivara-backend.onrender.com/api/versions/report
```

All three targets are our own hosts. There is no code path by which we could
authenticate to, or receive data from, athenahealth after a session ends. The
data we observed post-sign-out came from the browser, which is precisely the
point: **it was still there to be read.**

### 2.3 Session state is not observable from the URL

From our own source, documenting the constraint your frameset imposes
(`background.js:3468`):

> `/* A globalframeset URL remains unchanged when Athena renders its timeout
>    page in a child frame, so a URL-only decision is unsafe. */`

Because of this we were forced to detect sign-out by scanning rendered content
for a *visible* timeout heading or a *visible* password field
(`mlsAthSessionProbeFn`, `background.js:4247`). That detection necessarily fails
during the window when a session is dead server-side but not yet repainted — and
during that window the residue reads as a live schedule.

### 2.4 Independently re-reported

Our clinician reported the same behavior from ordinary use on 2026-07-25 —
"logged out of Athena, history definitely can't pull, but I have seen the day's
patients come through" — before either of us connected it to the July 22 capture.
Two independent observations, three days apart, same asymmetry.

### 2.5 Reproduction protocol

We have not staged a deliberate, screenshot-instrumented reproduction; the
evidence above is incidental capture during live clinical work. Any of the
following reproduces it without our software:

1. Sign in to athenaOne and open the Day schedule. Let the grid paint fully.
2. Sign out, or leave the tab idle until the session expires. Do **not** close,
   reload, or navigate the tab.
3. Open browser devtools on that tab and inspect the frame containing the
   schedule (or run `document.body.innerText` against it).
4. Observe: the full painted schedule — patient names, times, appointment
   identifiers — is still present in the DOM with no valid session.
5. Confirm the session really is dead by attempting to open any chart. It fails.

Step 3 requires only devtools. No extension, no credentials, no tooling of ours.

## 3. Impact

- **Shared and unattended workstations.** A clinician signs out and steps away.
  The next person at that terminal reaches a full day's patient list through the
  Back button or a devtools panel, with no credentials. This is the realistic
  case in a clinic, and sign-out is exactly the control staff are trained to
  rely on.
- **Any extension with athenaOne host permissions.** Not an exotic threat model —
  it is the access model of every EMR-adjacent browser tool, including ours.
- **No audit trail.** Because no request reaches your servers, this access is
  absent from access logs. From an audit standpoint the exposure did not happen.
- **Stale data consumed as current by integrations.** Residue is
  indistinguishable from a live grid by inspection, so a cancelled or
  rescheduled appointment survives in it as an apparently real one. We have
  addressed this on our side; it remains a hazard for any partner reading the
  rendered surface.

## 4. What we are asking you to fix

In rough order of value:

1. **Purge rendered PHI on session end.** Sign-out and idle-timeout paths should
   clear or replace *sibling* frame content, not merely render a timeout surface
   into one frame. Interrupting navigation is not sufficient; the data is already
   in the client.
2. **Force a full-document navigation on sign-out**, so no frame retains prior
   content and frameset history cannot restore it.
3. **Reflect session state in the top-level URL** on expiry, so integrations and
   your own UI can determine session state without inspecting rendered content.
4. **Blank the rendered surface client-side on idle**, ahead of server-side
   expiry, so the exposure window does not run from last interaction to timeout.

Items 1 and 2 close the finding. Items 3 and 4 reduce the window and make the
state honestly observable.

## 5. What we changed on our side, and why it is not sufficient

We chose not to detect sign-out by issuing requests to athenahealth — that would
mean introducing new network calls into a clinical system — and not by forcibly
repainting a clinician's tab. Instead we measure the **age** of the rendered grid
and disclose it with every pull: a grid left open for four hours is four hours
old whether or not the session behind it is alive.

That protects consumers of data we hand on. It does nothing about PHI sitting
readable in a browser at an unattended workstation, which only a change on the
athenaOne side can address. That is why we are reporting it.

## 6. Disclosure

Reported privately to athenahealth. We are not publishing details and have no
disclosure deadline; we would like to know the intended remediation and rough
timing so we can advise our practice appropriately in the interim. We can
demonstrate the reproduction live against our practice environment and re-test
against any pre-release build.

**Contact:** Scrivara / MLS Assist — see accompanying correspondence.
