/**
 * The headline assertion: a drifted season fails loudly.
 *
 * The 2026 opener really is drifted — the source renamed every list, moved the
 * config's catalog, and rebuilt the flat individual list out of expressions
 * 2025 never published. So the check has a true positive standing in the corpus
 * rather than a synthetic one, and it will keep having one after 2026 is
 * classified, because the snapshot it is compared against is built from 2025
 * alone.
 *
 * Default lane.
 */

import { describe, expect, it } from 'vitest';
import type { IngestSnapshot } from '../ingest/snapshot.ts';
import { readShapeCorpus } from './corpus.ts';
import { describeDrift, driftAgainst } from './drift.ts';
import { listsOf, seasonOf, snapshotOf } from './snapshot.ts';

const events = readShapeCorpus();
const baseline = snapshotOf(listsOf(seasonOf(events, 2025)));
const opener = snapshotOf(listsOf(seasonOf(events, 2026)));

const whats = (findings: ReturnType<typeof driftAgainst>, kind: string) =>
  findings.filter((finding) => finding.kind === kind).map((finding) => finding.what);

describe('a snapshot built from 2025 alone', () => {
  it('holds every family the season published, in declaration order', () => {
    expect(baseline.families.map((family) => family.name)).toEqual([
      'individual_flat',
      'individual_by_team',
      'team_race_result',
      'team_race_counter',
      'season_individual',
      'season_team',
    ]);
  });

  it('records shape and only shape', () => {
    // The property that lets the artifact be diffed in CI on a public repo.
    // A snapshot list carries expressions and a count; there is nowhere in it
    // for a name to sit.
    const list = baseline.families[0]!.lists[0]!;

    expect(Object.keys(list).sort()).toEqual([
      'decoded',
      'eventId',
      'expressions',
      'hidden',
      'listId',
      'listName',
      'rows',
      'season',
      'skippedBecause',
      'variant',
    ]);
    expect(typeof list.rows).toBe('number');
  });

  it('reports no drift against itself', () => {
    expect(driftAgainst(baseline, baseline)).toEqual([]);
  });

  it('reports no drift for a season it was built from', () => {
    // Race 4 is inside the baseline, so nothing it publishes is new. This is
    // the control that stops the check from crying wolf on every event.
    const raceFour = snapshotOf(events.find((event) => event.eventId === '363499')!.lists);

    expect(driftAgainst(baseline, raceFour)).toEqual([]);
  });
});

describe('the 2026 opener checked against it', () => {
  const drift = driftAgainst(baseline, opener);

  it('is detected as drifted', () => {
    expect(drift.length).toBeGreaterThan(0);
  });

  it('names the layout the source rebuilt', () => {
    expect(whats(drift, 'variant-added')).toEqual(['mass-start-2026']);
  });

  it('names every expression 2025 never published', () => {
    expect(whats(drift, 'expression-added').sort()).toEqual([
      'PenaltyTime',
      'PointsMatrix',
      'TS1.LAPTIMENUMBER',
      'WithStatus([TotalTime])',
      'if([Lap01]=0;"-";[Lap01])',
      'if([Lap02.SECTOR]=0;"-";[Lap02.SECTOR])',
      'if([STATUS]=3;"*";[CategoryRank])',
      'ucase([DisplayName])',
    ]);
  });

  it('names the list that introduced each one', () => {
    for (const finding of drift) {
      expect(finding.family).toBe('individual_flat');
      expect(finding.where).toBe('418436/F1A053');
    }
    expect(describeDrift(drift[0]!)).toBe(
      'variant-added: individual_flat — mass-start-2026 (418436/F1A053)',
    );
  });

  it('says nothing about the families the opener did not publish', () => {
    // Only one of the opener's three advertised lists was ever fetched. A
    // missing family is not drift — the question is what is new, not what is
    // absent — and reporting it would bury the eight expressions that are.
    expect(whats(drift, 'family-added')).toEqual([]);
  });
});

describe('a family nobody has declared', () => {
  const empty: IngestSnapshot = { version: 1, families: [] };
  const withOne: IngestSnapshot = {
    version: 1,
    families: [
      {
        name: 'something_new',
        target: 'individual_result',
        expressions: ['BIB'],
        lists: [
          {
            season: 2027,
            eventId: '999999',
            listId: 'ABCDEF',
            listName: 'Online|Something New',
            variant: 'unseen',
            decoded: false,
            hidden: false,
            skippedBecause: null,
            expressions: ['BIB'],
            rows: 0,
          },
        ],
      },
    ],
  };

  it('is reported as a whole family added', () => {
    expect(driftAgainst(empty, withOne)).toEqual([
      {
        kind: 'family-added',
        family: 'something_new',
        what: 'something_new',
        where: '999999/ABCDEF',
      },
    ]);
  });
});
