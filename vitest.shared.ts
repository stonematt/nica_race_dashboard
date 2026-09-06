/**
 * Test options both lanes share.
 *
 * There are two lanes and they are split by what a test READS, not by what it
 * asserts (issue #29). The default lane reads only code and synthetic data and
 * is safe to run anywhere, including CI on a public repo. The local-only lane
 * reads the real fixture corpus — minors' names, schools, grades and finish
 * times — and never runs in CI.
 *
 * Everything that is not that distinction belongs here, so the two configs
 * cannot drift into disagreeing about timeouts or module resolution.
 */

import react from '@vitejs/plugin-react';
import type { InlineConfig } from 'vitest/node';

/** Test files that read real payloads. Excluded from the default lane by name. */
export const LOCAL_ONLY_GLOB = '**/*.local.test.{ts,tsx}';

/**
 * `tsconfig.json` sets `jsx: "preserve"` because Next compiles JSX itself, so
 * under vitest esbuild falls back to the classic `React.createElement`
 * transform and any component under test dies with "React is not defined"
 * (issue #56). This plugin gives esbuild the automatic runtime instead, for
 * both lanes — go in the root `plugins` array, not under `test`.
 */
export const sharedPlugins = [react()];

export const sharedTestConfig = {
  environment: 'node',
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
} satisfies InlineConfig;
