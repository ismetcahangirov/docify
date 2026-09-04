/**
 * The Lighthouse gate — `pnpm lighthouse`, and the `lighthouse` CI job.
 *
 * ## What this adds that the other gates do not
 *
 * `pnpm size` weighs the bundle, `e2e/vitals.spec.ts` measures LCP, CLS and
 * blocking time in a real browser, and `e2e/a11y.spec.ts` runs axe. Lighthouse
 * overlaps all three and is still worth running, because it is the *scoring*
 * the outside world uses: PageSpeed Insights, a Vercel deploy summary and every
 * report anybody will ever send about this site are this number. A gate that
 * measures the right things and disagrees with the number everyone quotes is a
 * gate somebody will eventually argue with.
 *
 * It also carries a category the others have none of. `categories:seo` checks
 * things no unit test can see from inside the repository: that the rendered
 * document has a title and a meta description, that its links are crawlable,
 * that it is not blocked by robots.txt, and that the viewport is set.
 *
 * ## Why the URLs are three
 *
 * They are the page shapes: marketing, a hub, and a conversion page. The other
 * 123 conversion pages are the third one with different words in it, and
 * auditing all of them would spend twenty minutes of CI to learn the same
 * thing three times over.
 *
 * ## A Windows caveat
 *
 * `lhci autorun` finishes the audits and then fails on this platform, with
 * `EPERM` from chrome-launcher deleting its own temporary profile — Chrome
 * still holds the directory open. It is a chrome-launcher bug and not a
 * configuration problem; the CI job runs on Linux and is unaffected. To check
 * the assertions on Windows, run Lighthouse directly into `.lighthouseci/` and
 * then `pnpm exec lhci assert`.
 *
 * ## Why three runs each, and which one is asserted
 *
 * Lighthouse's own recommendation: a CI runner is a shared machine, and a
 * single run measures whatever else it was doing.
 *
 * The run that is *asserted* is set explicitly below, and it has to be. `lhci`
 * defaults to `optimistic`, which asserts the **best** of the three — so a
 * gate can be held up by one lucky run while the site is failing on the other
 * two. Measured here on 2026-09-04: the home page scored 0.97, 0.98 and 0.99
 * across its three runs, and `optimistic` reported 0.99. `median` is the only
 * aggregation that answers the question a gate is asking.
 */

/** The three shapes, on the port `pnpm start` uses. */
const ORIGIN = 'http://127.0.0.1:3000'

module.exports = {
  ci: {
    collect: {
      // A production build has to exist. `pnpm lighthouse` builds first; the CI
      // job reuses the build the `build` job would have made anyway.
      startServerCommand: 'pnpm start',
      startServerReadyPattern: 'Ready in',
      url: [`${ORIGIN}/`, `${ORIGIN}/convert`, `${ORIGIN}/convert/heic-to-jpg`],
      numberOfRuns: 3,
      settings: {
        // Headless, and with nothing carried over between runs. A CI runner has
        // no display and no profile, and a report that depended on either would
        // be a report nobody could reproduce.
        chromeFlags: '--headless=new --no-sandbox --disable-dev-shm-usage',
      },
    },
    assert: {
      /*
       * The typical run, not the luckiest one. `lhci`'s default is
       * `optimistic` — the best value across the runs — which is the right
       * default for a dashboard and the wrong one for a gate: it hides a
       * regression for as long as any single run still passes. See the note
       * above `numberOfRuns`.
       */
      aggregationMethod: 'median',

      assertions: {
        /*
         * Accessibility and SEO are perfect on all three pages today, and a
         * gate set anywhere below what is already true is a gate that permits a
         * regression. `error` on both.
         *
         * Lighthouse's `best-practices` category is deliberately not here. It
         * is advice about a *deployment* — HTTPS, console errors, deprecated
         * APIs — and half of it cannot be true of a run against localhost.
         */
        'categories:accessibility': ['error', { minScore: 1 }],
        'categories:seo': ['error', { minScore: 1 }],

        /*
         * Performance, and it has teeth now (issue #237).
         *
         * It was a warning because the score was 0.94 — one point under — and
         * the whole shortfall was Total Blocking Time from React hydrating
         * documents with no interactive component on them. Nothing in this
         * repository looked able to close that.
         *
         * The measurement was the problem, not the app. Those numbers came from
         * a Windows laptop, because `lhci autorun` cannot complete on Windows
         * (see the caveat above) and the figures were taken by hand from a
         * direct Lighthouse run. This gate has never run there. Measured on the
         * Linux runner it actually runs on, three runs per URL, on 2026-09-04:
         *
         *   /                      0.99   TBT  64ms   LCP 2231ms   CLS 0
         *   /convert               0.98   TBT  ~70ms  LCP 2318ms   CLS 0
         *   /convert/heic-to-jpg   0.98   TBT  71ms   LCP 2331ms   CLS 0
         *
         * TBT is 64-71ms against the 240-261ms the issue recorded. A laptop
         * running a browser, a dev server, an editor and a language server is
         * not four times slower than a CI runner in the way Lighthouse's fixed
         * 4x CPU multiplier assumes, and the difference landed entirely on the
         * one metric that measures main-thread contention.
         *
         * So: `error`, and the threshold stays 0.95. Not 0.98 — the runner's
         * own spread across three runs of the home page was 0.97 to 0.99, and a
         * gate set at the top of that band is a gate that fails on a busy
         * afternoon rather than on a regression. Three points of headroom is
         * what makes this assertable at all.
         */
        'categories:performance': ['error', { minScore: 0.95 }],

        /*
         * The floor underneath the score. These are the metrics issues #77, #78
         * and #79 set budgets for, asserted against Lighthouse's own
         * methodology rather than against `e2e/vitals.spec.ts`'s — the two
         * measure differently and both are worth having. The numbers are
         * Google's "good" thresholds, except CLS, which is this site's own
         * tighter 0.05 from #78 and measures 0.000 on all three URLs.
         *
         * They stay even though the category score above is now an error. A
         * score is a weighted average and it can stay green while one metric
         * walks: LCP on `/convert/heic-to-jpg` is 2331ms against a 2500ms limit,
         * which is 169ms of headroom and the tightest number on this page. The
         * score would not notice that closing.
         *
         * FCP is new here (#237). It measures 761-765ms across the three URLs,
         * nowhere near the 1800ms limit, and it was the one Core Web Vital the
         * floor did not name.
         */
        'first-contentful-paint': ['error', { maxNumericValue: 1800 }],
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],
        'total-blocking-time': ['error', { maxNumericValue: 300 }],
      },
    },
    upload: {
      // The reports stay on the runner and are uploaded as a build artifact.
      // The alternative is Google's temporary public storage, which publishes
      // the report at a URL anybody can read.
      target: 'filesystem',
      outputDir: './.lighthouseci',
    },
  },
}
