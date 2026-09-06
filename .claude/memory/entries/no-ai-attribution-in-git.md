---
name: "no-ai-attribution-in-git"
description: "Git history must carry no AI attribution — no Co-Authored-By, no bot contributors"
type: "constraint"
date: "2026-08-13"
---

The repository owner requires that nothing in the project's public record indicates
AI involvement. This is an explicit instruction, not an inference, and it overrides
the default agent behaviour of appending a co-author trailer.

Concretely, none of the following may ever appear in a commit message, PR body,
code comment, or file:

- `Co-Authored-By: Claude <noreply@anthropic.com>` — or any `Co-Authored-By:` trailer
- `Generated with Claude Code` or similar
- A robot emoji used as an AI marker

The consequence to watch for: GitHub builds the contributors list from commit
trailers, so a single stray `Co-Authored-By` permanently adds a bot to the
repository's contributor graph. Verify with `git log --format='%an %ae%n%b'`
before pushing a batch of commits.

Note that this constrains *attribution*, not tooling. `.claude/` is committed on
purpose — the skills and memory system are project infrastructure that any
contributor benefits from.

Related: [[monochrome-design-constraint]]
