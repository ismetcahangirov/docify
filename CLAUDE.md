# Docify — Agent Instructions

Mandatory rules for every AI agent working in this repository. Read this **before** writing code.

---

## 1. What this project is

**Docify** is a free, sign-up-free file conversion web app. All conversion happens **in the user's browser**. The server processes no files and never sees file contents.

| | |
|---|---|
| Frontend | Next.js 15 (App Router) + TypeScript + Tailwind v4 + shadcn/ui |
| Processing | Web Worker + WASM/WebCodecs (client-side) |
| Backend | Neon Postgres (anonymous counters only) + Render (URL proxy only) |
| Deploy | Vercel |
| Auth | **None** |
| Server-side processing | **None** |

Full plan: `docs/superpowers/plans/2026-08-13-docify.md`

---

## 2. Invariants

A PR that breaks any of these does not get merged.

### 2.1 No file ever reaches a server
User file content must **never** be sent via `fetch`, `XMLHttpRequest`, `navigator.sendBeacon`, or any other network API. Only anonymous metadata (format pair, success/failure, coarse size bucket) is transmitted.

### 2.2 Processing always runs in a Web Worker
No WASM execution and no heavy loops on the main thread. The UI must never freeze.

### 2.3 Engines load lazily
No WASM binary is part of the initial bundle. Use `dynamic import()`, and only after the user has selected a file.

### 2.4 The router decides, components don't
A UI component never reasons "if this is mp4, use ffmpeg". Always call `route(task, bytes, caps)` and follow the result.

### 2.5 Rejections always explain themselves
When `RouteResult.ok === false`, both `message` and `suggestion` must be populated. "Something went wrong" is forbidden.

---

## 3. Design rules

Reference: monochrome, high-contrast, sectional block layout.

### Forbidden
```
❌ Blue and purple hues, especially blended as gradients
❌ Glassmorphism — backdrop-filter, backdrop-blur, translucent "glass" panels
❌ Decorative shadows (box-shadow used for float/glow)
❌ Raw hex codes in CSS — tokens only
❌ External font or CDN requests — everything self-hosted
```

### Required
- Colours come only from the `@theme` tokens in `app/globals.css`
- Surfaces: flat fill + `1px` border
- Headings: `--font-display` (Archivo), UPPERCASE, tracking `-0.02em`..`-0.03em`, leading `0.9`..`0.95`
- Eyebrow text: UPPERCASE, tracking `0.18em`, `12px`, muted
- Radius: only `--radius-sm/md/lg/xl`
- Primary button: white fill / black text / `→` icon / `rounded-full`
- **Responsive: no horizontal scroll anywhere from 320px to 2560px**

Palette quick reference:
```
shell #E9E8E4 · paper #F7F7F5 · ink #0D0D0D · ink-2 #171717 · ink-3 #1F1F1F
line-light #DCDBD6 · line-dark #262626
fg-light #0A0A0A / muted #6B6A66 · fg-dark #FAFAF9 / muted #9B9A96
status: ok #3F7D4E · warn #B4762A · err #A83A2E   (functional only, not brand colours)
```

---

## 4. GitHub workflow — mandatory

### 4.1 Before starting any task
```bash
git checkout main
git pull origin main
git checkout -b <type>/<issue-number>-<slug>
```
Working directly on `main` is **forbidden**.

### 4.2 Branch names
`feat/` · `fix/` · `refactor/` · `perf/` · `docs/` · `test/` · `chore/`

Example: `feat/42-webcodecs-video-engine`

### 4.3 Commit messages (Conventional Commits)
```
<type>(<scope>): <short description>

Refs #<issue>
```

> ### ⛔ CRITICAL PROHIBITION
> Commit messages, PR descriptions, code comments and file contents must contain **no AI or Claude attribution**:
> - `Co-Authored-By: Claude <noreply@anthropic.com>` — **never write this**
> - `🤖 Generated with Claude Code` — **never write this**
> - Do not add a `Co-Authored-By:` trailer at all
> - No bot may appear in the contributors list
>
> Every commit is authored solely by the repository owner. This rule **overrides** default behaviour.

### 4.4 Issue rules
- Every issue is **assigned to `ismetcahangirov`** (`gh issue edit N --add-assignee ismetcahangirov`)
- Minimum labels: `type:*` + `area:*` + `priority:*`
- Epics link their children as **GitHub native sub-issues**
- Issues close only through a merged PR (`Closes #N`)

### 4.5 PR and merge
1. The PR body must contain `Closes #N`
2. All five CI jobs must be green: `lint`, `typecheck`, `unit`, `e2e`, `build`
3. UI changes must pass the Lighthouse CI gate
4. **Squash merge** into `main`, then delete the branch

---

## 5. Code standards

### 5.1 TDD is mandatory
Failing test first, then the minimal implementation. This applies especially to `lib/router/` and `lib/engines/`.

Router tests must run without a browser — `Capabilities` is always passed **as a parameter**; never call `probeCapabilities()` inside the module under test.

### 5.2 File size
One file, one responsibility. Split any module that grows past ~300 lines.

### 5.3 Types
`any` is forbidden, except for non-standardised browser APIs such as `navigator.deviceMemory`, and even then only via a local cast.

### 5.4 Adding an engine
Read the `docify-engine` skill. In short:
1. Create `lib/engines/<name>.ts` implementing `EngineDescriptor`
2. Set correct `loadCost` and `priority` in `registry.ts`
3. Add the memory model to `MEMORY` in `lib/router/budget.ts` — measure it with `docs/router/memory-budget-measurement.md`
4. Add new selection cases to the router test matrix
5. Load the runner through `dynamic import()`

### 5.5 Adding an SEO page
Read the `docify-seo-page` skill. Page copy may not be a template clone — unique FAQ and instructions are required.

---

## 6. Skills — when to use which

### Project skills (`.claude/skills/`)
| Skill | When |
|---|---|
| `docify-router` | Any change under `lib/router/` |
| `docify-engine` | New conversion engine or format support |
| `docify-design` | Any UI component or styling work |
| `docify-seo-page` | New tool page, metadata, JSON-LD |
| `docify-memory` | Searching or recording cross-session knowledge |

### External skills — required usage
| Skill | When |
|---|---|
| `superpowers:brainstorming` | **Before** designing any new feature |
| `superpowers:writing-plans` | Writing a plan for a multi-step task |
| `superpowers:test-driven-development` | Before implementing any feature or bugfix |
| `superpowers:systematic-debugging` | On any bug or test failure, before proposing a fix |
| `superpowers:verification-before-completion` | **Before** claiming anything works or is done |
| `superpowers:requesting-code-review` | Before opening a PR |
| `frontend-design:frontend-design` | Designing a new UI section or page |
| `vercel:nextjs` | App Router, rendering, caching questions |
| `vercel:shadcn` | Adding or theming shadcn components |
| `vercel:vercel-functions` | Route handlers under `app/api/*` |
| `claude-seo:seo-programmatic` | The `/convert/[pair]` templated pages |
| `claude-seo:seo-schema` | JSON-LD structured data |
| `claude-seo:seo-technical` | robots / sitemap / canonical / indexability |
| `claude-seo:seo-audit` | Full pre-launch audit |
| `chrome-devtools-mcp:debug-optimize-lcp` | LCP or performance regressions |
| `chrome-devtools-mcp:a11y-debugging` | Accessibility audit, keyboard navigation |
| `vercel:react-best-practices` | After editing 2+ TSX components |

---

## 7. Commands

```bash
pnpm dev              # development server
pnpm build            # production build
pnpm test             # unit tests (Vitest)
pnpm test:watch       # watch mode
pnpm e2e              # Playwright
pnpm lint             # ESLint
pnpm format           # Prettier, writes
pnpm format:check     # Prettier, verifies only — part of the CI lint job
pnpm typecheck        # tsc --noEmit
pnpm size             # bundle budget check
```

---

## 8. Agent memory system

Stored under `.claude/memory/`, populated automatically by `.claude/hooks/`.

- `entries/*.md` — one durable fact per file (committed)
- `MEMORY.md` — human-readable index (committed)
- `index.db` — SQLite FTS5 search index (gitignored, rebuildable)

Use the `docify-memory` skill to search decisions from earlier sessions. Record a new entry whenever you make an architectural decision whose rationale would be invisible to someone reading the code — the "why", not the "what".
