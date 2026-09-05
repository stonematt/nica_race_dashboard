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
 * Not every declared family is decoded yet. `individual_flat` is decoded here
 * (issue #23); the rest are declared with signatures only and are recognized
 * and skipped, which is what keeps "zero matches is fatal" true and enforceable
 * from this ticket onward rather than from the last one. Issue #25 gives them
 * decoders and full expression classification.
 */

import type { ColumnLayout } from './columns.ts';
import { IngestError } from './errors.ts';

/** A list that matches no family, or more than one. */
export class FamilyError extends IngestError {}

/** The canonical fields the flat individual list decodes to. */
export type IndividualField =
  | 'plate'
  | 'sourceRowId'
  | 'displayName'
  | 'firstName'
  | 'lastName'
  | 'scoringTeam'
  | 'place'
  | 'points'
  | 'lap1'
  | 'lap2'
  | 'lap3'
  | 'lap4'
  | 'penalty'
  | 'timeRaw'
  | 'laps'
  | 'ptsLeader';

/**
 * One published layout of a family.
 *
 * A family has more than one variant when the source rebuilt the same list from
 * scratch — the 2025 mass-start list, the 2025 prologue time trial, and the
 * 2026 rewrite share almost no expressions, but they are the same list in the
 * league's terms and they decode to the same table.
 */
export interface LayoutVariant {
  name: string;
  /** Every expression here must be present for the variant to match. */
  signature: readonly string[];
}

export interface Family {
  name: string;
  /** Nesting depth of `data` before the rows: 1 grouped by category, 3 by team. */
  depth: number;
  variants: readonly LayoutVariant[];
  /** Decoded by this ticket, or recognized and left for a later one. */
  decoded: boolean;
}

/* ── The flat per-race individual list — the spine ─────────────────────────
 *
 * Three variants across the corpus. The prologue time trial is the same family
 * as the mass-start list, not a different one: it is the flat individual result
 * for that race day, and the ruling on issue #12 names `RankOrStatusTT` and the
 * `FIRSTNAME`/`LASTNAME` split as aliases within this family.
 */

const FLAT_2025_PLACE =
  'if(if([TransgenderOption]="Redundancy";[RANK5];[RANK1])>0;if([STATUS]<2;if([TransgenderOption]="Redundancy";[RANK5];[RANK1]);[TimeOrStatus]);"*")';
const FLAT_2025_NAME =
  'ucase([DisplayName]) & iif([RANK2]=1 AND [ShowPoints]=1;" (PTS LEADER)";"")';
const FLAT_2025_PTS_LEADER = 'iif([RANK2]=1 AND [ShowPoints]=1;"B")';

export const INDIVIDUAL_FLAT: Family = {
  name: 'individual_flat',
  depth: 1,
  decoded: true,
  variants: [
    { name: 'mass-start-2025', signature: [FLAT_2025_PLACE, 'TimeOrStatus', 'DisplayLapTime(1)'] },
    { name: 'time-trial-2025', signature: ['RankOrStatusTT', 'Start.TOD', 'End.TOD'] },
    {
      name: 'mass-start-2026',
      signature: ['if([STATUS]=3;"*";[CategoryRank])', 'WithStatus([TotalTime])', 'PointsMatrix'],
    },
  ],
};

/**
 * Canonical field -> the expressions that have carried it.
 *
 * This is the second of the two mappings, and it is where the drift lands.
 * Aliases are listed per family rather than per variant on purpose: more than
 * one alias for a field present in one payload is fatal (see
 * `ColumnLayout.resolve`), and a per-variant table could not see that.
 */
export const INDIVIDUAL_FLAT_ALIASES: Record<IndividualField, readonly string[]> = {
  // BIB is the plate — the rider handle. Never `ID`: 468 `ID` values map to
  // more than one person inside a single season, because it is a per-event row
  // key that restarts at 1 every race.
  plate: ['BIB'],
  sourceRowId: ['ID'],
  displayName: [FLAT_2025_NAME, 'ucase([DisplayName])'],
  firstName: ['FIRSTNAME'],
  lastName: ['LASTNAME'],
  // NAMING TRAP: the source's `CLUB` is our `scoring_team` — the NICA-reported
  // peer string ("Salem Composite", "Sprague High School Descenders"). It is
  // never our `club`, which is the parent organisation a coach runs and lives
  // only in config tables. See the wayfinder map's domain vocabulary.
  scoringTeam: ['CLUB'],
  place: [FLAT_2025_PLACE, 'RankOrStatusTT', 'if([STATUS]=3;"*";[CategoryRank])'],
  // The time trial declares a points column and leaves it empty in all 535
  // rows, and State Champs drops points from the flat list entirely.
  points: ['DisplayPoints', 'PointsMatrix', 'if([TT_Rank]>0;[T1025])'],
  lap1: ['DisplayLapTime(1)', 'if([Lap01]=0;"-";[Lap01])'],
  lap2: ['DisplayLapTime(2)', 'if([Lap02.SECTOR]=0;"-";[Lap02.SECTOR])'],
  lap3: ['DisplayLapTime(3)'],
  lap4: ['DisplayLapTime(4)'],
  penalty: ['if([T20]>0;[TIME20])', 'PenaltyTime'],
  timeRaw: ['TimeOrStatus', 'TIME', 'WithStatus([TotalTime])'],
  laps: ['NumberOfLaps', 'TS1.LAPTIMENUMBER'],
  ptsLeader: [FLAT_2025_PTS_LEADER],
};

/** Refuse to write unless all of these resolve. A name is checked separately. */
export const INDIVIDUAL_FLAT_REQUIRED: readonly IndividualField[] = [
  'plate',
  'scoringTeam',
  'place',
  'timeRaw',
];

/**
 * Recognized, and deliberately not mapped.
 *
 * Strict unknown-expression fatality is only usable with this list: recognized
 * means mapped *or* explicitly ignored, so an expression nobody has classified
 * halts the event. Both of these are time-trial columns that are empty in every
 * row of the corpus and have no column in `individual_result`.
 */
export const INDIVIDUAL_FLAT_IGNORED: readonly string[] = ['Start.TOD', 'End.TOD'];

/* ── Declared, not yet decoded ─────────────────────────────────────────────
 *
 * Signatures only. These exist so an unrecognized list stays fatal without
 * halting every event on a list this ticket was never meant to read. Issue #25
 * gives each of them an alias table, a required set and an ignored list.
 */

export const OTHER_FAMILIES: readonly Family[] = [
  {
    name: 'individual_by_team',
    depth: 3,
    decoded: false,
    variants: [{ name: 'by-team-2025', signature: ['iif([TS.SCORED]=1;"B;")', 'SexMF', 'Grade'] }],
  },
  {
    name: 'team_race_result',
    depth: 2,
    decoded: false,
    variants: [
      {
        name: 'team-results-2025',
        signature: [
          'switch([TS199.RANK]>0;[TS199.RANK];[TS299.RANK]>0;[TS299.RANK];[TS399.RANK]>0;[TS399.RANK])',
        ],
      },
    ],
  },
  {
    name: 'team_race_counter',
    depth: 3,
    decoded: false,
    variants: [{ name: 'team-detailed-2025', signature: ['CONTEST.TYPE', 'CONTEST.NAME'] }],
  },
  {
    name: 'season_individual',
    depth: 1,
    decoded: false,
    variants: [{ name: 'season-overall-2025', signature: ['SeasonPlace', 'DisplayUpgrades(1)'] }],
  },
  {
    name: 'season_team',
    depth: 2,
    decoded: false,
    variants: [
      {
        name: 'team-overall-2025',
        signature: [
          'switch([TS197.RANK]>0;[TS197.RANK];[TS297.RANK]>0;[TS297.RANK];[TS397.RANK]>0;[TS397.RANK])',
        ],
      },
    ],
  },
];

export const FAMILIES: readonly Family[] = [INDIVIDUAL_FLAT, ...OTHER_FAMILIES];

export interface FamilyAssignment {
  family: Family;
  variant: LayoutVariant;
}

/**
 * Which family a list belongs to, by signature and nesting depth.
 *
 * Depth is part of the identity because two families can share expressions —
 * `Individual Results - By Team` and `Team Results - Detailed` both carry
 * `choose([Division];[TS1.POSITION];…)` — and because a decoder that walks the
 * wrong number of levels finds rows where there are groups.
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
      if (variant.signature.every((expression) => layout.has(expression))) {
        matches.push({ family, variant });
      }
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
