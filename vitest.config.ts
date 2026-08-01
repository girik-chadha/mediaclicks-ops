import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  test: {
    // The Phase 1 suite is pure logic (the permission matrix). No DOM, no DB —
    // that is a property of the design, not a limitation of the harness:
    // can() is synchronous and side-effect free precisely so it can be tested
    // exhaustively without either.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // See tests/stubs/server-only.ts for why.
      'server-only': fileURLToPath(new URL('./tests/stubs/server-only.ts', import.meta.url)),
    },
  },
})
