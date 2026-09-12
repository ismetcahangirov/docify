---
name: "deployment-runs-on-three-free-tiers"
description: "Where Docify is deployed, which variable belongs to which environment, and the two scopings that are not oversights"
type: "reference"
date: "2026-09-12"
---

Deployed 2026-09-12. Three providers, all on free tiers, no payment method on any of them.

| Piece | Where | Identifier |
| --- | --- | --- |
| App | Vercel, project `docify-convert`, region `fra1` | https://docify-convert.vercel.app |
| URL proxy | Render, Frankfurt, free | `srv-dailfa7qj5pc73ajqing` |
| Counters | Neon, `eu-central-1`, database `neondb` | pooled endpoint |

The origin is a free subdomain rather than a bought domain, and the Vercel **project name is what claims it** — rename the project and every canonical tag on the site points at a host somebody else controls. `docify.vercel.app` and `docify-app.vercel.app` were already taken. The reasoning is in `lib/seo/site.ts`; `test/seo/site-origin.test.ts` asserts there is no second copy of the string.

## The two scopings that look like mistakes

**`NEXT_PUBLIC_PROXY_URL` is Production only.** A preview is served from `docify-convert-<hash>-<team>.vercel.app`, which is not in the proxy's `ALLOWED_ORIGINS`. Setting it for Preview renders a control that answers 403 every time; left unset the control does not render at all, and a preview is an ordinary Docify without URL import.

**`GOOGLE_SITE_VERIFICATION` and `BING_SITE_VERIFICATION` are Production only.** A preview deployment carrying an ownership tag is a second address claiming to own the property.

`DATABASE_URL` is the one variable that belongs in all three environments.

## Consequences of the free tiers

- **Render sleeps** after 15 minutes without traffic; the first import afterwards waits about a minute. Acceptable because the service holds no state and the feature is opt-in. `autoDeploy: false`, so every deploy of it is a decision — `render deploys create <id> --wait --confirm` from the CLI.
- **Vercel Hobby** has no card attached, so it cannot bill; exceeding included usage pauses rather than charges. The number to watch is bandwidth: `public/vendor/` is 42 MB, of which `ffmpeg-core.wasm` is 31 MB. That path is last-resort by design ([[webcodecs-over-ffmpeg]]), which is what keeps it off the common path.
- **Search Console uses a URL-prefix property**, not a domain property: a domain property needs a DNS TXT record and `vercel.app` is not our zone. Bing is verified the same way, with its own token.

Moving to a bought domain later is the literal in `lib/seo/site.ts`, the allowlist in `render.yaml`, and a redirect.

Related: [[backend-outage-and-misconfiguration-are-the-same-answer]], [[no-server-side-processing]], [[analytics-count-views-never-visitors]]
