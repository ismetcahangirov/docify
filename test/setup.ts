import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library only auto-cleans when globals are enabled; this project keeps
// imports explicit, so unmount between tests here instead.
afterEach(() => {
  cleanup()
})
