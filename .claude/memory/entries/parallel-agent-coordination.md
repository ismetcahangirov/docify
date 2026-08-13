---
name: parallel-agent-coordination
description: Four hazards when several agents work one repo at once — shared scratchpad, stale conditional rules, lockfile conflicts, merge order
type: process
date: 2026-08-13
---

Learned running EPIC 1's five tasks (#4, #5, #6, #7, #11) as parallel agents in
separate git worktrees. Everything below cost real rework; none of it is
theoretical.

**1. Give every agent its own scratchpad path.** The scratchpad directory is
shared across sibling agents. One agent's saved PR-body file was overwritten
mid-task by another agent's content. It caught the swap and re-fetched the live
body, but an agent that blind-writes a PR body from a fixed filename will publish
a different issue's text. Namespace the path per agent, or have each write only
to a filename containing its issue number.

**2. A "do X if no longer referenced" rule must be re-evaluated by whichever PR
merges *last*.** `scripts/ci-stub.mjs` was a temporary stand-in for `pnpm test`
and `pnpm e2e`. Both #5 and #6 were told to delete it once nothing referenced it.
Both applied the rule correctly — and both evaluated it against a `main` where
the sibling's change had not landed, so each saw the other's reference and
deferred. The file would have survived as dead code that no issue owned. The rule
was right; what was missing was telling them to re-check the condition after
rebasing onto the updated `main`. Conditional cleanup needs a named owner *or* a
re-evaluation step, not just a condition.

**3. Never hand-resolve `pnpm-lock.yaml`.** Every parallel branch that adds a
dependency conflicts there. Take either side, run `pnpm install`, commit the
regenerated file. Hand-merging a lockfile produces a tree that installs
differently from what anyone tested.

**4. Merge order is a decision, not an accident.** Anything that reformats or
rewrites files wholesale — a Prettier sweep, a codemod, a rename — lands *last*,
after the branches it would collide with. Correspondingly, tell that agent not to
run the repo-wide sweep as part of its PR: adding the tooling and sweeping with it
are two changes, and only the first is safe while other branches are open.

Related: [[pr-open-checklist]], [[no-ai-attribution-in-git]]
