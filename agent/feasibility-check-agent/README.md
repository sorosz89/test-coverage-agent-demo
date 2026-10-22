# feasibility-check-agent

A standalone Anthropic SDK agent that does the same job as
`.claude/skills/feasibility-check(-v2)`, for comparison: judge every not-yet-verdicted test-case
issue's automation feasibility, post a rationale comment, and apply a `feasibility:*` label.
This is a third, independently runnable variant — it doesn't replace either skill.

Built against `@anthropic-ai/sdk@1.1.0` and `zod@3.25` (the `zod/v4` subpath). Uses:

- `client.beta.messages.toolRunner()` — runs the tool-use loop automatically; no hand-rolled
  `while` loop over `stop_reason`.
- `betaZodTool()` (`@anthropic-ai/sdk/helpers/beta/zod`) — builds each tool's JSON Schema
  directly from a Zod schema.
- `strict: true` on the `submit_verdict` tool — the API guarantees the `verdict` field can only be
  one of the two enum values and `reason` is non-empty; this is *not* the same as `tool_choice`
  forcing (which picks which tool runs) — `strict` constrains what a chosen tool's *input* can
  look like.
- `tool_choice: { type: "auto", disable_parallel_tool_use: true }` — caps the model at one tool
  call per turn, which is how "process one issue at a time, never in parallel" (SPEC.md §4.1) is
  enforced at the API level, backed by an in-process write-mutex in `src/tools.ts` as
  defense-in-depth.

See `FEASIBILITY-CHECK-REVIEW.md` at the repo root for the review this design responds to, and the
`FEASIBILITY-CHECK-REVIEW.md`-style table in the planning notes for how each finding maps to a
guarantee here that's stronger than the bash-script v2 skill's (e.g. finding #1's "no structured
output" is fixed there by validating *after* the model writes free text; here it's fixed by making
an invalid value unrepresentable in the first place).

## Setup

```bash
cp .env.example .env   # fill in ANTHROPIC_API_KEY; GITHUB_TOKEN optional (falls back to `gh auth token`)
npm install
```

## Run

```bash
npm run typecheck        # tsc --noEmit
npm run start -- --dry-run   # real read, logged (not posted) writes — safe against the shared fixture dataset
npm run start                 # live: posts comments and applies labels for real
```

`ANTHROPIC_MODEL` defaults to `claude-sonnet-5-5` (overridable in `.env`) — picked for cost/latency
on this kind of bulk classification task over up to ~90 issues; Opus is unnecessary expense here,
and Haiku is likely too weak for the fuzzier judgment calls.

## Error handling

- **Fatal errors** (bad API key, no git remote, `gh auth token` failing) — caught in `main()`
  (`src/index.ts`), printed to stderr, process exits 1.
- **GitHub rate-limit errors** on a mutating call (`postVerdictComment` / `applyFeasibilityLabel`)
  or the read-only list call are retried with backoff in `src/github.ts`
  (`withRetry`/`isRateLimitError`/`retryDelayMs`): honors `Retry-After` / `x-ratelimit-reset` when
  GitHub sends them, otherwise starts at 60s and doubles, up to 5 attempts — per SPEC.md §4.1.
- **Per-issue write failures that survive those retries** are caught in `submit_verdict`'s `run()`
  (`src/tools.ts`), recorded into `tally.failures`, and rethrown — the model sees an `is_error`
  tool_result for that issue (its instructions say: skip it, don't retry, mention it in the final
  reply) and `tally.failures` makes it into the printed Summary either way, independent of whether
  the model remembers to mention it.
- **Tool-input validation failures** (the model somehow still producing a bad enum/empty reason
  despite `strict: true`) are caught separately in the wrapped `parse` on `submitVerdictTool` and
  recorded into `tally.rejected`.
- The process exits 1 if either `tally.failures` or `tally.rejected` is non-empty, and the final
  Summary distinguishes "no unverdicted test cases found — nothing to do" (nothing was pending)
  from a run that found issues but didn't resolve all of them (so a human — or CI — doesn't have to
  guess which `0` they're looking at).
- The model's own final text reply is now also printed (`index.ts`), not discarded — so any
  narration about skipped issues actually reaches whoever ran this.
