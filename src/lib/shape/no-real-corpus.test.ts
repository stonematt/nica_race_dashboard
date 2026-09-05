/**
 * The detection suite never reads the real corpus.
 *
 * That is what makes it safe to run in CI on a public repository and what makes
 * it pass on a fresh clone, where `fixtures/` does not exist at all — it is
 * gitignored and never committed. The property is worth asserting rather than
 * remembering: one convenience import of `discoverCorpus()` into a shape module
 * and the whole suite quietly starts depending on minors' race results being on
 * the machine.
 *
 * Two halves. The static half names the doors into `fixtures/` and checks that
 * nothing in this lane opens one — `strip.ts` excepted, which is the writer and
 * runs on a developer's machine with a human present. The runtime half reads
 * the corpus out of a directory that is demonstrably not `fixtures/`.
 *
 * Default lane.
 */

import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CORPUS_DIRNAME } from '../fixtures.ts';
import { readShapeCorpus, shapeCorpusRoot, SHAPE_SEASONS } from './corpus.ts';
import { listsOf, snapshotOf } from './snapshot.ts';

/**
 * Modules exempt from the scan: the two that write the corpus and run on a
 * developer's machine, and this file, which has to name the doors to look for
 * them.
 */
const EXEMPT = ['strip.ts', 'strip.local.test.ts', 'no-real-corpus.test.ts'];

/** Every way into the real corpus that `src/lib/` exposes. */
const CORPUS_DOORS = [
  'requireCorpus',
  'corpusPath',
  'corpusRoot',
  'hasCorpus',
  'discoverCorpus',
  'readEventRecords',
  'loadCorpus',
  '../ingest/corpus.ts',
];

describe('nothing in the detection lane can reach the real corpus', () => {
  const modules = readdirSync(import.meta.dirname)
    .filter((name) => name.endsWith('.ts') && !EXEMPT.includes(name))
    .sort();

  it('finds the modules to check', () => {
    expect(modules.length).toBeGreaterThan(5);
  });

  it.each(modules)('%s opens no door into fixtures/', (name) => {
    const source = readFileSync(join(import.meta.dirname, name), 'utf8');

    for (const door of CORPUS_DOORS) {
      expect(`${name} mentions ${door}: ${source.includes(door)}`).toBe(
        `${name} mentions ${door}: false`,
      );
    }
  });

  it('keeps the shape corpus outside the real corpus directory', () => {
    // Also what keeps the pre-commit hook and the guard's path rule off it:
    // both refuse anything under `fixtures/`, forever and on purpose.
    expect(shapeCorpusRoot().split('/')).not.toContain(CORPUS_DIRNAME);
  });
});

describe('the suite runs against a shape corpus anywhere on disk', () => {
  const elsewhere = mkdtempSync(join(tmpdir(), 'shape-corpus-'));

  afterAll(() => rmSync(elsewhere, { recursive: true, force: true }));

  it('reads and snapshots a copy that is nowhere near the checkout', () => {
    // Proof by construction that the reader takes its root as a parameter and
    // consults nothing else — no environment variable, no cwd, no fixtures/.
    for (const season of SHAPE_SEASONS) {
      cpSync(join(shapeCorpusRoot(), season), join(elsewhere, season), { recursive: true });
    }

    const events = readShapeCorpus(elsewhere);

    expect(events).toHaveLength(9);
    expect(snapshotOf(listsOf(events)).families.length).toBeGreaterThan(0);
  });
});
