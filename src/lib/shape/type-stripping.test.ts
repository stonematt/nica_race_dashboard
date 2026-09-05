/**
 * The stripper runs with no build step, the way `bin/*.ts` do.
 *
 * `node src/lib/shape/strip.ts` is how the shape corpus is regenerated when the
 * real corpus grows — there is no package script, because `package.json` is not
 * this lane's to edit. So "it imports under Node's native type stripping" is
 * not a nicety here, it is the entire entry point.
 *
 * Strip-only mode cannot handle a TypeScript parameter property, an `enum`, a
 * `namespace` or a decorator; it throws `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` at
 * import time. `tsc` accepts all four and so does vitest, which transpiles
 * first — so neither the typecheck gate nor the rest of this suite can see the
 * failure. This is the same check `src/lib/ingest/strip-safe.test.ts` makes for
 * the ingest modules, extended over this lane's.
 *
 * Default lane: it imports modules and reads no payloads.
 */

import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);

const modules = readdirSync(import.meta.dirname)
  .filter((name) => name.endsWith('.ts') && !name.includes('.test.'))
  .sort();

describe('the shape modules run with no build step', () => {
  it('finds the modules to check', () => {
    expect(modules).toEqual(['corpus.ts', 'drift.ts', 'place.ts', 'snapshot.ts', 'strip.ts']);
  });

  it.each(modules)('%s imports under type stripping', async (name) => {
    // Importing has to actually happen: the failure mode is at evaluation, not
    // at parse, so a syntax check would miss it.
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

  it('does not run the stripper on import', async () => {
    // `strip.ts` writes files. Importing it from a test must do nothing —
    // otherwise the suite rewrites the corpus it is checking.
    const { stdout } = await run(
      process.execPath,
      ['--input-type=module', '-e', "await import('./strip.ts'); console.log('quiet');"],
      { cwd: import.meta.dirname },
    );

    expect(stdout.trim()).toBe('quiet');
  });
});
