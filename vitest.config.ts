import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // PGlite boots a WASM Postgres per suite; the default 5s is not enough.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    server: {
      deps: {
        // next-auth reaches for `next/server`, which resolves through Next's
        // exports map. Left external, Node resolves it itself and fails. Inline
        // it so Vite does the resolving and src/middleware.ts stays importable
        // from a test.
        inline: [/next-auth/, /@auth\/core/],
      },
    },
  },
});
