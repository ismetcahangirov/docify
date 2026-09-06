---
name: "parallel-agent-coordination"
description: "Hazards when several agents work one repo at once — shared scratchpad, stale conditional rules, lockfile conflicts, merge order, scaffolding the shared surface first, the comments a rename leaves behind, resuming interrupted agents, and verifying the merged tree"
type: "process"
date: "2026-08-13"
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

**6. When N tasks share one artefact, build the artefact first — as its own
issue.** EPIC 5's five tasks were four operations of one `pdflib` engine plus one
`pdfjs` engine. Dispatched straight from the issue list, all four would have
authored `lib/engines/pdflib.ts`, an options type and a ZIP writer, and every
merge after the first would have been hand-resolved. Landing the shell first
(#147/#148 — both descriptors with their full `supports()` matrix, the operation
dispatch, the page-range grammar, the ZIP writer, and every dependency) reduced
the shared surface to *one `case` arm per issue*. Five branches then merged in
arrival order with **zero conflicts**, which is not luck: it is what is left when
the contested files are already on `main`.

Two things made that work beyond the scaffold itself. Dependencies went in with
the shell, so no branch touched `pnpm-lock.yaml` — hazard 3 disappears rather
than being managed. And each agent was told, by name, which files were not
theirs, with the instruction to report a wanted change rather than make it. Three
of the five came back with a shared-file change they had wanted and not made
(a duplicated `PDFDocument.load` guard, two `EXPANSION` factors that do not model
what their engine actually holds), which is how a coordinator finds out about
a design gap instead of finding out about a merge conflict.

**7. A scaffold that claims work it cannot do must fail loudly, and the last
branch cleans it up.** The shell's dispatch threw `cannot run the "split"
operation yet — issue #39 implements it` rather than returning an empty document,
because an empty PDF downloads as a *successful* conversion. The placeholder and
its test then behaved exactly like hazard 2's conditional cleanup: each landing
issue moved the "not implemented" assertion to another arm, and the last one
found no arm left, deleted the helper and rewrote the test. That worked because
the condition was written into the code as a comment addressed to whoever landed
next — not left implicit.

**8. When one branch renames what another branch's comments describe, the
comments belong to neither PR — and the coordinator owns them.** #154, #155 and
#156 ran in parallel and merged with zero conflicts. #155 replaced `EXPANSION`
with `MEMORY` and gave `route()` a multi-file input; #156 owned the three pdf-lib
operation files, whose header comments described the old table and asserted
"`route()` … has no multi-file caller yet". Neither agent could fix them: #155
was told those files were not its own and correctly reported the problem instead
of reaching into them, and #156 finished before the change that falsified them
existed. Both were right, and `main` still ended up carrying three false
comments.

This is hazard 2 again — a cleanup with a condition and no owner — but it does
not announce itself, because nothing breaks. A compiler catches a renamed symbol;
it does not catch a renamed symbol inside a comment. The fix is not a rule for
the agents, it is a step for whoever merges last: after the final branch lands,
grep `main` for the identifiers the run removed. It took one `grep -rn EXPANSION
lib/` to find all three (#162).

The corollary is that ownership boundaries produce a *report*, not silence. Three
of five agents in EPIC 5 came back with a wanted-but-not-made change; three of
three did here (#160, #164, #165, plus #166 and #167 from reviews). Those reports
are the deliverable of the boundary, and they are worthless if the coordinator
reads them as closing remarks instead of filing them.

**9. An interrupted agent is not a lost agent — but a resumed one has a stale
`main`.** Running #160, #164, #165, #166 and #167, the parent process exited with
three still working. Their worktrees and transcripts survived on disk, and all
three finished after being resumed from transcript. What made that safe was not
the resume, it was the briefing: each was told what had landed on `main` in the
meantime and what those PRs changed. #166 mattered most — it tests the encrypted
branch of `openPdf`, and #164 had rewritten that guard underneath it while it was
stopped. Resumed without that, its test could have gone green for a reason that
had stopped being true. Treat a resume as a new dispatch: restate the world.

**10. The merged tree is the only tree no CI judged — and the coordinator's
local build is not evidence about it.** Hazard 5 said a new gate must be run
against what it will police. The general form: five PRs each passed CI against a
`main` that lacked the other four, so the combination was verified by nobody
until it existed. Run the suite on the merge commit.

Do it from CI's vantage, not the local one. The local `pnpm build` failed here
with a `WasmHash._updateWithBuffer` TypeError deep inside webpack, deterministic
across two runs, and the tempting read was hazard 5 coming true. It was a stale
`.next` from before the run: removing it built clean, and CI — which always
builds from a fresh checkout — was green on the merge commit throughout. A
coordinator's working tree accumulates state five agents never had.

**11. `MEMORY.md` is generated from entry frontmatter, so editing it directly
does not stick.** #169 extended this entry's description in the index only. The
next hook run regenerated the index from `description:` in the entry file and the
extension silently vanished — it was still missing when this run started. Edit
the entry; let the index follow.

Related: [[pr-open-checklist]], [[no-ai-attribution-in-git]], [[libheif-is-primary-broken]], [[cancel-needs-a-macrotask-yield]], [[budget-is-affine-and-scoped]], [[abort-is-matched-by-name]], [[raster-ceilings-are-two-and-scoped]]
