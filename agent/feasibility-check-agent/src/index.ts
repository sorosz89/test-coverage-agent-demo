import Anthropic from "@anthropic-ai/sdk";
import { createOctokit, resolveOwnerRepo } from "./github.js";
import { SYSTEM_PROMPT } from "./prompt.js";
import { buildTools, type Tally } from "./tools.js";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const { owner, repo } = resolveOwnerRepo();
  const octokit = createOctokit();
  const client = new Anthropic();

  const tally: Tally = { totalFound: 0, automatable: 0, notAutomatable: 0, rejected: [], failures: [] };
  const tools = buildTools({ octokit, owner, repo, dryRun, tally });

  console.log(`feasibility-check-agent: ${owner}/${repo}${dryRun ? " (dry run)" : ""}`);

  const runner = client.beta.messages.toolRunner({
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    // At most one submit_verdict per turn — the primary enforcement of SPEC.md §4.1's "never
    // parallelize" rule (the write-mutex in tools.ts is defense-in-depth on top of this).
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
    messages: [
      {
        role: "user",
        content:
          "Fetch the unverdicted test cases and judge each one, one at a time, per your instructions.",
      },
    ],
    tools,
    // Safety cap: 1 (list) + up to ~90 (one submit_verdict per issue) + a little slack.
    max_iterations: 110,
  });

  const finalMessage = await runner.runUntilDone();

  // The model's own final reply (e.g. which issues it was told to skip after an error, per the
  // "If a tool call errors" section of the system prompt) — previously discarded entirely, so
  // any narration the model produced never reached whoever ran this.
  const finalText = finalMessage.content
    .filter((block) => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n");
  if (finalText) {
    console.log("\n--- Model's final message ---");
    console.log(finalText);
  }

  console.log("\n--- Summary ---");
  if (tally.totalFound === 0) {
    console.log("No unverdicted test cases found — nothing to do.");
  } else {
    const processed = tally.automatable + tally.notAutomatable;
    console.log(`found:           ${tally.totalFound}`);
    console.log(`automatable:     ${tally.automatable}`);
    console.log(`not-automatable: ${tally.notAutomatable}`);
    if (processed < tally.totalFound) {
      console.log(`unresolved:      ${tally.totalFound - processed} (see failures/rejected below)`);
    }
  }
  if (tally.failures.length > 0) {
    console.log(`write failures:  ${tally.failures.length}`);
    for (const { issueNumber, error } of tally.failures) {
      console.log(`  #${issueNumber}: ${error}`);
    }
  }
  if (tally.rejected.length > 0) {
    console.log(`rejected inputs: ${tally.rejected.length}`);
    for (const { issueNumber, error } of tally.rejected) {
      console.log(`  #${issueNumber}: ${error}`);
    }
  }

  // Surface failures via exit code too, not just console text — a caller (CI, cron, a human
  // reading `$?`) shouldn't have to scrape stdout to know something needs attention.
  if (tally.failures.length > 0 || tally.rejected.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
