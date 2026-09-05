/**
 * The privacy guard, pointed at the committed shape corpus.
 *
 * #28 built the guard and wrote its payload-rows rule for exactly this corpus:
 * "a stripper regression that starts emitting real rows fails the build rather
 * than publishing them." So this wires into it rather than adding a second
 * guard — it runs the real `scan()` over the real committed files, and then
 * shows the same scan a corrupted shape file to prove the rule still fires.
 *
 * `scripts/privacy-guard.test.ts` already scans everything git tracks, so the
 * corpus is covered there too. This file is the narrower statement: these
 * specific files, and this specific regression.
 *
 * Default lane.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scan, trackedFiles } from '../../../scripts/privacy-guard.ts';
import { repoRoot } from '../fixtures.ts';
import { readShapeCorpus, shapeCorpusRoot, shapeSeasonDirs } from './corpus.ts';

/** Every committed shape file, as the guard would be handed it. */
function shapeFiles(): { path: string; content: string }[] {
  return shapeSeasonDirs().flatMap((season) => {
    const dir = join(shapeCorpusRoot(), season);
    return readdirSync(dir).map((name) => ({
      path: relative(repoRoot(), join(dir, name)),
      content: readFileSync(join(dir, name), 'utf8'),
    }));
  });
}

/** A shape file as the stripper writes it, with `rows` put back in `data`. */
function corrupted(rows: unknown[][]) {
  return JSON.stringify({
    shape: { season: 2025, eventId: '359478', listId: '4C8C1F', hidden: false, groups: {} },
    list: { ListName: 'Individual Results - ALL', ListFooterText: '', Fields: [], Orders: [] },
    DataFields: ['BIB', 'ID', 'CategoryRank', 'ucase([DisplayName])', 'CLUB', 'TotalTime'],
    data: { '#1_group-1-1': rows },
  });
}

const A_ROW = ['214', '9', '1', 'JORDAN RIVERS', 'Some Composite', '00:41:12.3'];

describe('the committed shape corpus', () => {
  const files = shapeFiles();

  it('is one file per event config and one per published list', () => {
    const events = readShapeCorpus();
    const lists = events.reduce((total, event) => total + event.lists.length, 0);

    expect(files).toHaveLength(events.length + lists);
  });

  it('passes the privacy guard', () => {
    expect(scan(files)).toEqual([]);
  });

  it('is tracked, so `pnpm privacy:check` scans it on every run', () => {
    // A corpus git does not know about is a corpus the guard never sees.
    const tracked = trackedFiles(repoRoot()).filter((path) => path.startsWith('shape-corpus/'));

    expect(tracked).toHaveLength(files.length);
  });
});

describe('the guard still fires on a stripper regression', () => {
  it('refuses a shape file that put the rows back', () => {
    const findings = scan([
      { path: 'shape-corpus/2025/list-359478-4C8C1F.json', content: corrupted([A_ROW, A_ROW]) },
    ]);

    expect(findings.map((finding) => finding.rule)).toContain('payload-rows');
    expect(findings.find((finding) => finding.rule === 'payload-rows')?.detail).toContain('2 row');
  });

  it('refuses a name that reached a positional row', () => {
    const findings = scan([
      { path: 'shape-corpus/2025/list-359478-4C8C1F.json', content: corrupted([A_ROW]) },
    ]);

    expect(findings.map((finding) => finding.rule)).toContain('row-name');
  });

  it('never echoes what it found', () => {
    // A failure message is written to a public CI log.
    for (const finding of scan([{ path: 'shape-corpus/x.json', content: corrupted([A_ROW]) }])) {
      expect(finding.detail).not.toContain('JORDAN');
      expect(finding.detail).not.toContain('RIVERS');
    }
  });

  it('passes the same file with the rows dropped, which is what the stripper writes', () => {
    expect(
      scan([{ path: 'shape-corpus/2025/list-359478-4C8C1F.json', content: corrupted([]) }]),
    ).toEqual([]);
  });
});
