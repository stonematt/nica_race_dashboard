/**
 * The Roster Wall's reads, against a real (in-memory) Postgres.
 *
 * What is worth a database test here rather than a synthetic one in
 * `roster-wall.test.ts`: identity resolution through `rider_plate`, the
 * Round-with-two-Events collapse through `v_rider_result`'s own join, and that
 * a Squad member with no result anywhere still comes back as a roster row.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.ts';
import { createTestDb, type TestDatabase } from './testing.ts';
import {
  loadRosterWallInputs,
  loadRosterWallResults,
  loadSeasonRounds,
  loadSquadRoster,
} from './roster-wall-query.ts';
import { buildRosterWall } from '../roster-wall.ts';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDb();

  await db.insert(schema.season).values({ id: 1, year: 2025 });
  await db.insert(schema.round).values([
    { id: 1, seasonId: 1, ordinal: 1, name: 'Prologue' },
    { id: 2, seasonId: 1, ordinal: 2, name: 'Race 2' },
    { id: 3, seasonId: 1, ordinal: 3, name: 'Race 3' },
  ]);

  // Round 2 published as two Events — North and South — the way Rounds 2-4
  // actually publish. This club's riders race North only.
  await db.insert(schema.event).values([
    { id: 1, roundId: 1, sourceEventId: 'evt-1', name: 'Prologue' },
    { id: 2, roundId: 2, sourceEventId: 'evt-2-north', conference: 'North', name: 'Race 2 North' },
    { id: 3, roundId: 2, sourceEventId: 'evt-2-south', conference: 'South', name: 'Race 2 South' },
    // Round 3 published, but nobody on this squad appears in it.
    { id: 4, roundId: 3, sourceEventId: 'evt-3-north', conference: 'North', name: 'Race 3 North' },
  ]);

  await db.insert(schema.club).values({ id: 1, name: 'Test Club' });
  await db.insert(schema.squad).values({ id: 1, clubId: 1, seasonId: 1, name: 'JV' });

  await db.insert(schema.rider).values([
    { id: 1, displayName: '«RIDER-A»' }, // positioned at the Prologue and Round 2 North
    { id: 2, displayName: '«RIDER-B»' }, // DNF at the Prologue, never raced again
    { id: 3, displayName: '«RIDER-C»' }, // on the squad, never has a result row
  ]);
  await db.insert(schema.squadMember).values([
    { squadId: 1, riderId: 1 },
    { squadId: 1, riderId: 2 },
    { squadId: 1, riderId: 3 },
  ]);
  await db.insert(schema.riderPlate).values([
    { riderId: 1, seasonId: 1, plate: '10' },
    { riderId: 2, seasonId: 1, plate: '20' },
    // Rider 3 has no plate at all: she is on the roster and started nothing.
  ]);

  await db.insert(schema.individualResult).values([
    {
      eventId: 1,
      plate: '10',
      displayName: 'RIDER 10',
      scoringTeam: 'Some Team',
      categoryRaw: 'HS2 Girls',
      place: '3',
      status: 'finished',
      timeRaw: '20:00.00',
      timeSeconds: '1200',
      laps: 2,
    },
    {
      eventId: 2,
      plate: '10',
      displayName: 'RIDER 10',
      scoringTeam: 'Some Team',
      categoryRaw: 'HS2 Girls - North',
      place: '5',
      status: 'finished',
      timeRaw: '21:00.00',
      timeSeconds: '1260',
      laps: 2,
    },
    // South event has its own field; rider 10 never appears in it — confirms
    // the query does not need to know which of the Round's Events to read.
    {
      eventId: 3,
      plate: '999',
      displayName: 'SOMEONE ELSE',
      scoringTeam: 'Other School',
      categoryRaw: 'HS2 Girls - South',
      place: '1',
      status: 'finished',
      timeRaw: '19:00.00',
      timeSeconds: '1140',
      laps: 2,
    },
    {
      eventId: 1,
      plate: '20',
      displayName: 'RIDER 20',
      scoringTeam: 'Some Team',
      categoryRaw: 'HS2 Girls',
      place: '*',
      status: 'dnf',
      timeRaw: 'DNF',
      laps: 0,
    },
  ]);
});

describe('loadSquadRoster', () => {
  it('lists every rider on the Squad, including one with no result anywhere', async () => {
    const roster = await loadSquadRoster(db, 1);
    expect(roster.map((r) => r.riderId).sort()).toEqual([1, 2, 3]);
  });
});

describe('loadSeasonRounds', () => {
  it('lists every Round of the Season in ordinal order', async () => {
    const rounds = await loadSeasonRounds(db, 1);
    expect(rounds.map((r) => r.roundOrdinal)).toEqual([1, 2, 3]);
    expect(rounds.map((r) => r.roundName)).toEqual(['Prologue', 'Race 2', 'Race 3']);
  });
});

describe('loadRosterWallResults', () => {
  it("resolves a rider's Round 2 result without the caller naming an Event", async () => {
    const results = await loadRosterWallResults(db, 1, 1);
    const riderOneRound2 = results.find((r) => r.riderId === 1 && r.roundOrdinal === 2);
    expect(riderOneRound2?.place).toBe('5');
  });

  it('never returns a row for someone else’s result, even in the same field', async () => {
    const results = await loadRosterWallResults(db, 1, 1);
    expect(results.some((r) => r.place === '1' && r.roundOrdinal === 2)).toBe(false);
  });

  it('returns nothing for a rider with no plate mapped, leaving her did-not-start to the pure module', async () => {
    const results = await loadRosterWallResults(db, 1, 1);
    expect(results.some((r) => r.riderId === 3)).toBe(false);
  });
});

describe('loadRosterWallInputs, assembled through buildRosterWall', () => {
  it('renders the whole wall: positioned, DNF, and did-not-start together', async () => {
    const { riders, rounds, results } = await loadRosterWallInputs(db, 1, 1);
    const wall = buildRosterWall(riders, rounds, results);

    const byRider = new Map(wall.map((row) => [row.rider.riderId, row]));

    expect(byRider.get(1)!.cells[0]).toEqual({
      state: 'positioned',
      place: '3',
      pctBack: expect.any(Number),
      isLapped: false,
      fieldSize: expect.any(Number),
      category: 'HS2 Girls',
    });
    expect(byRider.get(1)!.cells[1]!.state).toBe('positioned');
    expect(byRider.get(1)!.cells[2]).toEqual({ state: 'did-not-start' });

    expect(byRider.get(2)!.cells[0]).toEqual({ state: 'started-not-positioned', reason: 'dnf' });
    expect(byRider.get(2)!.cells[1]).toEqual({ state: 'did-not-start' });

    expect(byRider.get(3)!.cells.every((c) => c.state === 'did-not-start')).toBe(true);
  });
});
