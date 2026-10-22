# Review: `feasibility-check` skill

Scope: `.claude/skills/feasibility-check/SKILL.md` (added in commit `1a04ff8`), reviewed against
SPEC.md §5 and the sibling `generate-report` skill for architectural consistency. This document
records the findings; `.claude/skills/feasibility-check-v2/` is a hardened implementation that
addresses them. The original skill is left untouched for comparison/learning purposes.

## Findings

### 1. No structured/enforced output format

The verdict comment template —
`**Verdict:** Automatable|Not automatable — **Reason:** <one sentence>` (SKILL.md:40) — is
freeform prose composed by the model and posted via `gh issue comment` with nothing validating it
before it ships. The literal `|` reads like regex alternation and risks being echoed verbatim.
Nothing checks that the comment's stated verdict actually matches the label applied in the
previous step — they could diverge silently.

*Judgement call.* Fixed in v2 by moving the verdict to a validated enum argument to a script,
rather than free text inside a comment body.

### 2. No few-shot examples

The judgment criteria (SKILL.md:48-59) are four abstract bullets with zero worked examples, even
though several are inherently fuzzy (e.g. "subjective visual/aesthetic judgment not reducible to
an assertion"). The spec's target distribution (~76% automatable, SPEC.md §4) is never anchored
with example issue → verdict pairs, which risks inconsistent judgments across runs/models,
particularly at the fuzzy boundary.

*Judgement call.* Fixed in v2 with four worked examples, including one deliberately boundary case.

### 3. Partial-mutation bug breaks idempotency — concrete bug

Step 3 applies the `feasibility:*` label *before* step 5 posts the rationale comment
(SKILL.md:36-40). The selection query in step 2 excludes any issue that already has a
`feasibility:*` label. If the process dies between steps 3 and 5, the label is already set, so a
re-run's selection query will never re-select that issue — its rationale comment is permanently
lost. This contradicts the skill's own idempotency claim (SKILL.md:69-70), which is only true for
interruption *between* issues, not *within* one.

*Concrete bug.* Fixed in v2 by reordering: comment first, label last.

### 4. Silent truncation risk against the 90-issue dataset — concrete bug

The selection query (SKILL.md:21-23) uses `gh issue list` with no `--limit`; the CLI's default
limit is 30. Against SPEC.md's 90-issue dataset, if more than 30 issues are simultaneously
unverdicted, a single invocation silently processes only the first 30 with no warning — while the
skill's own step 2 instructions ("if it returns nothing, report ... and stop") imply a single pass
is authoritative. This is inconsistent with `generate-report`'s read path, which explicitly
paginates (`gh api graphql --paginate --slurp`, generate_report.py:44).

*Concrete bug.* Fixed in v2 with an explicit `--limit 1000`.

### 5. Rate-limiting is prompt-trusted, not enforced

"Sleep ≥1 second" (SKILL.md:38, 41) relies on the model remembering to execute a sleep between
tool calls — there is no deterministic wrapper. This is the central architectural asymmetry
against `generate-report`, which hands its correctness-critical work (fetch, compute, render) to a
real Python script specifically so it doesn't depend on model behavior for things that must be
exactly right. `feasibility-check` has equally strict constraints (GitHub secondary rate limits)
but is 100% prompt-driven for them.

*Judgement call.* Fixed in v2 by moving both mutating calls and their sleeps into a script.

### 6. No end-of-run summary

Unlike `generate-report` (its "After running" section reports the three computed percentages
back), `feasibility-check` has no instruction to summarize what a batch run actually did.

*Judgement call.* Fixed in v2 with an explicit final reporting step.

### 7. Judgment criteria duplicated between SPEC.md §5 and SKILL.md §4

The criteria are repeated near-verbatim in both documents — a two-source-of-truth risk if one is
edited without the other.

*Accepted, unchanged in v2.* SPEC.md's own design goal is that each skill be "precise enough to
implement end-to-end without opening any other ticket" (SPEC.md:5-6) — i.e. self-containment is
intentional, not an oversight. Removing the duplication would violate that goal, so this is
tracked here rather than fixed.

## Summary

| # | Finding | Severity | v2 status |
|---|---|---|---|
| 1 | No structured/enforced output format | Judgement call | Fixed |
| 2 | No few-shot examples | Judgement call | Fixed |
| 3 | Partial-mutation idempotency bug | Concrete bug | Fixed |
| 4 | Silent truncation at 30 issues | Concrete bug | Fixed |
| 5 | Rate-limiting prompt-trusted | Judgement call | Fixed |
| 6 | No end-of-run summary | Judgement call | Fixed |
| 7 | Criteria duplicated with SPEC.md | Judgement call | Accepted, unchanged |

See `.claude/skills/feasibility-check-v2/SKILL.md` and `.claude/skills/feasibility-check-v2/apply_verdict.sh`
for the hardened implementation. `.claude/skills/feasibility-check/` is left as-is.
