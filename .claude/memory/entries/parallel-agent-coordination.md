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

**5. A new gate is green on its own branch and says nothing about `main`.** #139
added the design-lint gate on a branch cut before #138 landed the Canvas engine,
so its CI judged a tree that did not contain `canvas-runner.ts`. Both PRs passed;
`main` went red the moment they met, and every branch rebasing onto it inherited
the failure. Nothing in the pipeline could have caught it — the gate had never
been run against the code it now judges.

This is hazard 2 turned inside out. There the rule was evaluated too early
against a condition; here the *rule itself* arrived after the code it governs.
The fix is the same shape: before merging a PR that adds any repo-wide check —
a linter, a budget, a schema validator — rebase it onto current `main` and run it
there. Not on the branch. On what it will actually police.

Corollary worth keeping: when the new gate then flags existing code, the first
question is whether the gate or the code is wrong. `#ffffff` in an image engine
is a canvas fill, not a UI colour, so neither an exclusion nor a suppression
directive was the answer — the value was respelled as a CSS keyword and the rule
stayed absolute. An escape hatch added the first time a rule is inconvenient is
the hatch everyone uses afterwards.

Related: [[pr-open-checklist]], [[no-ai-attribution-in-git]], [[libheif-is-primary-broken]]
