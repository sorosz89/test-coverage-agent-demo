import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { Octokit } from "@octokit/rest";
import { z } from "zod/v4";
import {
  applyFeasibilityLabel,
  listUnverdictedTestCases,
  postVerdictComment,
} from "./github.js";

export interface Tally {
  totalFound: number;
  automatable: number;
  notAutomatable: number;
  /** Tool-input validation failures (bad verdict enum, empty reason) — caught before run(). */
  rejected: Array<{ issueNumber: unknown; error: string }>;
  /** GitHub write failures (e.g. rate limit exhausted its retries) — caught inside run(). */
  failures: Array<{ issueNumber: number; error: string }>;
}

interface BuildToolsOptions {
  octokit: Octokit;
  owner: string;
  repo: string;
  dryRun: boolean;
  tally: Tally;
}

const RATE_LIMIT_SLEEP_MS = 1000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function buildTools({ octokit, owner, repo, dryRun, tally }: BuildToolsOptions) {
  const listUnverdictedTestCasesTool = betaZodTool({
    name: "list_unverdicted_test_cases",
    description:
      "Fetch every open test-case issue that doesn't yet have a feasibility:* label, with its full body. Call this exactly once at the start.",
    inputSchema: z.object({}),
    run: async () => {
      const testCases = await listUnverdictedTestCases(octokit, owner, repo);
      tally.totalFound = testCases.length;
      return JSON.stringify(testCases);
    },
  });

  // Defense-in-depth: `tool_choice.disable_parallel_tool_use` (set in index.ts) is the primary
  // guarantee that the model issues at most one submit_verdict call per turn, matching SPEC.md
  // §4.1's "never parallelize" requirement. This mutex serializes the actual GitHub writes
  // regardless, so the ordering guarantee below doesn't depend solely on that API option.
  let writeQueue: Promise<unknown> = Promise.resolve();

  const submitVerdictTool = betaZodTool({
    name: "submit_verdict",
    description:
      "Record one test case's feasibility verdict: posts the rationale comment, then applies the feasibility:* label. Call once per test case, one at a time.",
    inputSchema: z.object({
      // Plain z.number(): .int()/.positive() add exclusiveMinimum/maximum to the generated JSON
      // Schema, which Anthropic's strict tool-input validation (see `strict: true` below)
      // currently rejects with a 400 ("properties exclusiveMinimum, maximum are not supported").
      issueNumber: z.number(),
      verdict: z.enum(["automatable", "not-automatable"]),
      reason: z.string().min(1),
    }),
    // `strict: true` makes the API itself guarantee the input matches this schema — verdict
    // cannot be any value other than the two enum members (FEASIBILITY-CHECK-REVIEW.md finding
    // #1: this is enforced before the tool ever runs, not validated after the fact).
    strict: true,
    run: async ({ issueNumber, verdict, reason }) => {
      const task = writeQueue.then(async () => {
        const verdictText = verdict === "automatable" ? "Automatable" : "Not automatable";
        const label =
          verdict === "automatable" ? "feasibility:automatable" : "feasibility:not-automatable";

        if (dryRun) {
          console.log(`[dry-run] #${issueNumber}: ${verdictText} — ${reason}`);
          console.log(`[dry-run] #${issueNumber}: would apply label "${label}"`);
        } else {
          try {
            // Comment before label, matching feasibility-check-v2/apply_verdict.sh: the label
            // is what gates re-selection, so it must only land once the comment has already
            // landed (finding #3 — avoids permanently losing a rationale comment on a mid-issue
            // crash). github.ts already retries transient rate-limit errors on each call; a
            // throw here means those retries were exhausted.
            await postVerdictComment(octokit, owner, repo, issueNumber, verdictText, reason);
            await sleep(RATE_LIMIT_SLEEP_MS);
            await applyFeasibilityLabel(octokit, owner, repo, issueNumber, label);
            await sleep(RATE_LIMIT_SLEEP_MS);
          } catch (error) {
            tally.failures.push({
              issueNumber,
              error: error instanceof Error ? error.message : String(error),
            });
            // Rethrow so BetaToolRunner turns this into an is_error tool_result the model sees
            // (and can act on, e.g. move on to the next test case per the system prompt) —
            // this is not swallowed here, only recorded for the final human-visible summary.
            throw error;
          }
        }

        if (verdict === "automatable") tally.automatable++;
        else tally.notAutomatable++;
      });

      writeQueue = task.catch(() => {});
      await task;
      return `Recorded ${verdict} for #${issueNumber}.`;
    },
  });

  // betaZodTool wires its own `parse` from inputSchema; wrap it so a validation failure (the
  // model somehow still producing a bad enum/empty reason) is tallied by the harness itself
  // rather than only surfacing as a tool_result error the model has to notice and recover from.
  const originalParse = submitVerdictTool.parse;
  submitVerdictTool.parse = (args: unknown) => {
    try {
      return originalParse(args);
    } catch (error) {
      tally.rejected.push({
        issueNumber: (args as { issueNumber?: unknown } | null)?.issueNumber,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };

  return [listUnverdictedTestCasesTool, submitVerdictTool];
}
