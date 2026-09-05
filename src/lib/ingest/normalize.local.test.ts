/**
 * Fidelity: the decoded rows are the published rows.
 *
 * **Local lane.** These read `fixtures/` — minors' full names, schools, grades,
 * plates and finish times — so they run on a developer's machine with a human
 * present and never in CI (docs/fixtures.md, issue #29). Nothing here asserts
 * on, or can print, a rider's name: the cell-level comparisons are over place,
 * points and time, and everything else is a count.
 *
 * This is the suite that cannot be replaced by a shape test. CI can prove drift
 * is *detected*; only real rows can prove the decode is *right*.
 */

import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../db/schema.ts';
import { createTestDb, type TestDatabase } from '../db/testing.ts';
import { loadCorpus } from './corpus.ts';
import { normalize, type NormalizeResult } from './normalize.ts';
import { latestPayloads } from './raw.ts';
import { buildSnapshot } from './snapshot.ts';

/** Published row counts, from the field inventory on issue #5. */
const PUBLISHED_ROWS: Record<string, number> = {
  '357242': 535, // Race 1 Prologue — the time trial IS the flat list here
  '359477': 255,
  '359478': 214,
  '362112': 264,
  '362122': 246,
  '363499': 267,
  '363500': 260,
  '366186': 423, // State Champs
  '418436': 604, // the 2026 opener
};
const SEASON_2025_ROWS = 2464;
const TOTAL_ROWS = 3068;

/** The four 2025 events that publish `NumberOfLaps`. */
const PUBLISHES_LAP_COUNT = ['359478', '362122', '363499', '363500'];

let db: TestDatabase;
let result: NormalizeResult;

beforeAll(async () => {
  db = await createTestDb();
  await loadCorpus(db);
  result = await normalize(db);
}, 120_000);

/** The archived payload of the list normalize actually decoded, per event. */
async function decodedPayloads() {
  const archived = await latestPayloads(db);
  const chosen = new Map<string, { DataFields: string[]; data: Record<string, string[][]> }>();

  for (const list of result.placed) {
    if (!list.decoded) continue;
    const row = archived.find(
      (candidate) => candidate.eventId === list.eventId && candidate.listId === list.listId,
    );
    if (row) chosen.set(list.eventId, row.payload as never);
  }
  return chosen;
}

describe('the corpus decodes', () => {
  it('places every archived list into a declared family', () => {
    // 51 lists across 9 events. Zero unrecognized, which is what makes strict
    // fatality survivable rather than a permanent halt.
    expect(result.lists).toBe(51);
    expect(result.events).toBe(9);
  });

  it('decodes one flat individual list per event and skips the rest', () => {
    // 51 lists: 9 decoded (one per event), 42 recognized and left alone — the
    // 40 belonging to families #25 owns, plus the two hidden prologue
    // re-renders that sit beside a published mass-start list.
    expect(result.decodedLists).toBe(9);
    expect(result.skipped).toBe(42);
  });

  it('lands exactly the published row count at every event', async () => {
    const events = await db.select().from(schema.event);

    for (const event of events) {
      const rows = await db
        .select()
        .from(schema.individualResult)
        .where(eq(schema.individualResult.eventId, event.id));

      expect(rows.length, `event ${event.sourceEventId}`).toBe(PUBLISHED_ROWS[event.sourceEventId]);
    }
  });

  it('lands the whole 2025 season and the 2026 opener', async () => {
    expect(result.individualRows).toBe(TOTAL_ROWS);

    const rows = await db.select().from(schema.individualResult);
    expect(rows).toHaveLength(TOTAL_ROWS);

    const events2025 = (await db.select().from(schema.event)).filter(
      (event) => event.sourceEventId !== '418436',
    );
    const ids = new Set(events2025.map((event) => event.id));
    expect(rows.filter((row) => ids.has(row.eventId))).toHaveLength(SEASON_2025_ROWS);
  });

  it('builds the calendar the season standings can join to', async () => {
    const rounds = await db.select().from(schema.round);
    const events = await db.select().from(schema.event);

    // 2025 runs Race 1..5; 2026 has only its opener.
    expect(rounds).toHaveLength(6);
    expect(events).toHaveLength(9);
    // Race 2, 3 and 4 are two events each; Race 1 and 5 are one.
    expect(events.filter((event) => event.conference !== null)).toHaveLength(6);
  });
});

describe('fidelity', () => {
  it('stores every published place, points value and time byte-identically', async () => {
    const payloads = await decodedPayloads();
    const events = await db.select().from(schema.event);
    let compared = 0;

    for (const event of events) {
      const payload = payloads.get(event.sourceEventId)!;
      const columnOf = (aliases: string[]) =>
        aliases.map((alias) => payload.DataFields.indexOf(alias)).find((i) => i >= 0) ?? -1;

      const plateAt = columnOf(['BIB']);
      const placeAt = columnOf([
        'if(if([TransgenderOption]="Redundancy";[RANK5];[RANK1])>0;if([STATUS]<2;if([TransgenderOption]="Redundancy";[RANK5];[RANK1]);[TimeOrStatus]);"*")',
        'RankOrStatusTT',
        'if([STATUS]=3;"*";[CategoryRank])',
      ]);
      const pointsAt = columnOf(['DisplayPoints', 'PointsMatrix', 'if([TT_Rank]>0;[T1025])']);
      const timeAt = columnOf(['TimeOrStatus', 'TIME', 'WithStatus([TotalTime])']);

      const stored = new Map(
        (
          await db
            .select()
            .from(schema.individualResult)
            .where(eq(schema.individualResult.eventId, event.id))
        ).map((row) => [row.plate, row]),
      );

      for (const group of Object.values(payload.data)) {
        for (const source of group) {
          const row = stored.get(source[plateAt]!);
          expect(row, `event ${event.sourceEventId} plate ${source[plateAt]}`).toBeDefined();

          expect(row!.place, `place at ${event.sourceEventId}`).toBe(source[placeAt]);
          expect(row!.timeRaw, `time at ${event.sourceEventId}`).toBe(source[timeAt]);

          const publishedPoints = pointsAt >= 0 ? source[pointsAt] : '';
          expect(row!.points === null ? '' : String(row!.points)).toBe(publishedPoints);

          compared += 1;
        }
      }
    }

    expect(compared).toBe(TOTAL_ROWS);
  });

  it('keeps the published lap count where the source prints one', async () => {
    const payloads = await decodedPayloads();

    for (const sourceEventId of PUBLISHES_LAP_COUNT) {
      const payload = payloads.get(sourceEventId)!;
      expect(payload.DataFields).toContain('NumberOfLaps');

      const [event] = await db
        .select()
        .from(schema.event)
        .where(eq(schema.event.sourceEventId, sourceEventId));
      const stored = new Map(
        (
          await db
            .select()
            .from(schema.individualResult)
            .where(eq(schema.individualResult.eventId, event!.id))
        ).map((row) => [row.plate, row.laps]),
      );

      const plateAt = payload.DataFields.indexOf('BIB');
      const lapsAt = payload.DataFields.indexOf('NumberOfLaps');
      for (const group of Object.values(payload.data)) {
        for (const source of group) {
          expect(String(stored.get(source[plateAt]!)), sourceEventId).toBe(source[lapsAt]);
        }
      }
    }
  });

  it('recovers the lap count by counting splits where the source prints none', async () => {
    // Published at only 4 of 8 events. `v_individual_result` carries the same
    // fallback, so the two must agree or the view would contradict the table.
    const [event] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.sourceEventId, '366186'));
    const rows = await db
      .select()
      .from(schema.individualResult)
      .where(eq(schema.individualResult.eventId, event!.id));

    for (const row of rows) {
      const splits = [row.lap1, row.lap2, row.lap3, row.lap4].filter(
        (lap) => lap !== null && lap !== '-',
      );
      expect(row.laps).toBe(splits.length);
    }
    expect(rows.some((row) => row.laps === 4)).toBe(true);
  });

  it('has no lap count at all for the prologue, which publishes no splits', async () => {
    const [event] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.sourceEventId, '357242'));
    const rows = await db
      .select()
      .from(schema.individualResult)
      .where(eq(schema.individualResult.eventId, event!.id));

    expect(rows.every((row) => row.laps === null)).toBe(true);
    expect(rows.every((row) => row.lap1 === null)).toBe(true);
  });

  it('changes no rows on a second normalize', async () => {
    const key = (row: { eventId: number; plate: string }) => `${row.eventId}/${row.plate}`;
    const byKey = (rows: { eventId: number; plate: string }[]) =>
      [...rows].sort((a, b) => key(a).localeCompare(key(b)));

    const before = byKey(await db.select().from(schema.individualResult));
    await normalize(db);
    const after = byKey(await db.select().from(schema.individualResult));

    expect(after).toHaveLength(before.length);
    expect(after).toEqual(before);
  });
});

describe('identity', () => {
  it('keys on the plate, and never on ID', async () => {
    // 468 `ID` values map to more than one person across the 2025 season, and
    // 92% of multi-event riders carry a different `ID` at each event. Keying on
    // it would silently merge riders.
    const rows = await db.select().from(schema.individualResult);

    const idToPlates = new Map<string, Set<string>>();
    for (const row of rows) {
      if (row.sourceRowId === null) continue;
      const plates = idToPlates.get(row.sourceRowId) ?? new Set<string>();
      plates.add(row.plate);
      idToPlates.set(row.sourceRowId, plates);
    }

    const colliding = [...idToPlates.values()].filter((plates) => plates.size > 1).length;
    expect(colliding, 'ID collisions are real, and this is why it is not the key').toBeGreaterThan(
      100,
    );

    // The table's key is (event_id, plate), so a plate is unique per event.
    const perEvent = new Set(rows.map((row) => `${row.eventId}/${row.plate}`));
    expect(perEvent.size).toBe(rows.length);
  });

  it('stores the source CLUB as scoring_team, verbatim', async () => {
    const teams = new Set(
      (await db.select().from(schema.individualResult)).map((row) => row.scoringTeam),
    );

    // 47 distinct strings across 2025, and the 2026 opener adds more.
    expect(teams.size).toBeGreaterThanOrEqual(47);
    expect(teams.has('Salem Composite')).toBe(true);
    expect(teams.has('South Salem High School Descenders')).toBe(true);
    // The club is a config concept; this string never appears in results.
    expect(teams.has('Salem Composite Descenders')).toBe(false);
  });
});

describe('categories', () => {
  it('normalizes 43 published strings to the 14 real categories', async () => {
    const rows = await db.select().from(schema.individualResult);

    expect(new Set(rows.map((row) => row.categoryRaw)).size).toBeGreaterThan(14);
    expect(new Set(rows.map((row) => row.categoryLevel)).size).toBe(14);
  });

  it('lands both South spelling defects on their correct siblings, raw preserved', async () => {
    const rows = await db.select().from(schema.individualResult);

    const boysDefect = rows.filter((row) => row.categoryRaw === 'HS2 Boys- South');
    const girlDefect = rows.filter((row) => row.categoryRaw === 'HS2 Girl - South');

    expect(boysDefect.length).toBeGreaterThan(0);
    expect(girlDefect.length).toBeGreaterThan(0);
    expect(new Set(boysDefect.map((row) => row.categoryLevel))).toEqual(new Set(['HS2 Boys']));
    expect(new Set(girlDefect.map((row) => row.categoryLevel))).toEqual(new Set(['HS2 Girls']));
    expect(new Set(boysDefect.map((row) => row.conference))).toEqual(new Set(['South']));
  });

  it('leaves State Champs without a conference', async () => {
    const [event] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.sourceEventId, '366186'));
    const rows = await db
      .select()
      .from(schema.individualResult)
      .where(eq(schema.individualResult.eventId, event!.id));

    expect(rows.every((row) => row.conference === null)).toBe(true);
  });

  it('carries both conferences at the combined prologue', async () => {
    const [event] = await db
      .select()
      .from(schema.event)
      .where(eq(schema.event.sourceEventId, '357242'));
    const rows = await db
      .select()
      .from(schema.individualResult)
      .where(eq(schema.individualResult.eventId, event!.id));

    expect(new Set(rows.map((row) => row.conference))).toEqual(new Set(['North', 'South']));
  });
});

describe('the snapshot over the real corpus', () => {
  it('records every family, its expressions and its list assignment', () => {
    const snapshot = buildSnapshot(result.placed);

    const names = snapshot.families.map((family) => family.name).sort();
    expect(names).toEqual([
      'individual_by_team',
      'individual_flat',
      'season_individual',
      'season_team',
      'team_race_counter',
      'team_race_result',
    ]);

    const flat = snapshot.families.find((family) => family.name === 'individual_flat')!;
    // 9 decoded lists plus the two hidden prologue re-renders that lost the
    // tie-break at Race 2 North and State Champs.
    expect(flat.lists).toHaveLength(11);
    expect(flat.lists.filter((list) => list.decoded)).toHaveLength(9);
    expect(flat.lists.filter((list) => !list.decoded).every((list) => list.hidden)).toBe(true);
    expect(flat.expressions).toHaveLength(29);
    expect(new Set(flat.lists.map((list) => list.variant))).toEqual(
      new Set(['mass-start-2025', 'time-trial-2025', 'mass-start-2026']),
    );
  });

  it('carries no rider data', () => {
    const serialized = JSON.stringify(buildSnapshot(result.placed));

    // The snapshot is the artifact CI diffs on a public repo. Row counts and
    // expressions only — a category string names a contest, not a person.
    expect(serialized).not.toMatch(/\d{1,2}:\d{2}\.\d{2}/);
    expect(serialized).not.toContain('Salem Composite');
  });
});
