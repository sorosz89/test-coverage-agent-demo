# Test-Coverage Agent Demo — Build Spec

This is the consolidated build spec for `test-coverage-agent-demo`, synthesized from the
resolved [Wayfinder map](https://github.com/sorosz89/test-coverage-agent-demo/issues/1)
(issues #1-#7 in this repo). It is precise enough to implement end-to-end without opening
any other ticket.

## 1. Overview

A self-contained demo illustrating the "Effective Automation Coverage" metric: a fictional
retail banking app ("Northwind Bank") has 90 manual QA test cases, stored as GitHub Issues
in this repo. Two manually-invoked Claude Code skills operate on them:

1. **`/feasibility-check`** — judges each test case's automatability, labeling it and
   leaving a one-line rationale.
2. **`/generate-report`** — reads all test cases and renders a static HTML dashboard
   showing **Automation Feasibility %**, **Effective Automation Coverage %**, and a
   deliberately-naive **Generic Formula %** contrast, styled after a reference dashboard
   image.

No real test automation exists — "automated"/"implemented" is simulated metadata. No
automated triggering, no UI/CRUD app, no many-to-many test-linking, no time-series/trend
reporting. See [§7 Out of scope](#7-out-of-scope).

## 2. Glossary

- **Test case** — a GitHub issue labeled `test-case`, one manual QA scenario against
  Northwind Bank. Persistent fixture data: stays **open** indefinitely, never closed.
- **Feasibility** — a verdict on a test case: `feasibility:automatable` or
  `feasibility:not-automatable`. A capability judgment ("could this be automated by
  nature/design"), independent of whether it has been. Set once, by the
  feasibility-check agent.
- **Automation status** — one of `automation:none` / `automation:planned` /
  `automation:in-progress` / `automation:implemented`. Simulated progress metadata.
  Only meaningful for automatable cases; non-automatable cases are pinned at
  `automation:none` permanently. (Setting/seeding this field is part of seed data
  generation, §4 — no agent in this demo transitions it.)
- **Automation Feasibility %** — `automatable test cases ÷ all test cases × 100`. The
  realistic ceiling: what "done" can mean.
- **Effective Automation Coverage %** — `implemented test cases ÷ automatable test cases
  × 100`. Real progress against a fair denominator.
- **Generic Formula %** — `implemented test cases ÷ all test cases × 100`. A deliberately
  naive, illustrative-only number (reuses the reference image's own framing) shown purely
  to contrast against Effective Coverage — not a metric this demo endorses.

## 3. Data model & label taxonomy

Resolved in [#2](https://github.com/sorosz89/test-coverage-agent-demo/issues/2).

**Issue title**: `[<Area>] <Scenario>` — e.g. `[Transfers] Schedule a recurring transfer
with insufficient funds`.

**Issue body template**:
```
**Area:** <Transfers / Card Management / Bill Pay / Statements / Branch Locator / ...>
**Preconditions:** ...
**Steps:**
1. ...
**Expected result:** ...
```

**Labels** (disjoint from this repo's `wayfinder:*` labels, which only live on map/ticket
issues — never collide):
- `test-case` — marks an issue as a test case
- `feasibility:automatable` / `feasibility:not-automatable`
- `automation:none` / `automation:planned` / `automation:in-progress` /
  `automation:implemented` (default `automation:none`)

**Issue state**: always **open** — test cases are a persistent dataset the agents query
repeatedly, not work items to complete.

## 4. Seed data generation — NOT YET DONE, build session's first job

Nothing described here exists yet. The build session must:

1. Pre-create all labels listed in §3 (`gh label create`) — label-apply 404s on unknown
   names, so this must happen before any issue creation.
2. Generate **90 test-case issues** for Northwind Bank — a retail banking web app with
   account dashboard, transfers, bill pay, card management, statements/exports areas,
   plus a few areas that are naturally infeasible to automate (branch-locator map
   rendering, phone-based card activation, biometric login on a real device).
3. Create them via `gh issue create`, respecting the rate-limit findings in §4.1 below.
4. Apply `feasibility:*` and `automation:*` labels directly during seeding (simulating
   what the feasibility-check agent + time would otherwise produce), targeting this
   distribution:

   | | count |
   |---|---|
   | Total test cases | 90 |
   | — `feasibility:automatable` | 68 (~76%) |
   | — `feasibility:not-automatable` | 22 |
   | Of the 68 automatable: `automation:implemented` | 44 |
   | Of the 68 automatable: `automation:in-progress` | 12 |
   | Of the 68 automatable: `automation:planned` | 8 |
   | Of the 68 automatable: `automation:none` | 4 |
   | All 22 non-automatable: `automation:none` | 22 |

   This yields Feasibility % ≈ 76%, Effective Coverage % ≈ 65%, Generic Formula % ≈ 49% —
   matching the prototype in §6.

   Note: a real run of the feasibility-check agent (§5) would normally be what sets
   `feasibility:*` — but since this demo needs a populated dataset on day one, seed
   generation sets it directly, as if the agent had already run. Running
   `/feasibility-check` afterward against this fully-seeded set is a safe no-op (every
   issue already has a `feasibility:*` label, so the selection query in §5 finds nothing
   to do) — useful for demoing the agent against a handful of freshly-added,
   not-yet-verdicted issues instead.

### 4.1 Rate-limit constraints (from [#3](https://github.com/sorosz89/test-coverage-agent-demo/issues/3))

Full findings: `research/github-api-bulk-limits.md` on the `research/github-bulk-limits`
branch (not on main).

- Primary rate limits (5,000/hr) are **not** the constraint at 90-150 issues.
- GitHub's **secondary/abuse limits** are: ≤80 content-creating requests/min, ≤500/hr,
  ≤100 concurrent.
- **Serialize all writes one at a time, with ≥1s sleep between every mutating call**
  (issue create, label apply, comment). A full 90-issue create+label run takes several
  minutes at this cadence — budget for it, don't parallelize.
- Batch all of one issue's labels into a single `gh issue edit --add-label "a,b,c"` call.
- Use REST for writes; `gh api graphql --paginate --slurp` for bulk reads (see §6).
- Retry/backoff is the caller's job — check `Retry-After` / `x-ratelimit-remaining`, back
  off exponentially (~60s start) on secondary-limit errors.

## 5. Feasibility-check agent

Resolved in [#4](https://github.com/sorosz89/test-coverage-agent-demo/issues/4).

**Location**: `.claude/skills/feasibility-check/SKILL.md`. Manually invoked (e.g.
`/feasibility-check`), no parameters/flags. Repo inferred from `git remote -v`.

**Selection** (only unverdicted test cases):
```
gh issue list --label test-case --state open --json number,labels \
  --jq '.[] | select(([.labels[].name] | any(startswith("feasibility:"))) | not) | .number'
```

**Judgment criteria** — read each issue's Area/Preconditions/Steps/Expected-result.
Judge **`feasibility:not-automatable`** when the scenario requires:
- physical hardware interaction (inserting a physical card, a phone call, a biometric
  scan on a real device)
- a live third-party human process
- subjective visual/aesthetic judgment not reducible to an assertion
- genuinely non-deterministic real-world data the test environment can't control

Otherwise **`feasibility:automatable`**. Feasibility is a capability judgment ("could
this be automated"), never a status of whether it has been.

**Output per issue**: exactly one `feasibility:*` label, plus a one-line comment:
```
**Verdict:** Automatable|Not automatable — **Reason:** <one sentence>
```

**Idempotency**: always safe to re-run — the selection query already excludes anything
with a `feasibility:*` label. No further error handling needed: if it dies partway
through, re-running picks up where it left off.

**Rate limits**: one issue at a time, ≥1s between mutating calls (§4.1).

## 6. Report-generator agent

Resolved in [#5](https://github.com/sorosz89/test-coverage-agent-demo/issues/5).

**Location**: `.claude/skills/generate-report/SKILL.md`. Manually invoked (e.g.
`/generate-report`), no parameters — always recomputes from current issue state.

**Read** (read-only, so no write-rate-limit constraint — bulk in ~1-2 calls):
```
gh api graphql --paginate --slurp -f query='
query($endCursor: String) {
  search(query: "repo:<owner>/<repo> label:test-case", type: ISSUE, first: 100, after: $endCursor) {
    nodes { ... on Issue { number title labels(first: 20) { nodes { name } } } }
    pageInfo { hasNextPage endCursor }
  }
}' --jq '.[].data.search.nodes[]'
```

**Compute**:
- `total` — count of all test-case issues
- `automatable` — count with `feasibility:automatable`
- `automation_status` histogram (`none`/`planned`/`in-progress`/`implemented`),
  restricted to automatable issues
- **Automation Feasibility % = automatable ÷ total × 100**
- **Effective Automation Coverage % = implemented ÷ automatable × 100**
- **Generic Formula % = implemented ÷ total × 100** (naive contrast card — see §2)

**Output**: a single self-contained `report.html` at the repo root. Inline CSS/JS, no
external assets, no build step, overwritten fresh on every run.

### 6.1 Visual design reference

Resolved and user-confirmed in
[#6](https://github.com/sorosz89/test-coverage-agent-demo/issues/6):

- **View the confirmed prototype**: https://claude.ai/code/artifact/f21b8ef6-e93e-4581-8836-defa829a578d
- **Prototype source** (reference only, not on main):
  `prototypes/report-mock.html` on the `prototype/report-visual-design` branch —
  https://github.com/sorosz89/test-coverage-agent-demo/blob/prototype/report-visual-design/prototypes/report-mock.html

Layout: eyebrow/title header with a quoted misleading-claim callout (quoting the
**Generic Formula %**, not Feasibility %); a "where projects go wrong" 2×2 panel; a
breakdown-bar panel (All test cases → Automatable → Linked to implemented automated
test) with two contrasting percentage cards (muted Generic Formula vs. accent Effective
Coverage); a bottom 3-card metric row (Metric A: Feasibility, Metric B: Effective
Coverage, a short "how it's set up" explainer). Single committed dark theme — no light
variant, matching the reference image. The reference's 4th "Reading the trend" panel is
**dropped** (no time-series data in this demo).

Consult Claude Code's `dataviz` skill for *how* to execute the visuals (accessible
color choices, theming mechanics) — the prototype stays authoritative on *what* to
build (layout, structure, content).

## 7. Out of scope

Copied from the map — do not expand scope to cover these:

- Real automated test execution / an actual automation framework (Playwright/pytest,
  etc.) — feasibility and automation status are simulated metadata only.
- Full many-to-many test↔automated-test relationship modeling — simplified to a single
  `automation_status` field per manual test case.
- Time-series / trend reporting — one flat snapshot only, no historical data.
- Automated triggering (GitHub Actions, schedules, issue-creation webhooks) — both
  agents are manually invoked.
- A mini test-case-management app/UI with CRUD — GitHub Issues themselves are the data
  store.
- Reusable template / multi-backend support — this is a one-off demo, not a scaffold
  for others to adapt.

## 8. Suggested build order

1. Pre-create labels (§3), then generate and seed the 90 test-case issues with their
   `feasibility:*`/`automation:*` labels already applied, respecting the rate-limit
   cadence (§4, §4.1).
2. Build `.claude/skills/feasibility-check/SKILL.md` (§5). Since seed data is fully
   verdicted, demo it by adding a few fresh unverdicted test cases first, or by
   manually stripping `feasibility:*` from a handful of seeded issues.
3. Build `.claude/skills/generate-report/SKILL.md` (§6), wiring the compute pipeline to
   the visual design already confirmed in §6.1 (adapt the prototype's markup/styles —
   don't redesign from scratch).
4. Run `/generate-report` against the seeded data and confirm the numbers match §4's
   target distribution (Feasibility ≈76%, Effective Coverage ≈65%, Generic Formula ≈49%).
