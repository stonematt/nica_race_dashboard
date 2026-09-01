/**
 * The domain views carry the guards, so the guards get tested here rather than
 * in the render layer. Numbers are the real published 2025 Race 4 North HS1
 * Boys results — the case a naive percent-back gets backwards.
 */

import { sql } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.ts';

type Db = ReturnType<typeof drizzle<typeof schema>>;
let db: Db;

/** (plate, place, time_seconds, laps, status) straight off the published list. */
const HS1_BOYS_NORTH = [
  ['974', '1', 2829.83, 3, 'finished'], // winner, 47:09.83
  ['876', '2', 2873.45, 3, 'finished'],
  ['886', '20', 3383.21, 3, 'finished'], // 56:23.21
  ['930', '63', 4582.06, 3, 'finished'], // 1:16:22.06
  // Pulled a lap short. Their clock times are FASTER than the 3-lap riders
  // above, and the source still ranks them 65th and 67th. A naive
  // time / winner_time would put both ahead of the winner.
  ['204', '65', 2950.82, 2, 'lapped'], // 49:10.82
  ['888', '67', 3060.8, 2, 'lapped'], // 51:00.80
  ['928', '*', null, 1, 'dnf'],
] as const;

beforeAll(async () => {
  const client = new PGlite(); // in-memory; nothing to clean up
  db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: './src/lib/db/migrations' });

  await db.insert(schema.season).values({ id: 1, year: 2025 });
  await db.insert(schema.round).values({ id: 1, seasonId: 1, ordinal: 4, name: 'Race 4' });
  await db.insert(schema.event).values({
    id: 1,
    roundId: 1,
    sourceEventId: '363499',
    conference: 'North',
    name: 'Race 4 - ORLeague Newport Gnarnia - North',
  });

  await db.insert(schema.individualResult).values(
    HS1_BOYS_NORTH.map(([plate, place, seconds, laps, status]) => ({
      eventId: 1,
      plate,
      displayName: `RIDER ${plate}`,
      scoringTeam: plate === '886' ? 'Sprague High School Descenders' : 'Some Other Team',
      categoryRaw: 'HS1 Boys - North',
      place,
      status,
      timeRaw: seconds === null ? 'DNF' : String(seconds),
      timeSeconds: seconds === null ? null : String(seconds),
      laps,
    })),
  );
});

const rows = async () =>
  (
    await db.execute(
      `select plate, place, laps, is_lapped, laps_down, pct_back, field_size, field_top_pct
         from v_race_result where event_id = 1 order by (place ~ '^\\d+$') desc, place::text`,
    )
  ).rows as Record<string, unknown>[];

describe('v_race_result', () => {
  it('gives the winner 0% back', async () => {
    const winner = (await rows()).find((r) => r.plate === '974');
    expect(Number(winner!.pct_back)).toBe(0);
  });

  it('never places a lapped rider on the percent-back axis', async () => {
    const lapped = (await rows()).filter((r) => r.is_lapped === true);
    expect(lapped.map((r) => r.plate).sort()).toEqual(['204', '888']);
    for (const r of lapped) {
      // The whole point: a faster clock time than the 3-lap riders, and still
      // no percentage. Rendering one here would invert the ordering.
      expect(r.pct_back).toBeNull();
      expect(Number(r.laps_down)).toBe(1);
    }
  });

  it('gives a DNF no percentage and no lap comparison', async () => {
    const dnf = (await rows()).find((r) => r.plate === '928');
    expect(dnf!.pct_back).toBeNull();
    expect(dnf!.is_lapped).toBe(false);
  });

  it('computes percent back against the full-lap winner only', async () => {
    const r = (await rows()).find((x) => x.plate === '886');
    // 3383.21 / 2829.83 - 1 = 19.55% -> 19.6
    expect(Number(r!.pct_back)).toBeCloseTo(19.6, 1);
  });

  it('suppresses the field percentile below n=10', async () => {
    // This fixture fields 7, which is exactly the HS2 Girls case at this event.
    const all = await rows();
    expect(Number(all[0].field_size)).toBe(7);
    expect(all.every((r) => r.field_top_pct === null)).toBe(true);
  });
});

describe('v_individual_result', () => {
  it('normalizes the category and keeps the raw string', async () => {
    const r = (
      await db.execute(
        `select category, category_raw, conference from v_individual_result where plate = '974'`,
      )
    ).rows[0] as Record<string, unknown>;
    expect(r.category).toBe('HS1 Boys');
    expect(r.category_raw).toBe('HS1 Boys - North');
    expect(r.conference).toBe('North');
  });

  it('repairs the two published category spellings', async () => {
    const got = (
      await db.execute(
        `select
           regexp_replace(regexp_replace(btrim('HS2 Boys- South'), '\\s*-\\s*(North|South)\\s*$', ''), 'Girl$', 'Girls') a,
           regexp_replace(regexp_replace(btrim('HS2 Girl - South'), '\\s*-\\s*(North|South)\\s*$', ''), 'Girl$', 'Girls') b`,
      )
    ).rows[0] as Record<string, unknown>;
    expect(got.a).toBe('HS2 Boys');
    expect(got.b).toBe('HS2 Girls');
  });

  it('keeps flat-list rows that have no By-Team sidecar row', async () => {
    // By-Team is HS-only and misses two rows in the 2025 corpus. A LEFT join is
    // load-bearing: an inner join would silently drop published results.
    const n = (await db.execute(`select count(*)::int n from v_individual_result`))
      .rows[0] as Record<string, number>;
    expect(n.n).toBe(HS1_BOYS_NORTH.length);
  });
});

describe('v_unmapped_rider', () => {
  it('flags a club rider with no plate mapping, and stays quiet once mapped', async () => {
    await db.insert(schema.club).values({ id: 1, name: 'Salem Composite Descenders' });
    await db.insert(schema.clubScoringTeam).values({
      clubId: 1,
      seasonId: 1,
      scoringTeam: 'Sprague High School Descenders',
    });

    const before = (await db.execute(`select plate from v_unmapped_rider`)).rows;
    expect(before.map((r) => (r as Record<string, unknown>).plate)).toEqual(['886']);

    await db.insert(schema.rider).values({ id: 1, displayName: 'A Rider' });
    await db.insert(schema.riderPlate).values({ riderId: 1, seasonId: 1, plate: '886' });

    const after = (await db.execute(`select plate from v_unmapped_rider`)).rows;
    expect(after).toHaveLength(0);
  });

  it('resolves rider identity within the plate\'s race bounds only', async () => {
    // A plate reissued mid-season: bounded rows keep the two people apart.
    await db.insert(schema.rider).values({ id: 2, displayName: 'Second Person' });
    await db
      .update(schema.riderPlate)
      .set({ toRoundOrdinal: 3 })
      .where(sql`plate = '886'`);
    await db.insert(schema.riderPlate).values({
      riderId: 2,
      seasonId: 1,
      plate: '886',
      fromRoundOrdinal: 4,
    });

    const r = (await db.execute(`select rider_id, rider_name from v_rider_result where plate = '886'`))
      .rows as Record<string, unknown>[];
    expect(r).toHaveLength(1);
    expect(r[0].rider_name).toBe('Second Person');
  });
});
