import { SectionBlock } from '@/components/blocks/section-block'
import { SITE_NAME } from '@/lib/seo/site'

/*
 * The site footer (issue #267): the claim the product is built on, and the two
 * places a reader might want next.
 *
 * A dark block, so the stack of every page ends on the same tone the hero
 * opened on — and `asChild`, so the landmark is the panel itself with no
 * wrapper between the shell and the `<footer>`.
 *
 * ## No external links
 *
 * There is nothing off-site to link to: no company page, no social account,
 * no status page. A footer that invented some would be sending visitors away
 * for nothing, and every off-site link is one more place a privacy claim has
 * to be re-checked. `/llms.txt` is here because it is the one page on the
 * site written for a machine rather than a person, and a person still has to
 * be able to find it.
 */
const linkClass = [
  '-mx-2 inline-flex min-h-11 items-center px-2',
  'text-body underline-offset-4 hover:underline',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
].join(' ')

export function SiteFooter() {
  return (
    <SectionBlock variant="dark" asChild className="mb-6">
      <footer data-slot="site-footer" className="flex min-w-0 flex-col gap-8">
        <p className="max-w-2xl text-body text-fg-dark-mut">
          Every conversion runs in your own browser. No file is ever uploaded, and nothing about it
          is sent anywhere.
        </p>

        <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <nav aria-label="Footer">
            <ul className="flex list-none flex-wrap gap-x-6 gap-y-2">
              <li>
                <a href="/convert" className={linkClass}>
                  Converters
                </a>
              </li>
              <li>
                <a href="/llms.txt" className={linkClass}>
                  llms.txt
                </a>
              </li>
            </ul>
          </nav>

          <p className="text-eyebrow uppercase text-fg-dark-mut">© {SITE_NAME}</p>
        </div>
      </footer>
    </SectionBlock>
  )
}
