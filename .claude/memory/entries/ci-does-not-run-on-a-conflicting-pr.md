---
name: ci-does-not-run-on-a-conflicting-pr
description: A PR with no checks at all is usually a merge conflict, not a stuck runner — GitHub never starts CI on one
type: gotcha
date: 2026-08-31
---

`gh pr checks <n>` answering `no checks reported on the '<branch>' branch` reads
like a CI outage. Twice in the #176–#182 run it was not: GitHub does not run a
`pull_request` workflow on a PR whose merge commit cannot be computed, so a
branch that has fallen behind `main` and now conflicts sits with **zero** checks
rather than with a failing one.

The tell is that `gh pr checks` reports nothing at all, as opposed to reporting
jobs that are queued or failed. Confirm with:

```bash
gh pr view <n> --json mergeable --jq .mergeable   # CONFLICTING
```

The fix is the ordinary one — `git fetch origin main && git rebase origin/main`,
resolve, `git push --force-with-lease` — after which the checks appear within
about a minute. Closing and reopening the PR does *not* help; the conflict is
the cause, not a missed webhook.

This bites hardest when several branches are open against one fast-moving
`main`, which is exactly the shape of a multi-issue run: #190 conflicted on
`lib/engines/pdf-open.ts` after [[abort-is-matched-by-name]] landed the shared
matcher, and #195 conflicted on
`docs/router/memory-budget-measurement.md` because the PR merged before it edited
the same "what the model still cannot see" list. Both were one-hunk resolutions;
neither was visible until the mergeability was checked directly. See
[[parallel-agent-coordination]] for the wider set of hazards this belongs to, and
[[pr-open-checklist]] for what else has to happen around a PR.
