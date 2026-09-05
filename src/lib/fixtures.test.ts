/**
 * The corpus resolver is the piece that lets the fidelity suite (#23, #25) find
 * real payloads without a machine-local setting, so what is asserted here is
 * mostly what it does NOT depend on: no environment variable, no current
 * working directory, no configuration file.
 *
 * These tests must keep passing on a machine where the corpus has never been
 * fetched — a fresh clone has `fixtures/` empty or absent. Anything that needs
 * real payloads on disk belongs in the local-only lane
 * (src/lib/fixtures.local.test.ts), not here.
 */

import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { corpusPath, corpusRoot, hasCorpus, repoRoot, requireCorpus } from './fixtures.ts';

const originalCwd = process.cwd();

afterEach(() => {
  process.chdir(originalCwd);
});

describe('repoRoot', () => {
  it('finds the checkout that contains this module', () => {
    // package.json and the source tree this test was loaded from have to agree,
    // otherwise the resolver found some other checkout's root.
    expect(existsSync(join(repoRoot(), 'package.json'))).toBe(true);
    expect(existsSync(join(repoRoot(), 'src', 'lib', 'fixtures.ts'))).toBe(true);
  });

  it('does not change when the process changes directory', async () => {
    // A fidelity test invoked from a subdirectory, or a bin/ script run from
    // anywhere, must resolve the same corpus. Anchoring on cwd would break both.
    const before = repoRoot();
    const elsewhere = await mkdtemp(join(tmpdir(), 'nica-cwd-'));
    process.chdir(elsewhere);
    expect(repoRoot()).toBe(before);
  });
});

describe('corpusRoot', () => {
  it('resolves to fixtures/ inside the checkout, with no environment set', () => {
    // The whole point of #30: no NICA_FIXTURES_DIR, no XDG_DATA_HOME, nothing
    // to export before the suite runs. If this ever starts reading env, a fresh
    // clone stops working and we are back to a path hunt every session.
    expect(corpusRoot()).toBe(join(repoRoot(), 'fixtures'));
  });

  it('ignores environment variables that name some other corpus', () => {
    const before = corpusRoot();
    process.env.NICA_FIXTURES_DIR = '/somewhere/else';
    process.env.XDG_DATA_HOME = '/somewhere/else';
    try {
      expect(corpusRoot()).toBe(before);
    } finally {
      delete process.env.NICA_FIXTURES_DIR;
      delete process.env.XDG_DATA_HOME;
    }
  });

  it('is absolute', () => {
    expect(resolve(corpusRoot())).toBe(corpusRoot());
  });
});

describe('corpusPath', () => {
  it('joins segments under the corpus root', () => {
    expect(corpusPath('2025', 'config-357242.json')).toBe(
      join(corpusRoot(), '2025', 'config-357242.json'),
    );
  });

  it('returns the root itself when given no segments', () => {
    expect(corpusPath()).toBe(corpusRoot());
  });

  it('refuses a path that climbs out of the corpus', () => {
    // A caller assembling a path from payload contents should not be able to
    // reach the rest of the disk, and a test reading `../../.env` is a bug
    // worth failing loudly rather than quietly reading the file.
    expect(() => corpusPath('..', 'refs')).toThrow(/outside the corpus/i);
    expect(() => corpusPath('2025', '..', '..', 'src')).toThrow(/outside the corpus/i);
  });

  it('allows a traversal that stays inside the corpus', () => {
    expect(corpusPath('2025', '..', '2026')).toBe(join(corpusRoot(), '2026'));
  });

  it('refuses an absolute segment', () => {
    expect(() => corpusPath(`${sep}etc`)).toThrow(/outside the corpus/i);
  });
});

describe('hasCorpus', () => {
  it('answers without throwing whether the corpus is present', () => {
    // Deliberately not asserting true: this test runs on a fresh clone too.
    expect(typeof hasCorpus()).toBe('boolean');
  });
});

describe('requireCorpus', () => {
  it('points at the fetch story rather than failing with ENOENT', () => {
    if (hasCorpus()) {
      expect(requireCorpus()).toBe(corpusRoot());
    } else {
      expect(() => requireCorpus()).toThrow(/docs\/fixtures\.md/);
    }
  });
});
