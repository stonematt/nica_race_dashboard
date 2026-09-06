/**
 * The Roster Wall's presentational model, held on synthetic data — no
 * database, no corpus (issue #35).
 */

import { describe, expect, it } from 'vitest';
import type { RosterWallCell, RosterWallRound } from '../lib/roster-wall.ts';
import {
  buildRosterWallColumns,
  cellMark,
  describeCell,
  pctBackText,
  roundHref,
} from './roster-wall-view.ts';

const ROUNDS: RosterWallRound[] = [
  { roundId: 2, roundOrdinal: 2, roundName: 'Race 2' },
  { roundId: 1, roundOrdinal: 1, roundName: 'Race 1' },
  { roundId: 5, roundOrdinal: 5, roundName: 'State Champs' },
];

describe('roundHref', () => {
  it('names the round page under the season year', () => {
    expect(roundHref(2026, 3)).toBe('/2026/round/3');
  });
});

describe('buildRosterWallColumns', () => {
  it('orders columns by round ordinal regardless of the input order', () => {
    const columns = buildRosterWallColumns(2026, ROUNDS);
    expect(columns.map((c) => c.roundOrdinal)).toEqual([1, 2, 5]);
    expect(columns.map((c) => c.roundName)).toEqual(['Race 1', 'Race 2', 'State Champs']);
  });

  it('links every column to its own round page', () => {
    const columns = buildRosterWallColumns(2026, ROUNDS);
    expect(columns.find((c) => c.roundOrdinal === 5)!.href).toBe('/2026/round/5');
  });

  it('is empty when the season has no rounds yet', () => {
    expect(buildRosterWallColumns(2026, [])).toEqual([]);
  });
});

const positioned: RosterWallCell = {
  state: 'positioned',
  place: '3',
  pctBack: 8.4,
  isLapped: false,
  fieldSize: 30,
  category: 'HS1 Boys',
};

const positionedNoGap: RosterWallCell = { ...positioned, pctBack: null };
const dnf: RosterWallCell = { state: 'started-not-positioned', reason: 'dnf' };
const lapped: RosterWallCell = { state: 'started-not-positioned', reason: 'lapped' };
const absent: RosterWallCell = { state: 'did-not-start' };

describe('cellMark', () => {
  it('shows the published place verbatim for a positioned cell', () => {
    expect(cellMark(positioned)).toBe('3');
    // A `place` may carry a `*` or be empty — never parsed, never re-derived.
    expect(cellMark({ ...positioned, place: '*' })).toBe('*');
  });

  it('names the reason for a started-not-positioned cell', () => {
    expect(cellMark(dnf)).toBe('DNF');
    expect(cellMark(lapped)).toBe('Lapped');
  });

  it('is empty for a did-not-start cell', () => {
    expect(cellMark(absent)).toBe('');
  });
});

describe('pctBackText', () => {
  it('never renders a null percent back as zero or as nothing', () => {
    const text = pctBackText(null);
    expect(text).not.toContain('0%');
    expect(text.length).toBeGreaterThan(0);
  });

  it('renders a real percent back with the sign that means "behind"', () => {
    expect(pctBackText(8.4)).toBe('+8.4% back');
  });
});

describe('describeCell', () => {
  it('gives a positioned cell its place, field size and percent back', () => {
    expect(describeCell(positioned)).toBe('Place 3 of 30, +8.4% back');
  });

  it('states the null percent back as its own fact, not a zero', () => {
    expect(describeCell(positionedNoGap)).toContain('no gap published');
    expect(describeCell(positionedNoGap)).not.toMatch(/0%/);
  });

  it('tells DNF and lapped apart in words', () => {
    expect(describeCell(dnf)).toBe('Started, did not finish');
    expect(describeCell(lapped)).toBe('Started, lapped');
    expect(describeCell(dnf)).not.toBe(describeCell(lapped));
  });

  it('says a did-not-start cell is a non-start, not a blank', () => {
    expect(describeCell(absent)).toBe('Did not start this round');
  });
});
