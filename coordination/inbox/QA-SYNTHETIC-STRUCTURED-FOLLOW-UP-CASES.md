# Hosted synthetic template acceptance cases

Date: 2026-07-29

Use only a dedicated hosted synthetic QA account.

## Exact synthetic identity

- Patient name: `Synthetic Template Patient`
- DOB: `1985-05-06`
- MRN: `SYN-TPL-20260729`
- Visit label: `Synthetic Template Fidelity Visit`

Upload `QA-SYNTHETIC-STRUCTURED-FOLLOW-UP.txt` through the visible Templates
file control. Save it, enable Templates, select this exact template, and make
it the default before generating.

## Case 1

```text
Synthetic patient reports right knee pain for three weeks. No swelling. Exam range of motion is full. Assessment is right knee pain. Plan is physical therapy. Follow up in four weeks.
```

Required facts:

- right knee, not left knee;
- three weeks;
- no swelling;
- full range of motion;
- physical therapy; and
- four week follow up.

## Case 2

```text
Synthetic patient reports dry cough for five days. No fever and no shortness of breath. Exam shows clear lungs. Assessment is viral upper respiratory infection. Plan is fluids and rest. Follow up if symptoms worsen.
```

Required facts:

- dry cough, not knee pain;
- five days;
- no fever;
- no shortness of breath;
- clear lungs;
- viral upper respiratory infection;
- fluids and rest; and
- follow up only if symptoms worsen.

## Case 3

```text
Synthetic patient reports intermittent tension headache for two days. No weakness and no vision change. Assessment is tension headache. Plan is hydration and acetaminophen.
```

Required facts:

- tension headache, not cough or knee pain;
- two days;
- no weakness;
- no vision change;
- hydration and acetaminophen;
- OBJECTIVE FINDINGS is `NOT DOCUMENTED`; and
- FOLLOW UP is `NOT DOCUMENTED`.

## Required proof for every case

Use both automatic Generate and the visible Use action.

- The QA rule, all eight clinical headings, and fixed line appear exactly once
  and in order.
- `QA FIXED LINE: SYNTHETIC TEMPLATE LIFECYCLE` is byte-exact.
- Automatic and visible Use outputs agree on template structure.
- Only facts from the current transcript appear.
- No fact from another case or patient appears.
- Missing facts use `NOT DOCUMENTED`; no fact is invented.
- The active patient, visit binding, and epoch remain exact.
- Template enabled, selected, and default state survives hard reload.
- The generated note survives hard reload under the same synthetic visit.
- The saved note reopens from the visible History route.
