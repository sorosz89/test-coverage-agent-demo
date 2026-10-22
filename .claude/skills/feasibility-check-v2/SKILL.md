---
name: feasibility-check-v2
description: Judge each not-yet-verdicted Northwind Bank test-case issue's automation feasibility, apply a feasibility:* label, and leave a one-line rationale comment. Hardened version of feasibility-check — see FEASIBILITY-CHECK-REVIEW.md for what changed and why.
---

# Feasibility Check (v2)

Manually invoked (e.g. `/feasibility-check-v2`). No parameters/flags — always operates on
whatever test-case issues in the current repo don't yet have a feasibility verdict.

This is a hardened version of `.claude/skills/feasibility-check/SKILL.md`. See
`FEASIBILITY-CHECK-REVIEW.md` at the repo root for the review findings this version fixes; the
original skill is left unchanged for comparison.

## 1. Determine the repo

Infer `<owner>/<repo>` from `git remote -v` (the `origin` remote). Do not ask the user
for it or hardcode it.

## 2. Select unverdicted test cases

Run:

```bash
gh issue list --label test-case --state open --limit 1000 --json number,labels \
  --jq '.[] | select(([.labels[].name] | any(startswith("feasibility:"))) | not) | .number'
```

The explicit `--limit 1000` matters: `gh issue list` defaults to 30 results, which would silently
truncate selection against this repo's 90-issue dataset (SPEC.md §4) if more than 30 issues are
simultaneously unverdicted.

This is a read-only call — no rate-limit concern. If it returns nothing, report that
every test case already has a feasibility verdict and stop (this is the expected,
correct outcome on fully-seeded data — see SPEC.md §4, note under the seed table).

## 3. For each selected issue, one at a time

Process issues strictly one at a time, in the order returned. For each:

1. Read the issue: `gh issue view <number> --json title,body` to get the
   **Area / Preconditions / Steps / Expected result** fields from the body template.
2. Judge feasibility using the criteria and worked examples below. The verdict must be exactly one
   of the two literal values `automatable` or `not-automatable` — nothing else is valid input to
   the next step.
3. Run the bundled script, passing the verdict and a one-sentence reason:
   ```bash
   .claude/skills/feasibility-check-v2/apply_verdict.sh <issue_number> <automatable|not-automatable> "<one-sentence reason>"
   ```
   Do not call `gh issue comment` or `gh issue edit` directly for this. The script:
   - rejects any verdict value other than the two literal enum strings, and rejects an empty
     reason, before doing anything — the point where output structure is actually enforced rather
     than hoped for;
   - posts the rationale comment **first**, sleeps 1s, then applies the label, sleeps 1s (see §6
     Idempotency for why this order matters).

Never batch across issues and never parallelize — each issue's script invocation already contains
the two required ≥1s sleeps between mutating calls (SPEC.md §4.1 / `research/github-api-bulk-limits.md`).

## 4. Judgment criteria

Read the scenario's Area, Preconditions, Steps, and Expected result. Judge
**`not-automatable`** when the scenario *requires*:

- physical hardware interaction (inserting a physical card, a phone call, a biometric
  scan on a real device)
- a live third-party human process
- subjective visual/aesthetic judgment not reducible to an assertion
- genuinely non-deterministic real-world data the test environment can't control

Otherwise, judge **`automatable`**.

Feasibility is a capability judgment — "could this be automated by nature or design" —
never a status of whether it has actually been automated. Do not consider or set any
`automation:*` label; that field is separate progress metadata this agent never touches.

### Worked examples

- **Area: Transfers.** Steps: "Schedule a recurring transfer with insufficient funds; expect a
  decline message." → `automatable` — fully assertable from the UI/API response; no hardware or
  subjective judgment involved.
- **Area: Card Management.** Steps: "Call support to activate a replacement card via the phone
  IVR." → `not-automatable` — requires a live third-party human/phone process.
- **Area: Branch Locator.** Steps: "Confirm the map pin renders in the visually correct position
  on a real device screen." → `not-automatable` — subjective visual judgment not reducible to a
  single assertion.
- **Area: Statements** (boundary case — looks visual, isn't). Steps: "Export the statement PDF and
  verify the account number on page 1 matches the logged-in account." → `automatable` — this reads
  like a visual check, but it reduces to a deterministic text/field assertion once the PDF is
  parsed; it is not a case of judgment that resists being turned into an assertion.

## 5. End-of-run summary

After the batch completes, report back: how many issues were selected, how many were judged
`automatable` vs `not-automatable`, and any issue numbers the script rejected (bad verdict value
or empty reason) along with why.

## 6. Idempotency

Always safe to re-run. The selection query in step 2 excludes any issue that has a `feasibility:*`
label — and `apply_verdict.sh` only applies that label *after* the rationale comment has already
been posted. So if this skill is interrupted mid-issue, the issue still lacks the label and will
be naturally reprocessed on the next run; at worst it gets a duplicate comment, never a silently
missing one. If interrupted *between* issues, already-fully-processed issues (comment + label both
landed) are correctly skipped.

## 7. Rate limits

Enforced by `apply_verdict.sh` itself — one issue at a time, with a real `sleep 1` between each of
its two mutating calls — not left to the model to remember mid-conversation (SPEC.md §4.1).
