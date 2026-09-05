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
 * Two halves, because neither is sufficient alone. The **runtime** half spawns
 * a Node process in which every filesystem read under `fixtures/` throws, and
 * runs the whole detection flow inside it — read the corpus, place every list,
 * build both snapshots, diff them. It proves the property rather than a proxy
 * for it, and it proves the trap bites before it claims anything. The
 * **static** half names the known doors into `fixtures/` and checks that
 * nothing in this lane imports one, so a regression is caught at the line that
 * introduces it rather than only at the read.
 *
 * `strip.ts` is excepted from the static half: it is the writer, and it runs on
 * a developer's machine with a human present.
 *
 * Default lane.
 */

import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { CORPUS_DIRNAME } from '../fixtures.ts';
import { shapeCorpusRoot } from './corpus.ts';

const run = promisify(execFile);

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

describe('the detection flow, run where the real corpus cannot be reached', () => {
  /**
   * Every read under `fixtures/` throws, then the whole flow runs.
   *
   * `src/lib/fixtures.ts` is deliberately not caught by the matcher — it is a
   * module, not the corpus, and the modules under test are allowed to import
   * `repoRoot` from it.
   */
  const script = `
    import fs from 'node:fs';
    const forbidden = (p) =>
      String(p).includes('/${CORPUS_DIRNAME}/') || String(p).endsWith('/${CORPUS_DIRNAME}');
    for (const name of ['readFileSync', 'readdirSync', 'existsSync', 'openSync', 'statSync',
                        'opendirSync', 'createReadStream']) {
      const original = fs[name];
      fs[name] = (p, ...rest) => {
        if (forbidden(p)) throw new Error('REACHED THE REAL CORPUS: ' + p);
        return original(p, ...rest);
      };
    }

    // The trap has to bite, or the rest of this proves nothing.
    try {
      fs.readdirSync(process.cwd() + '/../../../${CORPUS_DIRNAME}');
      console.log('trap did not bite');
    } catch (error) {
      if (!String(error.message).startsWith('REACHED')) throw error;
    }

    const { readShapeCorpus } = await import('./corpus.ts');
    const { snapshotOf } = await import('./snapshot.ts');
    const { driftAgainst } = await import('./drift.ts');

    const events = readShapeCorpus();
    const lists = (season) =>
      events.filter((event) => event.season === season).flatMap((event) => event.lists);
    const drift = driftAgainst(snapshotOf(lists(2025)), snapshotOf(lists(2026)));

    console.log(JSON.stringify({ events: events.length, drift: drift.length }));
  `;

  it('reads the shape corpus, places every list and reports the 2026 drift', async () => {
    const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], {
      cwd: import.meta.dirname,
    });

    expect(stdout).not.toContain('trap did not bite');
    expect(JSON.parse(stdout.trim())).toEqual({ events: 9, drift: 9 });
  });
});
