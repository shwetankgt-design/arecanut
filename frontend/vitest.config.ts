import { defineConfig } from 'vitest/config'

// Deliberately separate from vite.config.ts — that one wires up the PWA
// plugin (service worker generation, manifest, etc.) which has no business
// running under the test runner. Kept minimal: these are unit tests for
// pure logic (queue state machines, error classification), not component
// or DOM tests, so no jsdom environment is configured either.
export default defineConfig({
  test: {
    setupFiles: ['fake-indexeddb/auto'],
  },
})
