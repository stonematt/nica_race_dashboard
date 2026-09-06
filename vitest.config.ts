/**
 * The default lane — what `pnpm test` runs, and what CI will run.
 *
 * It reads no fixture payloads. Tests that need real rows carry `.local.test.ts`
 * and are excluded here by name; run them with `pnpm test:local`. See
 * vitest.shared.ts for why the split is by what a test reads.
 */

import { configDefaults, defineConfig } from 'vitest/config';
import { LOCAL_ONLY_GLOB, sharedPlugins, sharedTestConfig } from './vitest.shared.ts';

export default defineConfig({
  plugins: sharedPlugins,
  test: {
    ...sharedTestConfig,
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    // configDefaults.exclude carries node_modules, dist and friends; dropping it
    // to write this one entry would quietly pull in every dependency's tests.
    exclude: [...configDefaults.exclude, LOCAL_ONLY_GLOB],
  },
});
