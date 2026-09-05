/**
 * LOCAL ONLY — `pnpm test:local`. Never CI.
 *
 * This file reads the real corpus, so it is the first inhabitant of the lane
 * #30 carved out for the fidelity suites (#23, #25). It asserts only that the
 * resolver finds real payloads where it says it will; the fidelity questions —
 * did the numbers land unaltered — are those tickets', not this one's.
 *
 * Nothing here may print, snapshot or assert on a payload's contents. The rows
 * carry minors' full names, and a failure message is written to a terminal that
 * may well be a CI log one day.
 */

import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { CORPUS_SEASONS, corpusPath, hasCorpus, requireCorpus } from './fixtures.ts';

describe('the fixture corpus on this machine', () => {
  it('is present where the resolver says it is', () => {
    expect(hasCorpus()).toBe(true);
    expect(requireCorpus()).toBe(corpusPath());
  });

  it('carries both seasons, with payloads in each', async () => {
    for (const season of CORPUS_SEASONS) {
      const files = await readdir(corpusPath(season));
      expect(files.filter((name) => name.endsWith('.json')).length).toBeGreaterThan(0);
    }
  });

  it('serves a payload that parses as JSON', async () => {
    // The 2026 opener's config: the smallest thing in the corpus that proves
    // the whole path — resolve, read, decode — works end to end. Counted, not
    // shown; nothing from inside a payload reaches this assertion.
    const raw = await readFile(corpusPath('2026', 'config-418436.json'), 'utf8');
    expect(Object.keys(JSON.parse(raw)).length).toBeGreaterThan(0);
  });
});
