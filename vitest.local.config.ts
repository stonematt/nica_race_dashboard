/**
 * The local-only lane — `pnpm test:local`.
 *
 * These tests read the real fixture corpus in `fixtures/`: minors' full names,
 * schools, grades, plates and finish times. That is why the lane exists and why
 * it is a separate config file rather than a tag someone has to remember to
 * apply. It runs on a developer's machine, with a human present, and nowhere
 * else.
 *
 * **This config must never be invoked from a GitHub Actions workflow.** Running
 * it needs the corpus, and putting the corpus where CI can reach it is the
 * decision #29 made and rejected. Adding it later needs a fresh decision, not a
 * one-line change.
 *
 * It fails, rather than skips, when the corpus is absent: a lane you only run
 * deliberately should tell you it found nothing to check.
 */

import { defineConfig } from 'vitest/config';
import { sharedTestConfig } from './vitest.shared.ts';

export default defineConfig({
  test: {
    ...sharedTestConfig,
    include: ['src/**/*.local.test.ts', 'scripts/**/*.local.test.ts'],
  },
});
