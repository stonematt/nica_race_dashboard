/**
 * The `[season]` segment's own reads: which years exist, which one a URL
 * segment names, and which squad a coach lands on by default (issue #88).
 *
 * Synthetic rows only, no corpus — the CI lane. Two seasons, two coaches, one
 * of whom holds more than one squad, so the deterministic tiebreak has
 * something real to break.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../lib/db/schema.ts';
import { createTestDb, type TestDatabase } from '../../lib/db/testing.ts';
import {
  listSeasonYears,
  resolveCurrentSeason,
  resolveDefaultSquad,
  resolveSeasonByYear,
} from './query.ts';

let db: TestDatabase;

const SOLO_COACH = 'coach-solo';
const MULTI_COACH = 'coach-multi';
const UNSQUADDED_COACH = 'coach-unsquadded';

beforeAll(async () => {
  db = await createTestDb();

  await db.insert(schema.season).values([
    { id: 1, year: 2025 },
    { id: 2, year: 2026 },
  ]);
  await db.insert(schema.club).values({ id: 1, name: 'Salem Composite Descenders' });

  // 2025: one squad, one coach with exactly one squad.
  await db.insert(schema.squad).values({ id: 1, clubId: 1, seasonId: 1, name: 'Descenders' });
  await db.insert(schema.squadCoach).values({ squadId: 1, userId: SOLO_COACH });

  // 2026: three squads. MULTI_COACH holds two of them, named so alphabetical
  // order does not match insertion order — the tiebreak has to actually sort.
  await db.insert(schema.squad).values([
    { id: 2, clubId: 1, seasonId: 2, name: 'Wolf Pack' },
    { id: 3, clubId: 1, seasonId: 2, name: 'Alpha Squad' },
    { id: 4, clubId: 1, seasonId: 2, name: 'Descenders' },
  ]);
  await db.insert(schema.squadCoach).values([
    { squadId: 2, userId: MULTI_COACH },
    { squadId: 3, userId: MULTI_COACH },
    { squadId: 4, userId: SOLO_COACH },
  ]);
});

describe('which years exist', () => {
  it('lists every season year, newest first', async () => {
    expect(await listSeasonYears(db)).toEqual([2026, 2025]);
  });
});

describe('the current season', () => {
  it('is the latest year on record', async () => {
    expect(await resolveCurrentSeason(db)).toEqual({ id: 2, year: 2026 });
  });

  it('is null before anything is seeded', async () => {
    const empty = await createTestDb();
    expect(await resolveCurrentSeason(empty)).toBeNull();
  });
});

describe('resolving a URL segment to a season', () => {
  it('finds the season named by a real year', async () => {
    expect(await resolveSeasonByYear(db, '2025')).toEqual({ id: 1, year: 2025 });
  });

  it('is null for a year nothing was seeded under', async () => {
    expect(await resolveSeasonByYear(db, '1999')).toBeNull();
  });

  it('is null for a segment that is not a plain integer', async () => {
    expect(await resolveSeasonByYear(db, '2025abc')).toBeNull();
    expect(await resolveSeasonByYear(db, 'wolf-pack')).toBeNull();
    expect(await resolveSeasonByYear(db, '-2025')).toBeNull();
    expect(await resolveSeasonByYear(db, '')).toBeNull();
  });
});

describe('a coach’s default squad', () => {
  it('is null with no signed-in coach', async () => {
    expect(await resolveDefaultSquad(db, null, 2)).toBeNull();
  });

  it('is null for a coach who holds no squad this season', async () => {
    expect(await resolveDefaultSquad(db, UNSQUADDED_COACH, 2)).toBeNull();
  });

  it('is the one squad, when there is only one', async () => {
    expect(await resolveDefaultSquad(db, SOLO_COACH, 1)).toEqual({ id: 1, name: 'Descenders' });
  });

  it('does not cross seasons: the same coach elsewhere has a different squad', async () => {
    expect(await resolveDefaultSquad(db, SOLO_COACH, 2)).toEqual({ id: 4, name: 'Descenders' });
  });

  it('falls back to the season’s only squad when no coach link resolves', async () => {
    // The dev sign-in hands back a session whose user.id is the typed email,
    // never the `user` row's id, so `coach.user_id` cannot match under it.
    // One squad in the season is not ambiguous, so it is the answer.
    expect(await resolveDefaultSquad(db, 'nobody@example.test', 1)).toEqual({
      id: 1,
      name: 'Descenders',
    });
  });

  it('does not guess when the season holds more than one squad', async () => {
    expect(await resolveDefaultSquad(db, 'nobody@example.test', 2)).toBeNull();
  });

  it('picks deterministically by lowest squad name when a coach holds more than one', async () => {
    // MULTI_COACH holds 'Wolf Pack' (id 2) and 'Alpha Squad' (id 3) — 'Alpha
    // Squad' collates first, regardless of insertion or id order.
    expect(await resolveDefaultSquad(db, MULTI_COACH, 2)).toEqual({ id: 3, name: 'Alpha Squad' });
  });
});
