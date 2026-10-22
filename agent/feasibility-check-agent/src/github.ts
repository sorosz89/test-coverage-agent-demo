import { execSync } from "node:child_process";
import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";

export interface TestCase {
  number: number;
  title: string;
  body: string;
}

// SPEC.md §4.1: "Retry/backoff is the caller's job — check Retry-After /
// x-ratelimit-remaining, back off exponentially (~60s start) on secondary-limit errors."
const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 60_000;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRateLimitError(error: unknown): error is RequestError {
  if (!(error instanceof RequestError)) return false;
  if (error.status !== 403 && error.status !== 429) return false;
  const headers = error.response?.headers ?? {};
  if (headers["retry-after"]) return true;
  if (headers["x-ratelimit-remaining"] === "0") return true;
  return /rate limit/i.test(error.message);
}

function retryDelayMs(error: RequestError): number | undefined {
  const headers = error.response?.headers ?? {};
  if (headers["retry-after"]) {
    const seconds = Number(headers["retry-after"]);
    if (Number.isFinite(seconds)) return seconds * 1000;
  }
  if (headers["x-ratelimit-remaining"] === "0" && headers["x-ratelimit-reset"]) {
    const resetAtMs = Number(headers["x-ratelimit-reset"]) * 1000;
    const waitMs = resetAtMs - Date.now();
    if (waitMs > 0) return waitMs;
  }
  return undefined;
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  let backoff = INITIAL_BACKOFF_MS;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRateLimitError(error) || attempt >= MAX_RETRIES) throw error;
      const waitMs = retryDelayMs(error) ?? backoff;
      console.warn(
        `[retry] ${label}: secondary rate limit hit, waiting ${Math.round(waitMs / 1000)}s (attempt ${attempt}/${MAX_RETRIES})`,
      );
      await sleep(waitMs);
      backoff *= 2;
    }
  }
}

export function resolveOwnerRepo(): { owner: string; repo: string } {
  const url = execSync("git remote get-url origin").toString().trim();
  const match = url.match(/[:/]([^/]+)\/([^/]+?)(\.git)?$/);
  if (!match) {
    throw new Error(`could not parse owner/repo from remote url: ${url}`);
  }
  return { owner: match[1]!, repo: match[2]! };
}

function resolveGithubToken(): string {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return execSync("gh auth token").toString().trim();
}

export function createOctokit(): Octokit {
  return new Octokit({ auth: resolveGithubToken() });
}

/**
 * All test-case issues that don't yet carry a feasibility:* label. Folds the
 * "select" and "read" steps of the SKILL.md versions into one bulk, fully
 * paginated, read-only call — octokit.paginate walks every page itself, so
 * there's no equivalent of the bash skill's silent 30-issue default-limit
 * truncation (see FEASIBILITY-CHECK-REVIEW.md finding #4).
 */
export async function listUnverdictedTestCases(
  octokit: Octokit,
  owner: string,
  repo: string,
): Promise<TestCase[]> {
  const issues = await withRetry("list unverdicted test cases", () =>
    octokit.paginate(octokit.rest.issues.listForRepo, {
      owner,
      repo,
      labels: "test-case",
      state: "open",
      per_page: 100,
    }),
  );

  return issues
    .filter((issue) => !issue.labels.some((label) => (typeof label === "string" ? label : label.name)?.startsWith("feasibility:")))
    .map((issue) => ({ number: issue.number, title: issue.title, body: issue.body ?? "" }));
}

export async function postVerdictComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  verdictText: "Automatable" | "Not automatable",
  reason: string,
): Promise<void> {
  await withRetry(`comment on #${issueNumber}`, () =>
    octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `**Verdict:** ${verdictText} — **Reason:** ${reason}`,
    }),
  );
}

export async function applyFeasibilityLabel(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  label: "feasibility:automatable" | "feasibility:not-automatable",
): Promise<void> {
  await withRetry(`label #${issueNumber}`, () =>
    octokit.rest.issues.addLabels({
      owner,
      repo,
      issue_number: issueNumber,
      labels: [label],
    }),
  );
}
