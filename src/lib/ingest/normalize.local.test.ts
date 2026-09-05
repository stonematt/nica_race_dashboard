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

import { eq, sql } from 'drizzle-orm';
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

/** The archived payload of the spine list normalize decoded, per event. */
async function decodedPayloads() {
  const archived = await latestPayloads(db);
  const chosen = new Map<string, { DataFields: string[]; data: Record<string, string[][]> }>();

  for (const list of result.placed) {
    if (!list.decoded || list.family.target !== 'individual_result') continue;
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

  it('decodes every list that feeds a table, and says why it skipped the rest', () => {
    // 51 lists: 37 decoded, 14 recognized and deliberately not written — the
    // two hidden prologue re-renders that lose the Mode tie-break, and the
    // twelve season lists that are snapshots, the prologue's own list, or the
    // degenerate State Champs copies rather than the season record.
    expect(result.decodedLists).toBe(37);
    expect(result.skipped).toBe(14);
    expect(result.placed.filter((list) => !list.decoded && list.skippedBecause === null)).toEqual(
      [],
    );
  });

  it('populates every source-mirroring table', () => {
    expect(result.rows).toEqual({
      individual_result: TOTAL_ROWS,
      // Every By-Team row across the season, high school only.
      individual_result_by_team: 1338,
      team_race_result: 234,
      team_race_counter: 1564,
      // 319 North + 322 South riders, from the two Race 4 events only.
      season_individual_standing: 641,
      season_individual_race_points: 2564,
      season_team_standing: 48,
    });
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
    expect(result.rows.individual_result ?? 0).toBe(TOTAL_ROWS);

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

describe('the By-Team sidecar', () => {
  it('lands 1,336 of 1,338 rows on the spine, and keeps both orphans', async () => {
    // An inner join here would silently delete two published results. The
    // sidecar is its own table precisely so it cannot.
    const sidecar = await db.select().from(schema.individualResultByTeam);
    expect(sidecar).toHaveLength(1338);

    const spine = new Set(
      (await db.select().from(schema.individualResult)).map((row) => `${row.eventId}/${row.plate}`),
    );
    const matched = sidecar.filter((row) => spine.has(`${row.eventId}/${row.plate}`));

    expect(matched).toHaveLength(1336);
    expect(sidecar.length - matched.length).toBe(2);
  });

  it('contributes zero middle-school rows, and that is the finding', async () => {
    // Every one of the 1,338 rows nests under a single `High School` node, so
    // gender and grade are unavailable for every MS rider by construction. It
    // is asserted rather than treated as missing data.
    const ms = await db.execute(
      sql.raw(`select count(*)::int as n
               from individual_result_by_team bt
               join individual_result ir
                 on ir.event_id = bt.event_id and ir.plate = bt.plate
               where ir.category_grade_band like 'MS%'`),
    );

    expect((ms.rows[0] as { n: number }).n).toBe(0);
  });

  it('normalizes the grade drift and leaves the six blanks unknown', async () => {
    const grades = await db.select().from(schema.individualResultByTeam);
    const distinct = new Set(grades.map((row) => row.grade));

    expect([...distinct].sort()).toEqual(['10', '11', '12', '8', '9', null].sort());
    expect(grades.filter((row) => row.grade === null)).toHaveLength(6);
    // "9.0" was published at Race 1 and Race 2 South; nothing keeps that form.
    expect([...distinct].some((grade) => grade?.includes('.'))).toBe(false);
  });

  it('records which riders counted toward the team score', async () => {
    const rows = await db.select().from(schema.individualResultByTeam);

    expect(rows.filter((row) => row.scored)).toHaveLength(848);
    expect(rows.filter((row) => !row.scored)).toHaveLength(490);
  });
});

describe('the team lists', () => {
  it('carries the middle-school competition no other list publishes', async () => {
    const counters = await db.select().from(schema.teamRaceCounter);
    const ms = counters.filter((row) => row.level === 'Middle School');

    expect(ms.length).toBeGreaterThan(500);
    expect(new Set(ms.map((row) => row.scoringTeam)).size).toBe(25);
    // ...and the per-race team list it would otherwise have to come from is
    // high-school only at all eight events.
    expect(new Set(counters.map((row) => row.level))).toEqual(
      new Set(['High School', 'Middle School', null]),
    );
  });

  it('splits the packed team node, penalty tail included', async () => {
    const counters = await db.select().from(schema.teamRaceCounter);

    expect(counters.every((row) => row.scoringTeam.length > 0)).toBe(true);
    expect(counters.every((row) => row.teamPoints !== null)).toBe(true);
    // No penalty was assessed anywhere in 2025 — the tail parses to 0, not null.
    expect(new Set(counters.map((row) => row.teamPenaltyPoints))).toEqual(new Set([0]));
  });

  it('keeps the eighty unclassified State Champs rows', async () => {
    const unclassified = (await db.select().from(schema.teamRaceCounter)).filter(
      (row) => row.level === null,
    );

    expect(unclassified).toHaveLength(80);
    expect(unclassified.every((row) => row.teamPoints === 0)).toBe(true);
  });

  it('stores an unassessed team penalty as null rather than zero', async () => {
    const teams = await db.select().from(schema.teamRaceResult);

    expect(teams).toHaveLength(234);
    expect(teams.every((row) => row.penaltyPoints === null)).toBe(true);
  });
});

describe('the season standings', () => {
  it('reads only the Race 4 copies, and only for a conference', async () => {
    const standings = await db.select().from(schema.seasonIndividualStanding);

    expect(new Set(standings.map((row) => row.sourceEventId))).toEqual(
      new Set(['363499', '363500']),
    );
    expect(new Set(standings.map((row) => row.conference))).toEqual(new Set(['North', 'South']));
    // Every row publishes the real drop rule. A `1/1` would be the State
    // Champs copy, which supersedes nothing.
    expect(new Set(standings.map((row) => row.bestOf))).toEqual(new Set(['3/4']));
  });

  it('never writes the degenerate State Champs copies', async () => {
    const teams = await db.select().from(schema.seasonTeamStanding);

    expect(new Set(teams.map((row) => row.sourceEventId))).toEqual(new Set(['363499', '363500']));
    expect(teams.every((row) => (row.seasonTotal ?? 0) > 0)).toBe(true);
  });

  it('leaves the South low score null and never repairs it with min()', async () => {
    const standings = await db.select().from(schema.seasonIndividualStanding);
    const south = standings.filter((row) => row.sourceEventId === '363500');
    const north = standings.filter((row) => row.sourceEventId === '363499');

    // 363500 omits the LOW SCORE column entirely; 363499 publishes it.
    expect(south.every((row) => row.lowScore === null)).toBe(true);
    expect(north.every((row) => row.lowScore !== null)).toBe(true);
  });

  it('goes long, and stores the Upgrade sentinel and the drop marker', async () => {
    const points = await db.select().from(schema.seasonIndividualRacePoints);

    expect(points).toHaveLength(2564);
    expect(new Set(points.map((row) => row.roundOrdinal))).toEqual(new Set([1, 2, 3, 4]));
    expect(points.filter((row) => row.isUpgrade).length).toBeGreaterThan(0);
    expect(points.filter((row) => row.isUpgrade).every((row) => row.points === 'Upgrade')).toBe(
      true,
    );
    expect(points.filter((row) => row.isDropped)).toHaveLength(552);
  });

  it('marks no drop where the South list omits the formatting column', async () => {
    // 363500 drops LowScoreFormatting(1) entirely, so where RACE1 was the
    // dropped race the list carries no marker. Recorded, never inferred.
    const marked = await db.execute(
      sql.raw(`select s.source_event_id, count(*) filter (where p.is_dropped)::int as marked
               from season_individual_race_points p
               join season_individual_standing s on s.id = p.standing_id
               group by 1 order by 1`),
    );

    const rows = marked.rows as { source_event_id: string; marked: number }[];
    expect(rows.find((row) => row.source_event_id === '363499')!.marked).toBe(319);
    expect(rows.find((row) => row.source_event_id === '363500')!.marked).toBeLessThan(322);
  });
});

describe('reconciliation with the per-race lists (issue #10)', () => {
  it('agrees on all 1,505 comparable per-race point values, with zero disagreements', async () => {
    // The season list is the authority where they disagree. They do not.
    //
    // 1,505, not #10's headline 1,527: rounds 2, 3 and 4 only. Round 1's
    // points are not comparable from this database at all — the 2025 prologue's
    // `individual_result` rows come from the time-trial list, whose points
    // column is empty in all 535 rows, and the only list that publishes Race 1
    // points is `357242`'s `Individual Results - Overall`, which is the
    // prologue's own result list rather than a season standing and has no table
    // to land in. Recorded as a gap, not papered over.
    const compared = await db.execute(
      sql.raw(`select count(*)::int as n,
                      count(*) filter (where p.points <> ir.points::text)::int as disagree
               from season_individual_race_points p
               join season_individual_standing s on s.id = p.standing_id
               join round rd on rd.season_id = s.season_id and rd.ordinal = p.round_ordinal
               join event e on e.round_id = rd.id
                 and (e.conference = s.conference or e.conference is null)
               join individual_result ir on ir.event_id = e.id and ir.plate = s.plate
               where p.points ~ '^[0-9]+$' and ir.points is not null`),
    );

    const { n, disagree } = compared.rows[0] as { n: number; disagree: number };
    expect(disagree).toBe(0);
    expect(n).toBe(1505);
  });

  it('compares no round-1 points, because none are queryable', async () => {
    const rounds = await db.execute(
      sql.raw(`select p.round_ordinal, count(*)::int as n
               from season_individual_race_points p
               join season_individual_standing s on s.id = p.standing_id
               join round rd on rd.season_id = s.season_id and rd.ordinal = p.round_ordinal
               join event e on e.round_id = rd.id
                 and (e.conference = s.conference or e.conference is null)
               join individual_result ir on ir.event_id = e.id and ir.plate = s.plate
               where p.points ~ '^[0-9]+$' and ir.points is not null
               group by 1 order by 1`),
    );

    expect(
      (rounds.rows as { round_ordinal: number; n: number }[]).map((r) => r.round_ordinal),
    ).toEqual([2, 3, 4]);
  });

  it('excludes the four Upgrade cells deliberately, not by accident', async () => {
    // A rider who changed category mid-season shows `Upgrade` where a number
    // would go, and the per-race list still publishes the points they scored
    // under the old category. The season list wins; those points do not carry.
    const upgrades = await db
      .select()
      .from(schema.seasonIndividualRacePoints)
      .where(eq(schema.seasonIndividualRacePoints.isUpgrade, true));

    expect(upgrades).toHaveLength(4);
    expect(upgrades.every((row) => row.points === 'Upgrade')).toBe(true);
  });

  it('agrees on all 48 team season rows, cell by cell', async () => {
    const compared = await db.execute(
      sql.raw(`select count(*)::int as n,
                      count(*) filter (where (st.race_points ->> rd.ordinal::text)::int
                                             is distinct from tr.points)::int as disagree
               from season_team_standing st
               join round rd on rd.season_id = st.season_id
               join event e on e.round_id = rd.id and e.conference = st.conference
               join team_race_result tr
                 on tr.event_id = e.id and tr.scoring_team = st.scoring_team
               where st.race_points ? rd.ordinal::text`),
    );

    const { n, disagree } = compared.rows[0] as { n: number; disagree: number };
    expect(disagree).toBe(0);
    // 48 team season rows over rounds 2, 3 and 4 is 144 cells, less the three
    // South teams that publish an empty RACE 4 where that race's own list
    // publishes 0. The empty cell stays absent, so it is not compared.
    expect(n).toBe(141);
    expect(await db.select().from(schema.seasonTeamStanding)).toHaveLength(48);
  });

  it('has SEASON equal to the sum of the published per-race scores', async () => {
    // RACE 2 + RACE 3 + RACE 4, no drop. Asserted, never computed into the row.
    const teams = await db.select().from(schema.seasonTeamStanding);

    for (const team of teams) {
      const races = Object.values(team.racePoints as Record<string, number>);
      const sum = races.reduce((total, points) => total + points, 0);
      expect(team.seasonTotal, `${team.conference} ${team.scoringTeam}`).toBe(sum);
    }
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
