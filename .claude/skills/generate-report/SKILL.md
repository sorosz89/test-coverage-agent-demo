---
name: generate-report
description: Read all Northwind Bank test-case issues, compute Automation Feasibility %, Effective Automation Coverage %, and the naive Generic Formula % contrast, and render a self-contained report.html dashboard at the repo root.
---

# Generate Report

Manually invoked (e.g. `/generate-report`). No parameters — always recomputes from
current issue state and overwrites `report.html` fresh.

## What this does

Run the bundled script from the repo root:

```bash
python3 .claude/skills/generate-report/generate_report.py
```

The script:

1. Infers `<owner>/<repo>` from `git remote get-url origin`.
2. Reads every `test-case`-labeled issue in one bulk, read-only GraphQL call
   (`gh api graphql --paginate --slurp`, per SPEC.md §6) — no write-rate-limit concern
   since nothing is mutated.
3. Computes:
   - `total` — all test-case issues
   - `automatable` / `not_automatable` — by `feasibility:*` label
   - `implemented` — automatable issues with `automation:implemented`
   - **Automation Feasibility % = automatable ÷ total × 100**
   - **Effective Automation Coverage % = implemented ÷ automatable × 100**
   - **Generic Formula % = implemented ÷ total × 100** (naive contrast card only —
     not a metric this demo endorses, see SPEC.md §2)
4. Fills `template.html` (the confirmed visual design from
   [issue #6](https://github.com/sorosz89/test-coverage-agent-demo/issues/6) /
   `prototypes/report-mock.html` on `prototype/report-visual-design`, adapted with
   `@@PLACEHOLDER@@` tokens in place of the prototype's hardcoded demo numbers) and
   writes the result to `report.html` at the repo root, inline CSS/JS, no external
   build step, overwriting any previous run.

## If the script can't run

If `python3` or `gh` is unavailable, fall back to doing the same steps manually: fetch
labels for all `test-case` issues via the GraphQL query in SPEC.md §6, compute the same
three percentages, and substitute them into `template.html` in place of every
`@@PLACEHOLDER@@` token, then write the result to `report.html` at the repo root. Do not
change the layout, structure, or content of `template.html` — it is the user-confirmed
design; only the placeholder substitution is this skill's job.

## After running

Report the three computed percentages back to the user (feasibility / effective
coverage / generic formula) and the path to the written `report.html`.
