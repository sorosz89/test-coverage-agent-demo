#!/usr/bin/env python3
"""Reads all test-case issues via GitHub's GraphQL search API, computes the three
coverage metrics (SPEC.md §6), and renders report.html at the repo root from
template.html. Read-only except for the final local file write — no issue mutation,
so no write-rate-limit concern (SPEC.md §6)."""
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent


def run(cmd):
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit(f"command failed: {' '.join(cmd)}\n{result.stderr}")
    return result.stdout


def repo_root():
    return Path(run(["git", "rev-parse", "--show-toplevel"]).strip())


def owner_repo():
    url = run(["git", "remote", "get-url", "origin"]).strip()
    m = re.search(r"[:/]([^/]+)/([^/]+?)(\.git)?$", url)
    if not m:
        sys.exit(f"could not parse owner/repo from remote url: {url}")
    return m.group(1), m.group(2)


def fetch_issues(owner, repo):
    query = f"""
query($endCursor: String) {{
  search(query: "repo:{owner}/{repo} label:test-case", type: ISSUE, first: 100, after: $endCursor) {{
    nodes {{ ... on Issue {{ number title labels(first: 20) {{ nodes {{ name }} }} }} }}
    pageInfo {{ hasNextPage endCursor }}
  }}
}}
"""
    raw = run(["gh", "api", "graphql", "--paginate", "--slurp", "-f", f"query={query}"])
    pages = json.loads(raw)
    issues = []
    for page in pages:
        issues.extend(page["data"]["search"]["nodes"])
    return issues


def compute(issues):
    total = len(issues)
    automatable = 0
    not_automatable = 0
    automation_hist = {"none": 0, "planned": 0, "in-progress": 0, "implemented": 0}

    for issue in issues:
        names = [l["name"] for l in issue["labels"]["nodes"]]
        is_automatable = "feasibility:automatable" in names
        if is_automatable:
            automatable += 1
        elif "feasibility:not-automatable" in names:
            not_automatable += 1

        if is_automatable:
            for status in automation_hist:
                if f"automation:{status}" in names:
                    automation_hist[status] += 1
                    break

    implemented = automation_hist["implemented"]
    feasibility_pct = (automatable / total * 100) if total else 0
    effective_pct = (implemented / automatable * 100) if automatable else 0
    generic_pct = (implemented / total * 100) if total else 0

    return {
        "total": total,
        "automatable": automatable,
        "not_automatable": not_automatable,
        "implemented": implemented,
        "backlog": automatable - implemented,
        "feasibility_pct": feasibility_pct,
        "effective_pct": effective_pct,
        "generic_pct": generic_pct,
        "not_automatable_pct": (not_automatable / total * 100) if total else 0,
    }


def render(stats, owner, repo):
    template = (SKILL_DIR / "template.html").read_text()
    replacements = {
        "@@TOTAL@@": str(stats["total"]),
        "@@AUTOMATABLE@@": str(stats["automatable"]),
        "@@NOT_AUTOMATABLE@@": str(stats["not_automatable"]),
        "@@IMPLEMENTED@@": str(stats["implemented"]),
        "@@BACKLOG@@": str(stats["backlog"]),
        "@@FEASIBILITY_PCT@@": f"{stats['feasibility_pct']:.0f}",
        "@@EFFECTIVE_PCT@@": f"{stats['effective_pct']:.0f}",
        "@@GENERIC_PCT@@": f"{stats['generic_pct']:.0f}",
        "@@FEASIBILITY_PCT_PRECISE@@": f"{stats['feasibility_pct']:.1f}",
        "@@NOT_AUTOMATABLE_PCT_PRECISE@@": f"{stats['not_automatable_pct']:.1f}",
        "@@GENERIC_PCT_PRECISE@@": f"{stats['generic_pct']:.1f}",
        "@@GENERATED_AT@@": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "@@REPO@@": f"{owner}/{repo}",
    }
    for placeholder, value in replacements.items():
        template = template.replace(placeholder, value)
    return template


def main():
    owner, repo = owner_repo()
    issues = fetch_issues(owner, repo)
    stats = compute(issues)
    html = render(stats, owner, repo)
    out_path = repo_root() / "report.html"
    out_path.write_text(html)
    print(f"Wrote {out_path}")
    print(
        f"total={stats['total']} automatable={stats['automatable']} "
        f"implemented={stats['implemented']} "
        f"feasibility={stats['feasibility_pct']:.1f}% "
        f"effective={stats['effective_pct']:.1f}% "
        f"generic={stats['generic_pct']:.1f}%"
    )


if __name__ == "__main__":
    main()
