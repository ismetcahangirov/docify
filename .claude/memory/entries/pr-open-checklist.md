---
name: pr-open-checklist
description: Opening a PR is four steps, not one — code review, PR labels, issue status label, then the PR itself
type: process
date: 2026-08-13
---

`CLAUDE.md` §4.5 lists what a PR must *contain*, but not what must *happen* around
it. The gap was found on PR #107 (the Next.js scaffold), which was opened with a
correct body and green CI but with no labels, no `status:needs-review` on its
issue, and no code review — all three are required and none of them are visible
from the PR template.

The full sequence, in order:

1. **Code review before pushing the PR.** `superpowers:requesting-code-review` is
   mandatory per `CLAUDE.md` §6. Dispatch a reviewer subagent against
   `origin/main...<branch>` and act on Critical/Important findings *before* the
   PR is opened, not after. The repo has a single human owner, so GitHub's own
   reviewer assignment cannot substitute — this subagent pass *is* the review.
2. **Open the PR** with `Closes #N` in the body and the template filled in.
3. **Mirror the issue's labels onto the PR**, plus `status:needs-review`:
   `gh pr edit <n> --add-label "type:*,area:*,priority:*,size:*,status:needs-review"`.
   PRs do not inherit labels from the issue they close.
4. **Mark the issue** `gh issue edit <n> --add-label status:needs-review`, so the
   issue list shows what is in flight versus what is still pickable.

On merge, `status:needs-review` disappears with the closed issue — there is no
cleanup step.

Step 1 scales with the change. A subagent review earns its cost on anything that
executes — config, workflows, application code. On a documentation-only change of
a file or two, reviewing it inline and saying so in the PR body is the honest
call; dispatching an agent to read one Markdown file is theatre, not diligence.
Steps 2-4 have no such exemption: they take seconds and the tracker is wrong
without them.

Milestones and Projects are not configured in this repo; do not invent them.

Related: [[no-ai-attribution-in-git]], [[parallel-agent-coordination]]
