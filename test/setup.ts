import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

/*
 * jsdom implements no layout and therefore no scrolling: `scrollIntoView` is
 * simply absent from Element, and a component that calls it throws here while
 * working perfectly in every browser. A no-op stands in for it, so a test that
 * cares can spy on it and every test that does not is unaffected.
 *
 * Guarded on `Element` itself because this file is also the setup for the
 * suites that run in the node environment, where there is no DOM at all.
 */
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollIntoView !== 'function') {
  Element.prototype.scrollIntoView = function scrollIntoView() {}
}

// Testing Library only auto-cleans when globals are enabled; this project keeps
// imports explicit, so unmount between tests here instead.
afterEach(() => {
  cleanup()
})
