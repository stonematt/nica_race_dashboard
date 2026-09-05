/**
 * `(DataFields, rows) -> typed rows`, for the flat individual list.
 *
 * **Ingest is a fidelity problem, not a calculation problem.** NICA is the
 * scoring authority: places, points, ranks and times land exactly as published,
 * `*` and `DNF` sentinels included. Nothing here computes a place, repairs a
 * points value, or merges a row with another list. Where the published numbers
 * look wrong, the published numbers are what gets stored.
 *
 * Three transformations are permitted, and they are the only three:
 *
 *   1. **Typed coercion.** Every cell arrives as a string; `points` becomes an
 *      integer and `time_seconds` a number *beside* the verbatim string, never
 *      instead of it.
 *   2. **Category normalization**, stored beside the raw string — see
 *      category.ts for why, and for why an unrecognized category is fatal.
 *   3. **Lap recovery.** `NumberOfLaps` is published at only 4 of the 8 2025
 *      events; where it is absent the count is recovered by counting splits,
 *      which was verified to agree exactly at every event carrying both.
 *
 * Everything else refuses. The refusals every family shares live in rows.ts.
 */

import { normalizeCategory, type Conference, type Gender, type GradeBand } from './category.ts';
import type { ColumnLayout } from './columns.ts';
import { INDIVIDUAL_FLAT, type LayoutVariant } from './families.ts';
import {
  cellReader,
  checkExpressionsRecognized,
  checkRowCount,
  checkUniqueKey,
  DecodeError,
  groupedRows,
  parseIntOrRefuse,
  readListLayout,
  type FieldColumns,
  type ListPayload,
} from './rows.ts';

/** `finished` or `dnf`. See `status` below for why `lapped` is not written. */
export type ResultStatus = 'finished' | 'dnf';

/** One decoded row of `individual_result`, minus its `event_id`. */
export interface IndividualRow {
  plate: string;
  sourceRowId: string | null;
  displayName: string;
  scoringTeam: string;
  categoryRaw: string;
  categoryLevel: string;
  categoryGradeBand: GradeBand;
  categoryGender: Gender;
  conference: Conference | null;
  place: string;
  status: ResultStatus;
  timeRaw: string;
  timeSeconds: string | null;
  points: number | null;
  laps: number | null;
  lap1: string | null;
  lap2: string | null;
  lap3: string | null;
  lap4: string | null;
  penalty: string | null;
  ptsLeader: boolean;
}

export interface DecodedList {
  variant: LayoutVariant;
  /** `DataFields` verbatim — the snapshot's record of this event's layout. */
  expressions: readonly string[];
  /** The `ListFooterText` count, when the source published one. */
  publishedCount: number | null;
  rows: IndividualRow[];
}

/**
 * Seconds for a published time, or null when it is not a time.
 *
 * `[H:]MM:SS.cc` in 2025, `MM:SS.c` in 2026, and `DNF` in both. The verbatim
 * string is stored regardless; this is the sortable copy beside it.
 */
export function parseTimeSeconds(raw: string): number | null {
  const parts = raw.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return null;

  let seconds = 0;
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isFinite(value) || part.trim() === '') return null;
    seconds = seconds * 60 + value;
  }
  return seconds;
}

/** The four lap-split columns, in order. The 2026 layout publishes only two. */
const LAP_FIELDS = ['lap1', 'lap2', 'lap3', 'lap4'] as const;

/**
 * The flat list's columns, plus the one rule the shared resolver cannot state:
 * a name arrives whole, or split in two.
 */
function resolveIndividualFields(where: string, layout: ColumnLayout): FieldColumns {
  const columns: FieldColumns = {};
  for (const [field, aliases] of Object.entries(INDIVIDUAL_FLAT.aliases)) {
    columns[field] = layout.resolve(field, aliases)?.column ?? null;
  }

  const missing = INDIVIDUAL_FLAT.required.filter((field) => columns[field] === null);
  if (missing.length > 0) {
    throw new DecodeError(
      `${where}: required field(s) ${missing.join(', ')} resolve to no column. ` +
        `Columns present: ${layout.dataFields.join(', ')}`,
    );
  }

  // The 2025 prologue is the only place the split appears, and it is an alias
  // for the same canonical field.
  const whole = columns.displayName !== null;
  const split = columns.firstName !== null && columns.lastName !== null;
  if (!whole && !split) {
    throw new DecodeError(
      `${where}: no display name resolves — neither a whole name column nor a ` +
        'FIRSTNAME/LASTNAME pair.',
    );
  }

  return columns;
}

/**
 * Decode one flat individual list.
 *
 * `where` names the event and list in every error this raises; it is the only
 * thing a reader has to go on when an event halts.
 */
export function decodeIndividualFlat(
  where: string,
  variant: LayoutVariant,
  payload: ListPayload,
): DecodedList {
  const layout = readListLayout(where, payload);
  checkExpressionsRecognized(where, layout, INDIVIDUAL_FLAT);

  const columns = resolveIndividualFields(where, layout);
  const at = cellReader(layout, columns);

  const rows: IndividualRow[] = [];

  for (const { groups, row, number } of groupedRows(where, payload.data, INDIVIDUAL_FLAT.depth)) {
    layout.checkRowWidth(row, number);

    const groupKey = groups[0]!;
    const category = normalizeCategory(groupKey);
    const plate = at(row, 'plate');
    const place = at(row, 'place');
    const timeRaw = at(row, 'timeRaw');
    const scoringTeam = at(row, 'scoringTeam');

    if (plate === null || place === null || timeRaw === null || scoringTeam === null) {
      throw new DecodeError(
        `${where}: row ${number} in "${groupKey}" leaves a required field empty ` +
          '(plate, place, time or scoring team). A blank required cell is not a null result.',
      );
    }

    const displayName =
      columns.displayName !== null
        ? (at(row, 'displayName') ?? '')
        : `${at(row, 'firstName') ?? ''} ${at(row, 'lastName') ?? ''}`.trim();
    if (displayName === '') {
      throw new DecodeError(`${where}: row ${number} in "${groupKey}" has no name.`);
    }

    const laps = LAP_FIELDS.map((field) => at(row, field));
    const hasLapColumns = LAP_FIELDS.some((field) => columns[field] !== null);
    const publishedLaps = parseIntOrRefuse(where, 'the lap count', at(row, 'laps'));

    rows.push({
      plate,
      // Provenance only. `ID` restarts at 1 every event and 468 values map to
      // more than one person in one season — never join on it.
      sourceRowId: at(row, 'sourceRowId'),
      displayName,
      // The source's CLUB is our scoring_team, never our club.
      scoringTeam,
      categoryRaw: category.raw,
      categoryLevel: category.canonical,
      categoryGradeBand: category.gradeBand,
      categoryGender: category.gender,
      conference: category.conference,
      place,
      // The source encodes a DNF two ways: the mass-start lists put `*` in
      // place and `DNF` in time, while the time trial puts `DNF` in place and
      // still publishes a real time. Both are read; neither is rewritten.
      //
      // `lapped` is a property of the field, not of the row: it needs the
      // category's leading lap count, which no single row carries. It is
      // derived in v_race_result. Ingest writes only what one row can say.
      status: place === '*' || place === 'DNF' || timeRaw === 'DNF' ? 'dnf' : 'finished',
      timeRaw,
      timeSeconds: parseTimeSeconds(timeRaw)?.toString() ?? null,
      points: parseIntOrRefuse(where, 'points', at(row, 'points')),
      laps:
        publishedLaps ??
        (hasLapColumns ? laps.filter((lap) => lap !== null && lap !== '-').length : null),
      lap1: laps[0] ?? null,
      lap2: laps[1] ?? null,
      lap3: laps[2] ?? null,
      lap4: laps[3] ?? null,
      penalty: at(row, 'penalty'),
      ptsLeader: at(row, 'ptsLeader') === 'B',
    });
  }

  const publishedCount = checkRowCount(where, payload.list?.ListFooterText, rows.length);
  checkUniqueKey(
    where,
    'plates',
    rows.map((row) => row.plate),
  );

  return { variant, expressions: layout.dataFields, publishedCount, rows };
}
