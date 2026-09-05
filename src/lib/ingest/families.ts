/**
 * What each published list *is*, declared by the shape of its columns.
 *
 * **A list is never identified by its name.** The same logical list is named
 * four ways inside one 2025 season (`Individual Results - ALL`, `- North`,
 * `- South`, and at Race 1 `Prologue/TT Results ALL`), the 2026 opener renamed
 * everything again with an `Online|` prefix, and the config's hex ID differs
 * per event. What does not drift is the set of expressions the list carries, so
 * that is the identity: a family declares a signature, and a list belongs to
 * the family whose signature it satisfies.
 *
 * Assignment is strict in both directions. **Zero matches is fatal** — an
 * unrecognized list means the source published something this code has never
 * seen, and quietly skipping it is how a season goes missing. **Two matches is
 * also fatal** — overlapping signatures mean the declarations have stopped
 * describing reality, and picking one would be a guess.
 *
 * Each family carries its own declaration: the canonical fields it requires,
 * the aliases each has been published under, its repeat groups, and its
 * known-but-ignored expressions. That last one is what makes strict
 * unknown-expression fatality usable at all — recognized means mapped *or*
 * deliberately unmapped, so an expression nobody has classified halts the event
 * instead of being decoded around.
 */

import type { ColumnLayout } from './columns.ts';
import { IngestError } from './errors.ts';

/** A list that matches no family, or more than one. */
export class FamilyError extends IngestError {}

/** Which table a family's rows land in. */
export type FamilyTarget =
  | 'individual_result'
  | 'individual_result_by_team'
  | 'team_race_result'
  | 'team_race_counter'
  | 'season_individual_standing'
  | 'season_team_standing';

/**
 * A block of columns whose width tracks the season rather than the schema.
 *
 * Season overall publishes `RACE1`–`RACE10` in the mid-season snapshots and
 * `RACE1`–`RACE4` at Race 4, so there is no fixed set of expressions to
 * require. Under strict unknown-expression fatality that has to be a
 * first-class concept — a pattern plus an ordinal — or the first unseen `RACE7`
 * halts the event. The schema anticipated it: `season_individual_race_points`
 * is long, not wide.
 */
export interface RepeatGroup {
  /** What the block is, for error messages. */
  name: string;
  /** The expression this block publishes at ordinal `n`, 1-based. */
  expression(n: number): string;
  /** The widest the block has ever been published. */
  max: number;
}

/**
 * One published layout of a family.
 *
 * A family has more than one variant when the source rebuilt the same list —
 * the 2025 mass-start list, the 2025 prologue time trial and the 2026 rewrite
 * share almost no expressions but are the same list in the league's terms.
 */
export interface LayoutVariant {
  name: string;
  /** Every expression here must be present for the variant to match. */
  signature: readonly string[];
  /**
   * Every expression here must be *absent*.
   *
   * Needed because some layouts differ only by subtraction: the final season
   * standings are the mid-season snapshot with `#FIN` and the unused race
   * columns removed. Without a negative test the two signatures overlap and
   * those events match twice, which is fatal by design.
   */
  absent?: readonly string[];
  /**
   * True where this layout is the league's season record rather than a
   * snapshot of it, or a degenerate copy. Only a record is written.
   */
  record?: boolean;
}

export interface Family {
  name: string;
  target: FamilyTarget;
  /** Nesting depth of `data` before the rows: 1 grouped by category, 3 by team. */
  depth: number;
  variants: readonly LayoutVariant[];
  /** Canonical field -> the expressions that have carried it. */
  aliases: Readonly<Record<string, readonly string[]>>;
  /** Refuse to write unless all of these resolve. */
  required: readonly string[];
  /** Recognized and deliberately unmapped. */
  ignored: readonly string[];
  repeats?: readonly RepeatGroup[];
}

/* ── Shared expressions ───────────────────────────────────────────────────── */

const FLAT_2025_PLACE =
  'if(if([TransgenderOption]="Redundancy";[RANK5];[RANK1])>0;if([STATUS]<2;if([TransgenderOption]="Redundancy";[RANK5];[RANK1]);[TimeOrStatus]);"*")';
const FLAT_2025_NAME =
  'ucase([DisplayName]) & iif([RANK2]=1 AND [ShowPoints]=1;" (PTS LEADER)";"")';
const FLAT_2025_PTS_LEADER = 'iif([RANK2]=1 AND [ShowPoints]=1;"B")';

/** The team's division placing at this event. The same expression in two families. */
const TEAM_PLACE = 'choose([Division];[TS1.POSITION];[TS2.POSITION];[TS3.POSITION])';

/** Row tint by contest type. Presentation; carries nothing. */
const CONTEST_TINT =
  'switch([CONTEST.TYPE]="Boys";"BG(#a4affe)";[CONTEST.TYPE]="Girls";"BG(#ffb3ee)";[CONTEST.TYPE]="Open";"BG(#fff)")';

const BEST_OF = '#[RacesToDrop]/[EVENT.NumberOfRacesInSeason]';

/** The two `Team Results` families rank and total through the division slot. */
const teamRank = (slot: number) =>
  `switch([TS1${slot}.RANK]>0;[TS1${slot}.RANK];[TS2${slot}.RANK]>0;[TS2${slot}.RANK];[TS3${slot}.RANK]>0;[TS3${slot}.RANK])`;
const teamTotal = (slot: number) =>
  `switch([TS1${slot}.RANK]>0;[TS1${slot}.TIME1];[TS2${slot}.RANK]>0;[TS2${slot}.TIME1];[TS3${slot}.RANK]>0;[TS3${slot}.TIME1])`;
/** The per-race team score for round `n`, in the season-overall list. */
const teamRacePoints = (n: number) =>
  `choose([Division];[TS10${n}.TIME1];[TS20${n}.TIME1];[TS30${n}.TIME1])`;

/* ── The flat per-race individual list — the spine (issue #23) ───────────── */

export const INDIVIDUAL_FLAT: Family = {
  name: 'individual_flat',
  target: 'individual_result',
  depth: 1,
  variants: [
    { name: 'mass-start-2025', signature: [FLAT_2025_PLACE, 'TimeOrStatus', 'DisplayLapTime(1)'] },
    { name: 'time-trial-2025', signature: ['RankOrStatusTT', 'Start.TOD', 'End.TOD'] },
    {
      name: 'mass-start-2026',
      signature: ['if([STATUS]=3;"*";[CategoryRank])', 'WithStatus([TotalTime])', 'PointsMatrix'],
    },
  ],
  aliases: {
    // BIB is the plate — the rider handle. Never `ID`: 468 `ID` values map to
    // more than one person inside a single season, because it is a per-event
    // row key that restarts at 1 every race.
    plate: ['BIB'],
    sourceRowId: ['ID'],
    displayName: [FLAT_2025_NAME, 'ucase([DisplayName])'],
    firstName: ['FIRSTNAME'],
    lastName: ['LASTNAME'],
    // NAMING TRAP: the source's `CLUB` is our `scoring_team` — the
    // NICA-reported peer string. It is never our `club`, which is the parent
    // organisation a coach runs and lives only in config tables.
    scoringTeam: ['CLUB'],
    place: [FLAT_2025_PLACE, 'RankOrStatusTT', 'if([STATUS]=3;"*";[CategoryRank])'],
    points: ['DisplayPoints', 'PointsMatrix', 'if([TT_Rank]>0;[T1025])'],
    lap1: ['DisplayLapTime(1)', 'if([Lap01]=0;"-";[Lap01])'],
    lap2: ['DisplayLapTime(2)', 'if([Lap02.SECTOR]=0;"-";[Lap02.SECTOR])'],
    lap3: ['DisplayLapTime(3)'],
    lap4: ['DisplayLapTime(4)'],
    penalty: ['if([T20]>0;[TIME20])', 'PenaltyTime'],
    timeRaw: ['TimeOrStatus', 'TIME', 'WithStatus([TotalTime])'],
    laps: ['NumberOfLaps', 'TS1.LAPTIMENUMBER'],
    ptsLeader: [FLAT_2025_PTS_LEADER],
  },
  required: ['plate', 'scoringTeam', 'place', 'timeRaw'],
  // Time-trial columns, empty in every row of the corpus, with no column in
  // `individual_result` to live in.
  ignored: ['Start.TOD', 'End.TOD'],
};

/* ── The By-Team attribute sidecar ────────────────────────────────────────── */

/**
 * HIGH SCHOOL ONLY, at all 8 events — every one of the 1,338 rows nests under a
 * single `High School` node. Gender, grade, team place and the scored flag are
 * therefore unavailable for every middle-school rider, by construction rather
 * than by absence. It stays its own table because the join to the spine is
 * 1,336 of 1,338 and the two orphans have nowhere to live in a merged row.
 */
export const INDIVIDUAL_BY_TEAM: Family = {
  name: 'individual_by_team',
  target: 'individual_result_by_team',
  depth: 3,
  variants: [
    { name: 'by-team-2025', signature: ['iif([TS.SCORED]=1;"B;")', 'SexMF', 'Grade', TEAM_PLACE] },
  ],
  aliases: {
    plate: ['BIB'],
    sourceRowId: ['ID'],
    teamPlace: [TEAM_PLACE],
    place: ['if([TransgenderOption]="Redundancy";[RANK5];[RANK1])'],
    displayName: ['ucase([DisplayName])'],
    categoryRaw: ['CONTEST.NAME'],
    gender: ['SexMF'],
    grade: ['Grade'],
    points: ['DisplayPoints'],
    lap1: ['DisplayLapTime(1)'],
    lap2: ['DisplayLapTime(2)'],
    lap3: ['DisplayLapTime(3)'],
    lap4: ['DisplayLapTime(4)'],
    lap5: ['DisplayLapTime(5)'],
    penalty: ['TIME20'],
    timeRaw: ['TimeOrStatus'],
    scored: ['iif([TS.SCORED]=1;"B;")'],
  },
  required: ['plate', 'displayName'],
  ignored: [
    // A second copy of the plate, rendered rather than transported.
    'DisplayBib',
    // Published at 3 of 8 events. This table is the attribute sidecar and has
    // no lap-count column; the spine carries laps.
    'NumberOfLaps',
  ],
};

/* ── Per-race team score ──────────────────────────────────────────────────── */

/** HS-only at all 8 events, nested `High School > Division N`. */
export const TEAM_RACE_RESULT: Family = {
  name: 'team_race_result',
  target: 'team_race_result',
  depth: 2,
  variants: [{ name: 'team-results-2025', signature: [teamRank(99)] }],
  aliases: {
    scoringTeam: ['CLUB'],
    place: [teamRank(99)],
    penaltyPoints: [
      'ifPositive(choose([Division];[TS1.DECIMALTIME2];[TS2.DECIMALTIME2];[TS3.DECIMALTIME2]))',
    ],
    points: ['choose([Division];[TS199.TIME1];[TS299.TIME1];[TS399.TIME1])'],
  },
  required: ['scoringTeam', 'points'],
  // A team row still transports a rider's row key. This table has no rider.
  ignored: ['BIB', 'ID'],
};

/* ── Per-race team counters, and the only source of middle-school teams ───── */

/**
 * `Team Results - Detailed`. The **only** published source of middle-school
 * team scoring: a `Middle School` node with its own divisions, ranks and
 * scores sits beside `High School` at all 8 events, and neither `Team Results`
 * nor the By-Team sidecar can see it.
 *
 * The team node is a packed string — `1.///Portland Metro Composite///3834
 * Points /// Penalty Points: 0` — split on `///`.
 */
export const TEAM_RACE_COUNTER: Family = {
  name: 'team_race_counter',
  target: 'team_race_counter',
  depth: 3,
  variants: [
    { name: 'team-detailed-2025', signature: ['CONTEST.TYPE', 'CONTEST.NAME', TEAM_PLACE] },
  ],
  aliases: {
    plate: ['BIB'],
    teamPlace: [TEAM_PLACE],
    displayName: ['ucase([DisplayName])'],
    individualPoints: ['DisplayPoints'],
    gender: ['SexMF'],
    type: ['CONTEST.TYPE'],
    categoryRaw: ['CONTEST.NAME'],
  },
  required: ['plate'],
  ignored: ['ID', 'DisplayBib', CONTEST_TINT],
};

/* ── Season standings ─────────────────────────────────────────────────────── */

/**
 * `Individual Results - Overall`, in four published layouts, only one of which
 * is a season record.
 *
 * Read, never computed. A naive sum is wrong: the series is best 3 of 4 minus
 * the lowest, plus a 25-point attendance bonus, and a mid-season category
 * upgrade forfeits the points scored under the old category — which the source
 * publishes as the literal string `Upgrade` where a number would go.
 *
 * The four layouts differ mostly by subtraction, which is why `absent` exists:
 *
 *   - **final** — Race 4's copy, and the only season record. `RACE1..RACE4`.
 *   - **snapshot** — Race 2 and Race 3's copies. Season-to-date, carrying
 *     `#FIN` and a `RACE1..RACE10` block sized for a season Oregon never ran.
 *   - **state-champs** — degenerate: `BEST OF 1/1`, `RACE2..RACE4` empty on
 *     every row, an extra `STATE CHAMPS` column. It supersedes nothing.
 *   - **prologue-overall** — Race 1's copy is a different list under the same
 *     name: the prologue's own result list, with lap arithmetic and no season
 *     semantics at all.
 */
export const SEASON_INDIVIDUAL: Family = {
  name: 'season_individual',
  target: 'season_individual_standing',
  depth: 1,
  variants: [
    {
      name: 'final-2025',
      signature: ['SeasonPlace', BEST_OF, 'DisplayUpgrades(4)', 'T1010'],
      absent: ['FinishCount', 'DisplayUpgrades(5)'],
      record: true,
    },
    { name: 'snapshot-2025', signature: ['SeasonPlace', BEST_OF, 'FinishCount'] },
    {
      name: 'state-champs-2025',
      signature: ['SeasonPlace', BEST_OF, 'DisplayUpgrades(5)'],
      absent: ['FinishCount'],
    },
    { name: 'prologue-overall-2025', signature: ['SeasonPlace', 'TIME20'], absent: [BEST_OF] },
  ],
  aliases: {
    plate: ['BIB'],
    sourceRowId: ['ID'],
    displayName: ['ucase([DisplayName])'],
    scoringTeam: ['CLUB'],
    seasonPlace: ['SeasonPlace'],
    bestOf: [BEST_OF],
    // Never repaired by inferring min(): event 363500 omits the column
    // entirely, and its FINAL still has the drop applied.
    lowScore: ['LowScore'],
    bonusTotal: ['BonusTotal'],
    final: ['T1010'],
  },
  required: ['plate', 'displayName', 'seasonPlace'],
  ignored: [
    'DisplayBib',
    // The completed-race count behind the bonus. Published in the snapshots and
    // dropped at Race 4; `BonusTotal` publishes the outcome either way.
    'FinishCount',
    // Race 1's copy is the prologue's own result list. Its lap arithmetic has
    // no home in a season standing, and that variant is not a record.
    'TIME20',
    'Format(TimeFromString(Measurement1)-TimeFromString(Measurement0);"mm:ss.kk")',
    'Format(TimeFromString(Measurement2)-TimeFromString(Measurement1);"mm:ss.kk")',
    'Format(TimeFromString(Measurement1)-TimeFromString(Measurement0)+TimeFromString(Measurement2)-TimeFromString(Measurement1)+TimeFromString([TIME20]);"mm:ss.kk")',
  ],
  repeats: [
    { name: 'racePoints', expression: (n) => `DisplayUpgrades(${n})`, max: 10 },
    { name: 'dropMarker', expression: (n) => `LowScoreFormatting(${n})`, max: 10 },
  ],
};

/**
 * `Team Results - Overall`. HS-only at all 8 events — there is no `Middle
 * School` node in this family anywhere, which leaves middle-school team season
 * standings the one season-level number in the catalog with no published
 * source.
 *
 * `SEASON = RACE 2 + RACE 3 + RACE 4`, with no drop: the prologue does not
 * count toward team season points, which is why the final layout's block starts
 * at round 2.
 *
 * State Champs publishes this list in the *same* shape as the final one, with
 * `SEASON = 0` on every row. Shape cannot tell them apart, so the record is
 * also required to come from a conference event — see `decode-season.ts`.
 */
export const SEASON_TEAM: Family = {
  name: 'season_team',
  target: 'season_team_standing',
  depth: 2,
  variants: [
    {
      name: 'final-2025',
      signature: [teamRank(97), teamRacePoints(4)],
      absent: [teamRacePoints(1), teamRacePoints(5)],
      record: true,
    },
    {
      name: 'snapshot-2025',
      signature: [teamRank(97), teamRacePoints(5)],
      absent: [teamRacePoints(1)],
    },
    { name: 'prologue-local-2025', signature: [teamRank(97), teamRacePoints(1)] },
  ],
  aliases: {
    scoringTeam: ['CLUB'],
    place: [teamRank(97)],
    seasonTotal: [teamTotal(97)],
  },
  required: ['scoringTeam', 'place'],
  ignored: ['BIB', 'ID'],
  repeats: [{ name: 'racePoints', expression: teamRacePoints, max: 9 }],
};

export const FAMILIES: readonly Family[] = [
  INDIVIDUAL_FLAT,
  INDIVIDUAL_BY_TEAM,
  TEAM_RACE_RESULT,
  TEAM_RACE_COUNTER,
  SEASON_INDIVIDUAL,
  SEASON_TEAM,
];

export interface FamilyAssignment {
  family: Family;
  variant: LayoutVariant;
}

/**
 * Which family a list belongs to, by signature and nesting depth.
 *
 * Depth is part of the identity because two families can share expressions —
 * By-Team and `Team Results - Detailed` both carry the team-place expression —
 * and because a decoder that walks the wrong number of levels finds groups
 * where it wants rows.
 */
export function assignFamily(
  where: string,
  layout: ColumnLayout,
  depth: number,
  families: readonly Family[] = FAMILIES,
): FamilyAssignment {
  const matches: FamilyAssignment[] = [];

  for (const family of families) {
    if (family.depth !== depth) continue;
    for (const variant of family.variants) {
      const present = variant.signature.every((expression) => layout.has(expression));
      const missing = (variant.absent ?? []).every((expression) => !layout.has(expression));
      if (present && missing) matches.push({ family, variant });
    }
  }

  if (matches.length === 0) {
    throw new FamilyError(
      `${where}: matches no declared family at data depth ${depth}. ` +
        `Its columns are: ${layout.dataFields.join(', ')}. ` +
        'An unrecognized list is fatal — skipping it is how a season goes missing.',
    );
  }
  if (matches.length > 1) {
    throw new FamilyError(
      `${where}: matches ${matches.length} declared layouts ` +
        `(${matches.map((m) => `${m.family.name}/${m.variant.name}`).join(', ')}). ` +
        'Overlapping signatures no longer describe the source; choosing one would be a guess.',
    );
  }

  return matches[0]!;
}

/**
 * The ordinals of a repeat group this layout actually publishes, ascending.
 *
 * Reading the width off the payload rather than requiring a fixed set is the
 * whole point: the block is `RACE1`–`RACE10` mid-season and `RACE1`–`RACE4` at
 * Race 4, and an unseen `RACE7` must widen the block rather than halt the event.
 */
export function repeatOrdinals(layout: ColumnLayout, repeat: RepeatGroup): number[] {
  const ordinals: number[] = [];
  for (let n = 1; n <= repeat.max; n += 1) {
    if (layout.has(repeat.expression(n))) ordinals.push(n);
  }
  return ordinals;
}

/** Every expression a family accounts for, mapped or deliberately unmapped. */
export function recognizedExpressions(family: Family): Set<string> {
  const known = new Set<string>(family.ignored);
  for (const aliases of Object.values(family.aliases)) {
    for (const alias of aliases) known.add(alias);
  }
  for (const repeat of family.repeats ?? []) {
    for (let n = 1; n <= repeat.max; n += 1) known.add(repeat.expression(n));
  }
  return known;
}
