#!/usr/bin/env bash
# Posts a feasibility verdict for one issue: comment first, then label — in that
# order, so the label (which gates re-selection in SKILL.md §2) is only set once
# the rationale comment has already landed. If this script dies after the comment
# but before the label, the issue is simply reprocessed on the next run (a
# duplicate comment is cheap; a lost one is not recoverable from label state alone).
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "usage: apply_verdict.sh <issue_number> <automatable|not-automatable> <reason>" >&2
  exit 1
fi

issue="$1"
verdict="$2"
reason="$3"

case "$verdict" in
  automatable)
    label="feasibility:automatable"
    verdict_text="Automatable"
    ;;
  not-automatable)
    label="feasibility:not-automatable"
    verdict_text="Not automatable"
    ;;
  *)
    echo "invalid verdict '$verdict' — must be exactly 'automatable' or 'not-automatable'" >&2
    exit 1
    ;;
esac

if [[ -z "$reason" ]]; then
  echo "reason must not be empty" >&2
  exit 1
fi

gh issue comment "$issue" --body "**Verdict:** ${verdict_text} — **Reason:** ${reason}"
sleep 1

gh issue edit "$issue" --add-label "$label"
sleep 1
