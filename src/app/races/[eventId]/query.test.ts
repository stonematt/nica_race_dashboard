/**
 * The race-detail page, end to end against a real Postgres — the views, the
 * config join, and the assembled cards.
 *
 * Default lane: PGlite in memory, synthetic rows, no corpus. The numbers are
 * shaped after 2025 Race 4 North, because that event is where each guard has a
 * real counterexample, but nobody here is a real person: riders are
 * `«RIDER-A»`, the redaction form `docs/fixtures.md` names.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../../lib/db/schema.ts';
import { createTestDb, type TestDatabase } from '../../../lib/db/testing.ts';
import { listRaces, loadRaceDetail, resolveClub } from './query.ts';

let db: TestDatabase;

const EVENT_ID = 1;
const SOURCE_EVENT_ID = '363499';

/**
 * The same nineteen results, inserted in a deliberately shuffled order.
 *
 * A re-normalize, a roster edit or the move to hosted Postgres is free to hand
 * the view its rows in any order at all. This event is that, made explicit:
 * whatever it renders must match what `SOURCE_EVENT_ID` renders (issue #61).
 */
const SCRAMBLED_EVENT_ID = 2;
const SCRAMBLED_SOURCE_EVENT_ID = '363500';

/** (plate, place, seconds, laps, status) — HS1 Boys, twelve starters. */
const HS1_BOYS: readonly [string, string, number | null, number, 'finished' | 'dnf'][] = [
  ['974', '1', 2829.83, 3, 'finished'], // the winner
  ['876', '2', 2873.45, 3, 'finished'],
  ['886', '3', 3383.21, 3, 'finished'], // ours — 19.6% back
  ['901', '4', 3400.0, 3, 'finished'],
  ['902', '5', 3450.0, 3, 'finished'],
  ['903', '6', 3500.0, 3, 'finished'],
  ['904', '7', 3550.0, 3, 'finished'],
  ['905', '8', 3600.0, 3, 'finished'],
  ['906', '9', 3650.0, 3, 'finished'],
  ['930', '10', 4582.06, 3, 'finished'],
  // Pulled a lap short. Faster clock than the four riders above it, and the
  // source still ranks it 11th.
  ['204', '11', 2950.82, 2, 'finished'], // ours — lapped
  ['928', '*', null, 1, 'dnf'], // ours — DNF
];

/** HS2 Girls fielded seven. Too few to rank, and one of them is ours. */
const HS2_GIRLS: readonly [string, string, number | null, number, 'finished' | 'dnf'][] = [
  ['501', '1', 3000.0, 3, 'finished'],
  ['502', '2', 3100.0, 3, 'finished'],
  ['503', '3', 3200.0, 3, 'finished'], // ours
  ['504', '4', 3300.0, 3, 'finished'],
  ['505', '5', 3400.0, 3, 'finished'],
  ['506', '6', 3500.0, 3, 'finished'],
  ['507', '7', 3600.0, 3, 'finished'],
];

const DESCENDERS = 'Sprague High School Descenders';
const OURS = new Set(['886', '204', '928', '503']);
/** On a Descenders scoring team and mapped to nobody — the warning's whole job. */
const UNMAPPED_PLATE = '905';

function rows(
  list: readonly [string, string, number | null, number, 'finished' | 'dnf'][],
  categoryRaw: string,
) {
  return list.map(([plate, place, seconds, laps, status]) => ({
    eventId: EVENT_ID,
    plate,
    displayName: `«RIDER-${plate}»`,
    scoringTeam:
      OURS.has(plate) || plate === UNMAPPED_PLATE ? DESCENDERS : 'Some Other High School',
    categoryRaw,
    place,
    status,
    timeRaw: seconds === null ? 'DNF' : String(seconds),
    timeSeconds: seconds === null ? null : String(seconds),
    points: 500 - Number(place === '*' ? 40 : place) * 10,
    laps,
    lap1: '15:42.11',
    lap2: laps > 1 ? '15:39.02' : '-',
    lap3: laps > 2 ? '15:48.70' : '-',
  }));
}

/** Deal from both ends, alternating. Deterministic, and nothing like the input. */
function shuffle<T>(list: readonly T[]): T[] {
  const out: T[] = [];
  for (let lo = 0, hi = list.length - 1; lo <= hi; lo++, hi--) {
    out.push(list[hi]!);
    if (lo !== hi) out.push(list[lo]!);
  }
  return out;
}

beforeAll(async () => {
  db = await createTestDb();

  await db.insert(schema.season).values({ id: 1, year: 2025 });
  await db.insert(schema.round).values({ id: 1, seasonId: 1, ordinal: 4, name: 'Race 4' });
  await db.insert(schema.event).values({
    id: EVENT_ID,
    roundId: 1,
    sourceEventId: SOURCE_EVENT_ID,
    conference: 'North',
    name: 'Race 4 - Newport Gnarnia - North',
  });
  const published = [
    ...rows(HS1_BOYS, 'HS1 Boys - North'),
    ...rows(HS2_GIRLS, 'HS2 Girls - North'),
  ];
  await db.insert(schema.individualResult).values(published);

  // The same results again, under a second event, dealt in from both ends so
  // that no category is contiguous and no place is in order.
  await db.insert(schema.round).values({ id: 2, seasonId: 1, ordinal: 5, name: 'Race 5' });
  await db.insert(schema.event).values({
    id: SCRAMBLED_EVENT_ID,
    roundId: 2,
    sourceEventId: SCRAMBLED_SOURCE_EVENT_ID,
    conference: 'North',
    name: 'Race 5 - Newport Gnarnia - North',
  });
  await db
    .insert(schema.individualResult)
    .values(shuffle(published).map((r) => ({ ...r, eventId: SCRAMBLED_EVENT_ID })));

  // Config: one club, one scoring team, one squad, four riders — one of whom
  // raced for the club and is mapped to nobody.
  await db.insert(schema.club).values({ id: 1, name: 'Salem Composite Descenders' });
  await db
    .insert(schema.clubScoringTeam)
    .values({ clubId: 1, seasonId: 1, scoringTeam: DESCENDERS });
  await db.insert(schema.squad).values({ id: 1, clubId: 1, seasonId: 1, name: 'Descenders' });
  await db.insert(schema.rider).values([
    { id: 1, displayName: '«RIDER-A»' },
    { id: 2, displayName: '«RIDER-B»' },
    { id: 3, displayName: '«RIDER-C»' },
    { id: 4, displayName: '«RIDER-D»' },
  ]);
  await db.insert(schema.riderPlate).values([
    { riderId: 1, seasonId: 1, plate: '886' },
    { riderId: 2, seasonId: 1, plate: '204' },
    { riderId: 3, seasonId: 1, plate: '928' },
    { riderId: 4, seasonId: 1, plate: '503' },
  ]);
  await db.insert(schema.squadMember).values([
    { squadId: 1, riderId: 1 },
    { squadId: 1, riderId: 2 },
    { squadId: 1, riderId: 3 },
    { squadId: 1, riderId: 4 },
  ]);

  // Next season, same club, same riders, a squad the coach renamed. Squads are
  // season-keyed (#81), so nothing but the season separates this from the one
  // above — which is exactly what a race page must not get wrong.
  await db.insert(schema.season).values({ id: 2, year: 2026 });
  await db.insert(schema.squad).values({ id: 2, clubId: 1, seasonId: 2, name: 'Racers' });
  await db.insert(schema.squadMember).values([
    { squadId: 2, riderId: 1 },
    { squadId: 2, riderId: 2 },
  ]);
});

const detail = async () => (await loadRaceDetail(db, SOURCE_EVENT_ID, null))!;
const cardFor = async (name: string) =>
  (await detail()).squads[0]!.riders.find((r) => r.card.name === name)!;

describe('the race', () => {
  it('is found by its published event id', async () => {
    const page = await detail();
    expect(page.race.name).toBe('Race 4 - Newport Gnarnia - North');
    expect(page.race.seasonYear).toBe(2025);
    expect(page.starters).toBe(HS1_BOYS.length + HS2_GIRLS.length);
  });

  it('is null for an event that was never archived', async () => {
    expect(await loadRaceDetail(db, '999999', null)).toBeNull();
  });

  it('lists itself among the races there are to open', async () => {
    const races = await listRaces(db);
    // Newest first: Race 5 is the later round.
    expect(races.map((r) => r.sourceEventId)).toEqual([SCRAMBLED_SOURCE_EVENT_ID, SOURCE_EVENT_ID]);
  });
});

describe('squad is the frame, not a filter', () => {
  it('groups the club roster under their squad', async () => {
    const page = await detail();
    expect(page.squads).toHaveLength(1);
    expect(page.squads[0]!.name).toBe('Descenders');
    expect(page.squads[0]!.riders.map((r) => r.card.name).sort()).toEqual([
      '«RIDER-A»',
      '«RIDER-B»',
      '«RIDER-C»',
      '«RIDER-D»',
    ]);
  });

  it('counts the squad in its header, DNF included', async () => {
    expect((await detail()).squads[0]!.summary).toBe('4 raced · 0 scored · 1 DNF');
  });

  it('shows only the squads that existed in this race’s season', async () => {
    const page = await detail();
    expect(page.squads.map((s) => s.name)).toEqual(['Descenders']);
  });

  it('does not draw a rider onto a squad from another season', async () => {
    const page = await detail();
    expect(page.squads.flatMap((s) => s.riders)).toHaveLength(4);
  });
});

describe('the strip is drawn against the whole category', () => {
  it('hands every starter in the category to the strip, ours marked', async () => {
    const rider = await cardFor('«RIDER-A»'); // HS1 Boys, 12 starters
    expect(rider.field).toHaveLength(HS1_BOYS.length);
    expect(rider.field.filter((m) => m.ours)).toHaveLength(1);
  });

  it('gives a rider from a different category their own field', async () => {
    const rider = await cardFor('«RIDER-D»'); // HS2 Girls, 7 starters
    expect(rider.field).toHaveLength(HS2_GIRLS.length);
  });

  it('leaves the lapped and the DNF off the axis', async () => {
    const field = (await cardFor('«RIDER-A»')).field;
    expect(field.filter((m) => m.pct === null)).toHaveLength(2);
  });
});

describe('the five guards, on rows that came out of the database', () => {
  it('renders a lapped rider as a lap deficit and never a percentage', async () => {
    const rider = await cardFor('«RIDER-B»');
    expect(rider.card.headline).toEqual({
      kind: 'laps-down',
      value: '−1 lap',
      caption: '11 of 12',
    });
    expect(rider.card.mark.pct).toBeNull();
  });

  it('shows no percentile for a field of seven', async () => {
    const rider = await cardFor('«RIDER-D»');
    const field = rider.card.stats.find((s) => s.label === 'Field')!;
    expect(field.value).toBe('7 started, too few to rank');
  });

  it('shows the percentile above the median and the place below it', async () => {
    // «RIDER-A» is 3rd of 12 — top 25%.
    expect((await cardFor('«RIDER-A»')).card.stats.find((s) => s.label === 'Field')!.value).toBe(
      'top 25%',
    );
    // «RIDER-B» is 11th of 12, below the median: the raw place, not a percentile.
    expect((await cardFor('«RIDER-B»')).card.stats.find((s) => s.label === 'Field')!.value).toBe(
      '11 of 12',
    );
  });

  it('renders a DNF as published, with its points intact', async () => {
    const rider = await cardFor('«RIDER-C»');
    const cells = Object.fromEntries(rider.card.stats.map((s) => [s.label, s.value]));
    expect(rider.card.headline.kind).toBe('dnf');
    expect(cells.Place).toBe('—');
    expect(cells.Time).toBe('—');
    expect(cells.Points).toBe('100');
  });

  it('puts an unmapped club rider in the warning, not among the cards', async () => {
    const page = await detail();
    expect(page.unmapped).toEqual([
      { plate: UNMAPPED_PLATE, name: `«RIDER-${UNMAPPED_PLATE}»`, scoringTeam: DESCENDERS },
    ]);
    const carded = page.squads.flatMap((s) => s.riders.map((r) => r.card.plate));
    expect(carded).not.toContain(UNMAPPED_PLATE);
  });
});

describe('percent back, taken from the view and never recomputed', () => {
  it('reads the published percentage for a full-distance finisher', async () => {
    // 3383.21 / 2829.83 - 1 = 19.55% -> 19.6, computed in v_race_result.
    expect((await cardFor('«RIDER-A»')).card.headline).toEqual({
      kind: 'pct-back',
      value: '19.6%',
      caption: 'back',
    });
  });
});

describe('which club is asking', () => {
  it('falls back to the only club when the user has no coach profile', async () => {
    expect(await resolveClub(db, null)).toEqual({ id: 1, name: 'Salem Composite Descenders' });
  });
});

describe('card order, decided by the builder rather than the query plan', () => {
  const cardPlates = async (sourceEventId: string) =>
    (await loadRaceDetail(db, sourceEventId, null))!.squads[0]!.riders.map((r) => r.card.plate);

  it('runs the cards category by category, then by place, DNF last', async () => {
    // HS1 Boys before HS2 Girls, and within HS1 Boys: 3rd, 11th, then the DNF.
    expect(await cardPlates(SOURCE_EVENT_ID)).toEqual(['886', '204', '928', '503']);
  });

  it('renders the same order twice running', async () => {
    expect(await cardPlates(SOURCE_EVENT_ID)).toEqual(await cardPlates(SOURCE_EVENT_ID));
  });

  it('renders the same order from rows inserted in a different order', async () => {
    expect(await cardPlates(SCRAMBLED_SOURCE_EVENT_ID)).toEqual(await cardPlates(SOURCE_EVENT_ID));
  });

  it('hands the strip its field in a defined order too', async () => {
    const page = await loadRaceDetail(db, SCRAMBLED_SOURCE_EVENT_ID, null);
    const field = page!.squads[0]!.riders[0]!.field.map((m) => m.pct);

    // Every placeable rider first, slowest last; the lapped and the DNF behind them.
    const placed = field.filter((pct): pct is number => pct !== null);
    expect(field.slice(0, placed.length)).toEqual(placed);
    expect(placed).toEqual([...placed].sort((a, b) => a - b));
    expect(field.slice(placed.length)).toEqual([null, null]);
  });
});
