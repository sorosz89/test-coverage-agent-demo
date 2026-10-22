---
name: feasibility-check
description: Judge each not-yet-verdicted Northwind Bank test-case issue's automation feasibility, apply a feasibility:* label, and leave a one-line rationale comment.
---

# Feasibility Check

Manually invoked (e.g. `/feasibility-check`). No parameters/flags — always operates on
whatever test-case issues in the current repo don't yet have a feasibility verdict.

## 1. Determine the repo

Infer `<owner>/<repo>` from `git remote -v` (the `origin` remote). Do not ask the user
for it or hardcode it.

## 2. Select unverdicted test cases

Run:

```bash
gh issue list --label test-case --state open --json number,labels \
  --jq '.[] | select(([.labels[].name] | any(startswith("feasibility:"))) | not) | .number'
```

This is a read-only call — no rate-limit concern. If it returns nothing, report that
every test case already has a feasibility verdict and stop (this is the expected,
correct outcome on fully-seeded data — see SPEC.md §4, note under the seed table).

## 3. For each selected issue, one at a time

Process issues strictly one at a time, in the order returned. For each:

1. Read the issue: `gh issue view <number> --json title,body` to get the
   **Area / Preconditions / Steps / Expected result** fields from the body template.
2. Judge feasibility using the criteria below.
3. Apply exactly one label via a single call:
   `gh issue edit <number> --add-label "feasibility:<automatable|not-automatable>"`
4. Sleep ≥1 second.
5. Post the rationale comment via a single call:
   `gh issue comment <number> --body "**Verdict:** Automatable|Not automatable — **Reason:** <one sentence>"`
6. Sleep ≥1 second before moving to the next issue.

Never batch across issues and never parallelize — label-apply and comment are each a
separate mutating (content-creating) call, so there are two 1-second sleeps per issue,
not one. This follows the secondary-rate-limit constraints in SPEC.md §4.1 / the
`research/github-api-bulk-limits.md` findings (serialize writes, ≥1s apart).

## 4. Judgment criteria

Read the scenario's Area, Preconditions, Steps, and Expected result. Judge
**`feasibility:not-automatable`** when the scenario *requires*:

- physical hardware interaction (inserting a physical card, a phone call, a biometric
  scan on a real device)
- a live third-party human process
- subjective visual/aesthetic judgment not reducible to an assertion
- genuinely non-deterministic real-world data the test environment can't control

Otherwise, judge **`feasibility:automatable`**.

Feasibility is a capability judgment — "could this be automated by nature or design" —
never a status of whether it has actually been automated. Do not consider or set any
`automation:*` label; that field is separate progress metadata this agent never touches.

## 5. Idempotency

Always safe to re-run. The selection query in step 2 already excludes any issue that has
a `feasibility:*` label, so a re-run only ever touches issues still missing a verdict.
If this skill is interrupted partway through, simply re-invoke it — no cleanup or state
tracking is needed; already-verdicted issues are naturally skipped.
