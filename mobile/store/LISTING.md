# Store listing copy

Paste-ready. Character limits are the stores' own, and each field below is inside its limit.

The tone is deliberately flat. This app does two things and every line here names one of them —
a clinical tool that oversells itself in a store listing is one a reviewer reads more closely.

---

## Both stores

**App name** — `MLS Scribe`

Not "MLS". In an app store "MLS" reads as Multiple Listing Service: the search results are real
estate, and a reviewer's first impression is of an app that does not match its name. The website,
the Chrome extension and the phone recorder all keep the MLS name; only the store listing
differs. It is one string — `mobile/app.config.json` → `displayName` — if the owner disagrees.

**Category** — Medical (primary). Play secondary: none.

**Support URL** — https://mlsscribe.com/
**Privacy policy URL** — https://mlsscribe.com/privacy.html
**Marketing URL** — https://mlsscribe.com/

---

## Apple App Store

**Subtitle** (30 char max)

```
Your day and your charts
```

**Promotional text** (170 max — editable without a new review)

```
Pull today's schedule out of athenaOne from your phone, and read a patient's visit history before you walk into the room.
```

**Description** (4000 max)

```
MLS Scribe puts two things on your phone: today's schedule, and a patient's chart.

That is the whole app. There is one button on each screen.

TODAY
Your appointments for the day, in order, with the patient's age and the reason they are coming
in. Tap one to open their chart. Tap Pull today to bring the day over from athenaOne.

A PATIENT
Name, age, date of birth, MRN, and their visit history — dates, visit types, and codes. Tap
Pull chart to read their history from athenaOne right now.

HOW THE PULL WORKS
MLS Scribe does not connect to athenaOne from your phone. It asks the office computer where you
are already signed in to do the reading, and shows you the result. Before it asks, it checks
that the computer is actually reachable and tells you plainly if it is not — you never watch a
spinner that was never going to finish.

WHAT IT WILL NOT DO
It will not tell you a pull succeeded when it did not. After a pull it counts what actually
arrived on your phone and reports that number, rather than repeating what the office computer
claimed.

FOR CLINICIANS
MLS Scribe requires an existing MLS Scribe account with clinical access released by your practice.
It is a tool for licensed clinicians and their staff. It does not provide medical advice,
diagnosis, or treatment recommendations.

PRIVACY
Patient information is held in memory while you are looking at it and is never written to the
phone's storage. The app locks itself after fifteen minutes and signing out clears everything.
```

**Keywords** (100 max, comma-separated, no spaces after commas)

```
athena,chart,schedule,clinic,patient,visit,ehr,emr,clinician,rounds,practice,medical
```

**What's New in This Version** (first release)

```
First release.
```

---

## Google Play

**Short description** (80 max)

```
Pull today's schedule and read a patient's chart, from your phone.
```

**Full description** (4000 max) — the App Store description above works verbatim.

---

## Screenshots

Both stores require them, and both reject screenshots containing real patient data.

**Use the synthetic-data demo account** — the same one given to reviewers under App Access /
App Review Information. Never a live practice.

Take five, in this order:

| # | screen | what it shows |
|---|---|---|
| 1 | Today, with patients | the whole product in one image |
| 2 | Today, mid-pull | the live status line under the button |
| 3 | A patient's chart | identity line plus visit history |
| 4 | Today, empty | "Nothing on the schedule yet" — the honest empty state |
| 5 | Sign in | dark mode, so the listing shows both |

Sizes:

- **iPhone 6.7"** — 1290 × 2796 (iPhone 15/16 Pro Max). Apple accepts this one size for all
  modern iPhones. Required.
- **iPad 12.9"** — 2048 × 2732. Required only if you leave the app iPad-compatible. This is a
  phone app; set the Xcode target to iPhone-only and skip these.
- **Android phone** — anything from 1080 × 1920 up. Play needs at least 2; give it 5.
- **Play feature graphic** — 1024 × 500, required. The app icon centred on `#F7F5EF` with the
  word "MLS Scribe" beside it is enough; Play shows it small.
