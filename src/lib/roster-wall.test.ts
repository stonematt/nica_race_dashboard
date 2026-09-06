/**
 * `buildRosterWall` on synthetic objects — no database, per `docs/fixtures.md`.
 *
 * The behavior worth pinning is the three-state derivation, not arithmetic:
 * this module never computes a place, a percentage or a field size, it only
 * arranges the facts the query layer already resolved.
 */

import { describe, expect, it } from 'vitest';
import { buildRosterWall, type RosterWallResult, type RosterWallRound } from './roster-wall.ts';

const ROUNDS: RosterWallRound[] = [
  { roundId: 1, roundOrdinal: 1, roundName: 'Prologue' },
  { roundId: 2, roundOrdinal: 2, roundName: 'Race 2' },
  { roundId: 3, roundOrdinal: 3, roundName: 'Race 3' },
];

const RIDERS = [
  { riderId: 1, riderName: '«RIDER-A»' },
  { riderId: 2, riderName: '«RIDER-B»' },
];

function result(over: Partial<RosterWallResult>): RosterWallResult {
  return {
    riderId: 1,
    roundOrdinal: 1,
    place: '3',
    status: 'finished',
    isLapped: false,
    pctBack: 5.2,
    fieldSize: 40,
    category: 'HS2 Girls',
    ...over,
  };
}

describe('the three states', () => {
  it('marks a published place as positioned, carrying only description', () => {
    const wall = buildRosterWall(RIDERS, ROUNDS, [result({})]);
    expect(wall[0]!.cells[0]).toEqual({
      state: 'positioned',
      place: '3',
      pctBack: 5.2,
      isLapped: false,
      fieldSize: 40,
      category: 'HS2 Girls',
    });
  });

  it('marks a DNF as started but not positioned', () => {
    const wall = buildRosterWall(RIDERS, ROUNDS, [
      result({ status: 'dnf', place: '*', pctBack: null }),
    ]);
    expect(wall[0]!.cells[0]).toEqual({ state: 'started-not-positioned', reason: 'dnf' });
  });

  it('marks a lapped finisher as started but not positioned, even though she has a rank', () => {
    // NICA still prints a numeric place for a rider it pulled at the line —
    // 2025 Race 4 North ranked lapped riders 65th and 67th. The wall's
    // "positioned" state means comparable, not merely numbered.
    const wall = buildRosterWall(RIDERS, ROUNDS, [
      result({ status: 'finished', isLapped: true, place: '65', pctBack: null }),
    ]);
    expect(wall[0]!.cells[0]).toEqual({ state: 'started-not-positioned', reason: 'lapped' });
  });

  it('marks a rider with no result row at the Round as did-not-start', () => {
    const wall = buildRosterWall(RIDERS, ROUNDS, []);
    expect(wall[0]!.cells).toEqual([
      { state: 'did-not-start' },
      { state: 'did-not-start' },
      { state: 'did-not-start' },
    ]);
  });
});

describe('the grid shape', () => {
  it('gives every rider a cell for every Round, including ones she skipped', () => {
    const wall = buildRosterWall(RIDERS, ROUNDS, [
      result({ riderId: 1, roundOrdinal: 1 }),
      result({ riderId: 1, roundOrdinal: 3, place: '9' }),
      // Rider 2 raced none of it.
    ]);

    expect(wall).toHaveLength(2);
    expect(wall[0]!.rider.riderId).toBe(1);
    expect(wall[0]!.cells).toHaveLength(3);
    expect(wall[0]!.cells[0]!.state).toBe('positioned');
    expect(wall[0]!.cells[1]).toEqual({ state: 'did-not-start' });
    expect(wall[0]!.cells[2]!.state).toBe('positioned');

    expect(wall[1]!.rider.riderId).toBe(2);
    expect(wall[1]!.cells.every((c) => c.state === 'did-not-start')).toBe(true);
  });

  it('includes a Round the Squad did not attend as a column, not an absence', () => {
    const wall = buildRosterWall(RIDERS, ROUNDS, [result({ riderId: 1, roundOrdinal: 1 })]);
    expect(wall[0]!.cells).toHaveLength(ROUNDS.length);
  });

  it('orders columns by round ordinal, regardless of the order Rounds arrived in', () => {
    const scrambled = [...ROUNDS].reverse();
    const wall = buildRosterWall(RIDERS, scrambled, [
      result({ riderId: 1, roundOrdinal: 1, place: '1' }),
      result({ riderId: 1, roundOrdinal: 2, place: '2' }),
      result({ riderId: 1, roundOrdinal: 3, place: '3' }),
    ]);
    const places = wall[0]!.cells.map((c) => (c.state === 'positioned' ? c.place : c.state));
    expect(places).toEqual(['1', '2', '3']);
  });

  it('produces no row for a rider not on the roster passed in', () => {
    const wall = buildRosterWall([RIDERS[0]!], ROUNDS, [
      result({ riderId: 2, roundOrdinal: 1 }), // a stray result for someone not on this roster
    ]);
    expect(wall).toHaveLength(1);
    expect(wall[0]!.rider.riderId).toBe(1);
  });
});

describe('a data anomaly this club should never produce', () => {
  it('prefers a positioned result over a second, contradictory row for the same round', () => {
    // Two Events in one Round is real (a North/South split); two results for
    // the SAME rider in the SAME round is not, for a club that sits entirely
    // in one Conference. If it ever happens, positioned wins over not.
    const wall = buildRosterWall(RIDERS, ROUNDS, [
      result({ riderId: 1, roundOrdinal: 1, status: 'dnf', place: '*', pctBack: null }),
      result({ riderId: 1, roundOrdinal: 1, status: 'finished', place: '7' }),
    ]);
    expect(wall[0]!.cells[0]!.state).toBe('positioned');
  });
});
