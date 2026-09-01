import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // PGlite boots a WASM Postgres per suite; the default 5s is not enough.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
