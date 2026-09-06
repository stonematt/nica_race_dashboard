/**
 * The default database URL, and the guard that keeps it to one owner.
 *
 * #41 gave `bin/` a shared `databaseUrl()` helper and left two other call sites
 * spelling `'./.pglite'` themselves. The behaviour tests below are the cheap
 * half; the source scan is the half that matters, because the failure mode of a
 * fourth copy is silent — a fresh clone migrating into one directory and
 * reading from another.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDatabaseUrl } from './url.ts';

describe('resolveDatabaseUrl', () => {
  it('falls back to the local PGlite directory, so a fresh clone needs no configuration', () => {
    expect(resolveDatabaseUrl({})).toBe('./.pglite');
  });

  it('prefers what the environment says', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgres://host/db' })).toBe('postgres://host/db');
  });

  it('reads the environment it is handed, not the ambient one', () => {
    // `readFetchConfig` is a pure function of the env passed to it, and stays
    // one only because this resolver takes an argument.
    expect(resolveDatabaseUrl({ DATABASE_URL: './elsewhere' })).toBe('./elsewhere');
  });
});

/**
 * Scanned rather than asserted through a call, because the thing being
 * prevented is a *new* call site — one this test could not know to import.
 *
 * It matches the literal in any of the three quote styles, because prettier
 * would rewrite a double-quoted copy but has nothing to say about a backtick.
 * A copy assembled from pieces — a concatenation, or the string parked in some
 * other constant — still escapes it, and closing that would mean parsing rather
 * than reading. The scan is aimed at the copy someone writes by hand, which is
 * how all three of the copies it was written for got there.
 *
 * `drizzle.config.ts` at the repo root is knowingly outside the scan and holds
 * a fourth copy. drizzle-kit loads that config through its own bundler before
 * anything else in the project runs, and confirming a relative import survives
 * that means running `drizzle-kit`, which this repo does not do casually
 * (`pnpm db:migrate` writes to whatever `DATABASE_URL` resolves to). Folding it
 * in is a separate change with its own verification.
 */
describe('one owner for the default', () => {
  const ROOT = path.join(import.meta.dirname, '..', '..', '..');
  const OWNER = path.join('src', 'lib', 'db', 'url.ts');

  const sources = (dir: string): string[] =>
    fs
      .readdirSync(path.join(ROOT, dir), { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
      .map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)))
      // A test asserting on the value is not a second owner of it.
      .filter((file) => !/\.test\.tsx?$/.test(file));

  const QUOTED = /(['"`])\.\/\.pglite\1/;

  it('spells the PGlite default in exactly one module under src/ and bin/', () => {
    const spelled = [...sources('src'), ...sources('bin')].filter((file) =>
      QUOTED.test(fs.readFileSync(path.join(ROOT, file), 'utf8')),
    );

    expect(spelled).toEqual([OWNER]);
  });
});
