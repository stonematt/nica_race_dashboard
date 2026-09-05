/**
 * The two test lanes, asserted against vitest's own file collection.
 *
 * The fidelity suites (#23, #25) will read minors' names out of `fixtures/`.
 * They must land outside the default suite by construction, not because
 * somebody remembered a tag — and the way that goes wrong is silent: a glob
 * that stops matching, a config edit that drops an exclude, and the local lane
 * quietly starts running wherever `pnpm test` runs.
 *
 * So this asks vitest to list the files each config would run, rather than
 * re-implementing glob matching and testing the re-implementation.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../src/lib/fixtures.ts';

const SENTINEL = 'src/lib/fixtures.local.test.ts';

/** The files a config would run, exactly as vitest resolves them. */
function collect(config: string): string[] {
  const run = spawnSync(
    process.execPath,
    [
      join(repoRoot(), 'node_modules', 'vitest', 'vitest.mjs'),
      'list',
      '--filesOnly',
      '--config',
      config,
    ],
    { cwd: repoRoot(), encoding: 'utf8' },
  );
  expect(run.status, run.stderr).toBe(0);
  return run.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.test.ts') || line.endsWith('.test.tsx'));
}

describe('the default lane', () => {
  const files = collect('vitest.config.ts');

  it('runs no test that reads the corpus', () => {
    expect(files.filter((file) => file.includes('.local.test.'))).toEqual([]);
  });

  it('does not run the local lane’s sentinel', () => {
    expect(files).not.toContain(SENTINEL);
  });

  it('still runs the ordinary suite', () => {
    expect(files).toContain('src/lib/fixtures.test.ts');
    expect(files.length).toBeGreaterThan(5);
  });
});

describe('the local lane', () => {
  const files = collect('vitest.local.config.ts');

  it('is invocable on its own and runs the corpus tests', () => {
    expect(files).toContain(SENTINEL);
  });

  it('runs nothing but corpus tests', () => {
    expect(files.filter((file) => !file.includes('.local.test.'))).toEqual([]);
  });

  it('has its own script, separate from `pnpm test`', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot(), 'package.json'), 'utf8'));
    expect(pkg.scripts.test).toBe('vitest run');
    expect(pkg.scripts['test:local']).toContain('vitest.local.config.ts');
  });
});
