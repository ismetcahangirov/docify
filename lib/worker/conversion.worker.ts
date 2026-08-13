/**
 * The worker entry point. This module runs on the worker thread and nowhere
 * else — importing it from the main thread would attach Comlink's listener to
 * `window`.
 *
 * It stays deliberately three lines long. Everything a test would want to reach
 * lives in `./api`, and everything heavy is reached from there through
 * `await import()`, so the chunk a bundler emits for this file is the shell
 * alone: no engine, no WASM (CLAUDE.md §2.2, §2.3).
 */

import * as Comlink from 'comlink'

import { createConversionApi } from './api'

// No endpoint argument: inside a worker Comlink defaults to `self`, which is
// the port the spawning thread holds the other end of.
Comlink.expose(createConversionApi())
