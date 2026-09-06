/**
 * The crossing's reads, against a real (in-memory) Postgres.
 *
 * What is worth a database test here rather than a synthetic one in
 * `category.test.ts`: resolving the Rider's own Category and Event through
 * `v_rider_result`, reading the whole field (including riders who resolve to
 * no tracked Rider at all), and flagging squad-mates without the caller doing
 * its own join.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.ts';
import { createTestDb, type TestDatabase } from './testing.ts';
import { loadCategoryField } from './category-query.ts';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDb();

  await db.insert(schema.season).values({ id: 1, year: 2025 });
  await db.insert(schema.round).values([
    { id: 1, seasonId: 1, ordinal: 1, name: 'Prologue' },
    { id: 2, seasonId: 1, ordinal: 5, name: 'State Champs' },
  ]);

  // Round 1 (the Prologue) is published as one Event, whole league, but the
  // Category still carries the Conference suffix — 2025's actual shape.
  // Round 5 (State Champs) is also one Event, and the Category merges: no
  // suffix, no per-event conference either.
  await db.insert(schema.event).values([
    { id: 1, roundId: 1, sourceEventId: 'evt-1-prologue', name: 'Prologue' },
    { id: 2, roundId: 2, sourceEventId: 'evt-2-state', name: 'State Champs' },
  ]);

  await db.insert(schema.club).values({ id: 1, name: 'Test Club' });
  await db.insert(schema.squad).values({ id: 1, clubId: 1, seasonId: 1, name: 'JV' });
  await db.insert(schema.squad).values({ id: 2, clubId: 1, seasonId: 1, name: 'Varsity' });

  await db.insert(schema.rider).values([
    { id: 1, displayName: '«RIDER-A»' }, // the rider crossing
    { id: 2, displayName: '«RIDER-B»' }, // her squad-mate, same Category
    { id: 3, displayName: '«RIDER-C»' }, // on the club, different Squad
  ]);
  await db.insert(schema.squadMember).values([
    { squadId: 1, riderId: 1 },
    { squadId: 1, riderId: 2 },
    { squadId: 2, riderId: 3 },
  ]);
  await db.insert(schema.riderPlate).values([
    { riderId: 1, seasonId: 1, plate: '10' },
    { riderId: 2, seasonId: 1, plate: '20' },
    { riderId: 3, seasonId: 1, plate: '30' },
  ]);

  await db.insert(schema.individualResult).values([
    // The Prologue field: HS2 Girls - North. Rider A finishes 2nd, a rival
    // (untracked) wins, rider B (squad-mate) DNFs, rider C is in a different
    // Category (HS2 Girls - South) and must not appear in A's field.
    {
      eventId: 1,
      plate: '999',
      displayName: 'RIVAL WINNER',
      scoringTeam: 'Other School',
      categoryRaw: 'HS2 Girls - North',
      place: '1',
      status: 'finished',
      timeRaw: '19:00.00',
      timeSeconds: '1140',
      laps: 2,
    },
    {
      eventId: 1,
      plate: '10',
      displayName: 'RIDER 10',
      scoringTeam: 'Some Team',
      categoryRaw: 'HS2 Girls - North',
      place: '2',
      status: 'finished',
      timeRaw: '20:00.00',
      timeSeconds: '1200',
      laps: 2,
    },
    {
      eventId: 1,
      plate: '20',
      displayName: 'RIDER 20',
      scoringTeam: 'Some Team',
      categoryRaw: 'HS2 Girls - North',
      place: '*',
      status: 'dnf',
      timeRaw: 'DNF',
      laps: 0,
    },
    {
      eventId: 1,
      plate: '30',
      displayName: 'RIDER 30',
      scoringTeam: 'Some Team',
      categoryRaw: 'HS2 Girls - South',
      place: '1',
      status: 'finished',
      timeRaw: '18:00.00',
      timeSeconds: '1080',
      laps: 2,
    },
    // State Champs: the Category merges — no Conference suffix.
    {
      eventId: 2,
      plate: '10',
      displayName: 'RIDER 10',
      scoringTeam: 'Some Team',
      categoryRaw: 'HS2 Girls',
      place: '5',
      status: 'finished',
      timeRaw: '21:00.00',
      timeSeconds: '1260',
      laps: 2,
    },
    {
      eventId: 2,
      plate: '999',
      displayName: 'RIVAL WINNER',
      scoringTeam: 'Other School',
      categoryRaw: 'HS2 Girls',
      place: '1',
      status: 'finished',
      timeRaw: '19:30.00',
      timeSeconds: '1170',
      laps: 2,
    },
  ]);
});

describe('loadCategoryField', () => {
  it('resolves the Rider’s own Category and Event, and returns the whole field', async () => {
    const field = await loadCategoryField(db, 1, 1, 1);
    expect(field?.categoryName).toBe('HS2 Girls - North');
    expect(field?.rows.map((r) => r.displayName)).toEqual(['RIVAL WINNER', 'RIDER 10', 'RIDER 20']);
  });

  it('excludes riders in the same Round but a different Category', async () => {
    const field = await loadCategoryField(db, 1, 1, 1);
    expect(field?.rows.some((r) => r.displayName === 'RIDER 30')).toBe(false);
  });

  it('flags a squad-mate without the caller doing its own membership lookup', async () => {
    const field = await loadCategoryField(db, 1, 1, 1);
    const mate = field?.rows.find((r) => r.displayName === 'RIDER 20');
    const rival = field?.rows.find((r) => r.displayName === 'RIVAL WINNER');
    expect(mate?.isSquadMate).toBe(true);
    expect(mate?.riderId).toBe(2);
    expect(rival?.isSquadMate).toBe(false);
    expect(rival?.riderId).toBeNull();
  });

  it('does not flag a club member of a different Squad as a squad-mate', async () => {
    // Rider 3 races a different Category here, but even a same-Category
    // rider on Squad 2 would not be a squad-mate of Squad 1's crossing —
    // there is no such row in this fixture, so this pins the absence.
    const field = await loadCategoryField(db, 1, 1, 1);
    expect(field?.rows.every((r) => r.riderId !== 3)).toBe(true);
  });

  it('states the Prologue Category as Conference-scoped', async () => {
    const field = await loadCategoryField(db, 1, 1, 1);
    expect(field?.scope).toBe('conference');
    expect(field?.conference).toBe('North');
  });

  it('states State Champs as league-wide once the Category merges', async () => {
    const field = await loadCategoryField(db, 1, 2, 1);
    expect(field?.categoryName).toBe('HS2 Girls');
    expect(field?.scope).toBe('league');
    expect(field?.conference).toBeNull();
    expect(field?.rows.map((r) => r.displayName)).toEqual(['RIVAL WINNER', 'RIDER 10']);
  });

  it('carries fieldSize from the source view, matching the rows returned', async () => {
    const field = await loadCategoryField(db, 1, 1, 1);
    expect(field?.fieldSize).toBe(3);
    expect(field?.rows).toHaveLength(3);
  });

  it('returns null for a Rider with no result at the Round — no Category to open', async () => {
    // Rider 2 DNFs at the Prologue (round 1) but has no row at all at State
    // Champs (round 2) — a genuine non-start, not a DNF.
    const field = await loadCategoryField(db, 2, 2, 1);
    expect(field).toBeNull();
  });
});
