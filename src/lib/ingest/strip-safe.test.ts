/**
 * Every ingest module loads under Node's native type stripping.
 *
 * `bin/fetch.ts`, `bin/normalize.ts` and `bin/seed.ts` run as plain `.ts` with
 * no build step (issue #6), which means Node strips the types rather than
 * compiling them. Strip-only mode cannot handle a TypeScript parameter
 * property, an `enum`, a `namespace` or a decorator — it throws
 * `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at import time.
 *
 * `tsc` is perfectly happy with all four, and so is vitest, which transpiles
 * before it runs. So neither the typecheck gate nor the rest of this suite can
 * see the failure: it appears only when someone runs the CLI. This test is the
 * one that can, and it exists because a parameter property in `columns.ts`
 * broke `node bin/normalize.ts` while every other gate stayed green.
 *
 * It spawns Node on purpose. Importing the modules in-process would prove
 * nothing, because vitest would have already transpiled them.
 *
 * Default lane: it imports modules, and reads no payloads.
 */

import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

const modules = readdirSync(import.meta.dirname)
  .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
  .sort();

describe('the ingest modules run with no build step', () => {
  it('finds the modules to check', () => {
    expect(modules.length).toBeGreaterThan(5);
  });

  it.each(modules)('%s imports under type stripping', async (name) => {
    // Importing has to actually happen — a syntax check would miss nothing
    // here, but the failure mode is at module evaluation.
    const { stdout } = await run(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(`./${name}`)}); console.log('ok');`,
      ],
      { cwd: import.meta.dirname },
    );

    expect(stdout.trim()).toBe('ok');
  });
});
