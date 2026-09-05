/**
 * The season standings, individual and team.
 *
 * **Season standings are read, never computed.** A naive sum is wrong three
 * ways: the individual series is best 3 of 4 minus the lowest, a 25-point
 * attendance bonus rides on top of it, and a mid-season category upgrade
 * forfeits the points scored under the old category. All three are already
 * applied in the published `FINAL`, and all three are published alongside it —
 * the drop rule as a literal `3/4`, the dropped value as `LOW SCORE`, the bonus
 * as `BONUS TOTAL`, and the forfeit as the literal string `Upgrade` where a
 * number would go. Nothing here adds anything up.
 *
 * **Only a record is written, and only from a conference event.** Every event
 * publishes a copy of these lists, and most of them are not the season record:
 *
 *   - Race 2 and Race 3 publish season-to-date snapshots.
 *   - Race 1's individual copy is a different list under the same name — the
 *     prologue's own result list, with no season semantics at all.
 *   - State Champs' copies are degenerate: `BEST OF 1/1` with `RACE2..RACE4`
 *     empty on the individual list, and `SEASON = 0` on every row of the team
 *     list. They supersede nothing.
 *
 * Shape separates the first three; it cannot separate the last, because State
 * Champs publishes the team list in exactly the final layout. So a record is
 * also required to come from a **conference** event, which State Champs and the
 * combined prologue are not. Both tables key on conference, so a combined event
 * has no key to write under either way.
 *
 * That leaves the degenerate copy unable to look like success: it is not a
 * record by shape on the individual side, not a record by conference on the
 * team side, and if it ever drifted into the record shape the emptiness checks
 * below would refuse it.
 */

import { normalizeCategory, type Conference } from './category.ts';
import type { ColumnLayout } from './columns.ts';
import {
  repeatOrdinals,
  SEASON_INDIVIDUAL,
  SEASON_TEAM,
  type Family,
  type LayoutVariant,
  type RepeatGroup,
} from './families.ts';
import {
  cellOrNull,
  cellReader,
  checkExpressionsRecognized,
  checkRowCount,
  checkUniqueKey,
  DecodeError,
  groupedRows,
  parseIntOrRefuse,
  readListLayout,
  resolveFamilyFields,
  type DecodedList,
  type ListPayload,
} from './rows.ts';

/** The `Upgrade` sentinel: points forfeited to a mid-season category change. */
export const UPGRADE = 'Upgrade';

/** The `LowScoreFormatting` hint that marks the dropped race. */
const DROP_MARKER = 'C(255,0,0)';

export interface SeasonRacePoints {
  /** Joins to `round.ordinal` — the league's own race numbering. */
  roundOrdinal: number;
  /** Verbatim: an integer, `0` for an absence, or the `Upgrade` sentinel. */
  points: string | null;
  isDropped: boolean;
  isUpgrade: boolean;
}

export interface SeasonIndividualRow {
  conference: Conference | null;
  plate: string;
  displayName: string;
  scoringTeam: string | null;
  categoryRaw: string;
  seasonPlace: string | null;
  bestOf: string | null;
  lowScore: number | null;
  bonusTotal: number | null;
  final: number | null;
  racePoints: SeasonRacePoints[];
}

export interface SeasonTeamRow {
  conference: Conference | null;
  scoringTeam: string;
  division: string | null;
  place: string | null;
  /** `{ "2": 3834, "3": 3901, "4": 3777 }`, keyed by round ordinal. */
  racePoints: Record<string, number | null>;
  seasonTotal: number | null;
}

/** The declared repeat block of a family, or a failure that names the list. */
function repeat(where: string, family: Family, name: string): RepeatGroup {
  const group = family.repeats?.find((candidate) => candidate.name === name);
  if (!group) {
    throw new DecodeError(`${where}: ${family.name} declares no repeat group named ${name}.`);
  }
  return group;
}

/** A repeat-group cell, addressed by expression rather than by canonical field. */
function cellAt(layout: ColumnLayout, row: readonly string[], expression: string): string | null {
  return cellOrNull(layout.cell(row, layout.indexOf(expression)));
}

/**
 * Decode `Individual Results - Overall`.
 *
 * The per-race block goes **long, not wide**: one row per `(rider, round)` in
 * `season_individual_race_points`, because the block is `RACE1`–`RACE10` in the
 * snapshots and `RACE1`–`RACE4` at Race 4 and no fixed column set survives that.
 * A round with no published cell contributes no row at all — absent is not `0`,
 * and `0` is a real published value meaning the rider did not start.
 */
export function decodeSeasonIndividual(
  where: string,
  variant: LayoutVariant,
  payload: ListPayload,
  conference: Conference | null,
): DecodedList<SeasonIndividualRow> {
  const layout = readListLayout(where, payload);
  checkExpressionsRecognized(where, layout, SEASON_INDIVIDUAL);

  const columns = resolveFamilyFields(where, layout, SEASON_INDIVIDUAL);
  const at = cellReader(layout, columns);

  const points = repeat(where, SEASON_INDIVIDUAL, 'racePoints');
  const marker = repeat(where, SEASON_INDIVIDUAL, 'dropMarker');
  const ordinals = repeatOrdinals(layout, points);

  if (ordinals.length === 0) {
    throw new DecodeError(
      `${where}: publishes no per-race points block at all. A season standing with no races ` +
        'is not a season standing.',
    );
  }

  const rows: SeasonIndividualRow[] = [];

  for (const { groups, row, number } of groupedRows(where, payload.data, SEASON_INDIVIDUAL.depth)) {
    layout.checkRowWidth(row, number);

    const groupKey = groups[0]!;
    const category = normalizeCategory(groupKey);
    const plate = at(row, 'plate');
    const displayName = at(row, 'displayName');

    if (plate === null || displayName === null) {
      throw new DecodeError(`${where}: row ${number} in "${groupKey}" has no plate or name.`);
    }
    // The standing is keyed on `(season, conference, plate)`, so the conference
    // has to be one value and it has to be the event's. Taking it from the
    // category alone would let an unsuffixed category — a documented defect
    // class — write a null into the key instead of halting.
    if (category.conference !== conference) {
      throw new DecodeError(
        `${where}: row ${number} is in "${groupKey}", whose conference is ` +
          `${category.conference ?? 'unstated'}, but the event is ${conference ?? 'combined'}. ` +
          'A season standing is keyed on conference and cannot mix them.',
      );
    }

    const racePoints: SeasonRacePoints[] = [];
    for (const ordinal of ordinals) {
      const value = cellAt(layout, row, points.expression(ordinal));
      if (value === null) continue;

      racePoints.push({
        roundOrdinal: ordinal,
        // Verbatim. `Upgrade` is a published value, not a parse failure.
        points: value,
        // The South final list omits LowScoreFormatting(1) entirely, so where
        // RACE1 was the dropped race it carries no marker. Recorded as false,
        // never repaired by taking the minimum.
        isDropped: cellAt(layout, row, marker.expression(ordinal)) === DROP_MARKER,
        isUpgrade: value === UPGRADE,
      });
    }

    rows.push({
      conference,
      plate,
      displayName,
      scoringTeam: at(row, 'scoringTeam'),
      categoryRaw: category.raw,
      seasonPlace: at(row, 'seasonPlace'),
      bestOf: at(row, 'bestOf'),
      // Absent at event 363500. Never inferred from min(): its FINAL already
      // has the drop applied and the value the league dropped is simply not
      // published there.
      lowScore: parseIntOrRefuse(where, 'the low score', at(row, 'lowScore')),
      bonusTotal: parseIntOrRefuse(where, 'the bonus total', at(row, 'bonusTotal')),
      final: parseIntOrRefuse(where, 'the season total', at(row, 'final')),
      racePoints,
    });
  }

  if (variant.record) checkIsARecord(where, rows);

  const publishedCount = checkRowCount(where, payload.list?.ListFooterText, rows.length);
  checkUniqueKey(
    where,
    'plates',
    rows.map((row) => row.plate),
  );

  return { variant, expressions: layout.dataFields, publishedCount, ordinals, rows };
}

/**
 * A list claiming to be the season record must look like one.
 *
 * The State Champs copy declares `BEST OF 1/1` and scores every rider on one
 * race. If a layout change ever let it match the record variant, this is what
 * stops it being written as the season — which is the whole point of the
 * degenerate-list rule: normalizing one must not be allowed to look like
 * success.
 */
function checkIsARecord(where: string, rows: readonly SeasonIndividualRow[]): void {
  if (rows.length === 0) {
    throw new DecodeError(`${where}: claims to be the season record and carries no rows.`);
  }

  const seasonLength = rows
    .map((row) => Number(/\/(\d+)\s*$/.exec(row.bestOf ?? '')?.[1] ?? '0'))
    .filter((length) => length > 0);

  if (seasonLength.length > 0 && Math.max(...seasonLength) <= 1) {
    throw new DecodeError(
      `${where}: publishes "BEST OF ${rows[0]!.bestOf}" — a one-race season. ` +
        'That is the State Champs copy, which supersedes nothing and is not a season record.',
    );
  }
}

/**
 * Decode `Team Results - Overall`.
 *
 * Per-race scores stay as published jsonb keyed by round ordinal, because the
 * column set shifts with the season's shape: `RACE 1`–`RACE 9` at the prologue,
 * `RACE 2`–`RACE 9` mid-season, `RACE 2`–`RACE 4` at the end. An empty cell
 * stays absent rather than becoming `0` — three South teams publish an empty
 * `RACE 4` where that race's own list publishes `0`, and the published season
 * list wins.
 */
export function decodeSeasonTeam(
  where: string,
  variant: LayoutVariant,
  payload: ListPayload,
  conference: Conference | null,
): DecodedList<SeasonTeamRow> {
  const layout = readListLayout(where, payload);
  checkExpressionsRecognized(where, layout, SEASON_TEAM);

  const columns = resolveFamilyFields(where, layout, SEASON_TEAM);
  const at = cellReader(layout, columns);

  const points = repeat(where, SEASON_TEAM, 'racePoints');
  const ordinals = repeatOrdinals(layout, points);
  const rows: SeasonTeamRow[] = [];

  for (const { groups, row, number } of groupedRows(where, payload.data, SEASON_TEAM.depth)) {
    layout.checkRowWidth(row, number);

    const scoringTeam = at(row, 'scoringTeam');
    if (scoringTeam === null) {
      throw new DecodeError(`${where}: row ${number} in [${groups.join(' > ')}] names no team.`);
    }

    const racePoints: Record<string, number | null> = {};
    for (const ordinal of ordinals) {
      const value = cellAt(layout, row, points.expression(ordinal));
      if (value !== null) {
        racePoints[String(ordinal)] = parseIntOrRefuse(where, `race ${ordinal} points`, value);
      }
    }

    rows.push({
      conference,
      scoringTeam,
      division: groups[1] ?? null,
      place: at(row, 'place'),
      racePoints,
      seasonTotal: parseIntOrRefuse(where, 'the season total', at(row, 'seasonTotal')),
    });
  }

  const publishedCount = checkRowCount(where, payload.list?.ListFooterText, rows.length);
  checkUniqueKey(
    where,
    'scoring teams',
    rows.map((row) => row.scoringTeam),
  );

  return { variant, expressions: layout.dataFields, publishedCount, ordinals, rows };
}

/**
 * Whether a team season list is the degenerate copy.
 *
 * State Champs publishes it in the same shape as the final one, so shape cannot
 * tell them apart — but `SEASON = 0` on every row can, and does. Reported
 * rather than thrown: the copy exists and is archived; it is simply not the
 * record. Nothing that reads it as one would ever be right.
 */
export function isDegenerateTeamSeason(rows: readonly SeasonTeamRow[]): boolean {
  return rows.length > 0 && rows.every((row) => (row.seasonTotal ?? 0) === 0);
}
