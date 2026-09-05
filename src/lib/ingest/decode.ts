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
 * Everything else refuses. A required field that does not resolve, two aliases
 * for one field, a row that is not `DataFields` wide, a decoded count that
 * disagrees with the published footer, an unrecognized expression — each throws
 * before a single row is written.
 */

import { normalizeCategory, type Conference, type Gender, type GradeBand } from './category.ts';
import { readColumnLayout, type ColumnLayout, type DisplayField } from './columns.ts';
import { IngestError } from './errors.ts';
import {
  INDIVIDUAL_FLAT_ALIASES,
  INDIVIDUAL_FLAT_IGNORED,
  INDIVIDUAL_FLAT_REQUIRED,
  type IndividualField,
  type LayoutVariant,
} from './families.ts';

/** A payload that cannot be decoded faithfully. Refuse to write. */
export class DecodeError extends IngestError {}

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

/** The parts of a list payload a decode reads. */
export interface ListPayload {
  list?: { ListName?: unknown; ListFooterText?: unknown; Fields?: unknown };
  DataFields?: unknown;
  data?: unknown;
}

/**
 * How many levels of grouping sit above the rows.
 *
 * The flat individual list is 1 — grouped by category and nothing else. By-Team
 * and `Team Results - Detailed` are 3. Depth is part of a family's identity,
 * so it is measured rather than assumed.
 */
export function dataDepth(data: unknown): number {
  if (Array.isArray(data)) return 0;
  if (data === null || typeof data !== 'object') return -1;
  const first = Object.values(data as Record<string, unknown>)[0];
  if (first === undefined) return -1;
  const inner = dataDepth(first);
  return inner < 0 ? -1 : inner + 1;
}

/** Every `(groupKey, row)` pair under a depth-1 `data` object, in payload order. */
function* depthOneRows(where: string, data: unknown): Generator<[string, unknown[]]> {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new DecodeError(`${where}: \`data\` is not a group object.`);
  }
  for (const [groupKey, group] of Object.entries(data as Record<string, unknown>)) {
    if (!Array.isArray(group)) {
      throw new DecodeError(`${where}: group "${groupKey}" does not hold an array of rows.`);
    }
    for (const row of group) {
      if (!Array.isArray(row)) {
        throw new DecodeError(`${where}: group "${groupKey}" holds a non-row entry.`);
      }
      yield [groupKey, row];
    }
  }
}

/** `Number of records: 423`, or null where the source published no footer. */
export function publishedRowCount(footer: unknown): number | null {
  if (typeof footer !== 'string') return null;
  const match = /Number of records:\s*(\d+)/i.exec(footer);
  return match ? Number(match[1]) : null;
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

/** An empty cell carries no value. A published sentinel like `-` is a value. */
function cellOrNull(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

function parseIntOrNull(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Check that every transported expression is accounted for.
 *
 * Strict unknown-expression fatality, pre-v1. Recognized means mapped to a
 * canonical field *or* on the ignore list; an expression nobody has classified
 * halts the event rather than being decoded around.
 */
function checkExpressionsRecognized(where: string, layout: ColumnLayout): void {
  const known = new Set<string>(INDIVIDUAL_FLAT_IGNORED);
  for (const aliases of Object.values(INDIVIDUAL_FLAT_ALIASES)) {
    for (const alias of aliases) known.add(alias);
  }

  const unknown = layout.dataFields.filter((expression) => !known.has(expression));
  if (unknown.length > 0) {
    throw new DecodeError(
      `${where}: ${unknown.length} unrecognized expression(s): ${unknown.join(', ')}. ` +
        'Every expression must be mapped to a canonical field or explicitly ignored ' +
        '(src/lib/ingest/families.ts) before this event can be decoded.',
    );
  }
}

/** Resolve every canonical field to a column, or to null where absent. */
function resolveFields(
  where: string,
  layout: ColumnLayout,
): Record<IndividualField, number | null> {
  const columns = {} as Record<IndividualField, number | null>;

  for (const [field, aliases] of Object.entries(INDIVIDUAL_FLAT_ALIASES)) {
    const resolved = layout.resolve(field, aliases);
    columns[field as IndividualField] = resolved?.column ?? null;
  }

  const missing = INDIVIDUAL_FLAT_REQUIRED.filter((field) => columns[field] === null);
  if (missing.length > 0) {
    throw new DecodeError(
      `${where}: required field(s) ${missing.join(', ')} resolve to no column. ` +
        `Columns present: ${layout.dataFields.join(', ')}`,
    );
  }

  // A name arrives whole, or split in two. The 2025 prologue is the only place
  // the split appears, and it is an alias for the same canonical field.
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
  const dataFields = payload.DataFields;
  if (!Array.isArray(dataFields) || !dataFields.every((f) => typeof f === 'string')) {
    throw new DecodeError(`${where}: DataFields is not an array of strings.`);
  }
  const fields = Array.isArray(payload.list?.Fields) ? (payload.list.Fields as DisplayField[]) : [];

  const layout = readColumnLayout(where, dataFields, fields);
  checkExpressionsRecognized(where, layout);
  const columns = resolveFields(where, layout);

  const at = (row: readonly string[], field: IndividualField): string | null => {
    const column = columns[field];
    return column === null ? null : cellOrNull(layout.cell(row, column));
  };

  const rows: IndividualRow[] = [];
  let rowNumber = 0;

  for (const [groupKey, rawRow] of depthOneRows(where, payload.data)) {
    rowNumber += 1;
    layout.checkRowWidth(rawRow, rowNumber);
    const row = rawRow.map((cell) => (cell === null ? '' : String(cell)));

    const category = normalizeCategory(groupKey);
    const plate = at(row, 'plate');
    const place = at(row, 'place');
    const timeRaw = at(row, 'timeRaw');
    const scoringTeam = at(row, 'scoringTeam');

    if (plate === null || place === null || timeRaw === null || scoringTeam === null) {
      throw new DecodeError(
        `${where}: row ${rowNumber} in "${groupKey}" leaves a required field empty ` +
          '(plate, place, time or scoring team). A blank required cell is not a null result.',
      );
    }

    const displayName =
      columns.displayName !== null
        ? (at(row, 'displayName') ?? '')
        : `${at(row, 'firstName') ?? ''} ${at(row, 'lastName') ?? ''}`.trim();
    if (displayName === '') {
      throw new DecodeError(`${where}: row ${rowNumber} in "${groupKey}" has no name.`);
    }

    const laps = [at(row, 'lap1'), at(row, 'lap2'), at(row, 'lap3'), at(row, 'lap4')];
    const hasLapColumns = laps.some((_, i) => columns[`lap${i + 1}` as IndividualField] !== null);
    const publishedLaps = parseIntOrNull(at(row, 'laps'));

    rows.push({
      plate,
      // Provenance only. `ID` restarts at 1 every event and 468 values map to
      // more than one person in a single season — never join on it.
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
      // `lapped` is a property of the field, not of the row: it needs the
      // category's leading lap count, which no single row carries. It is
      // derived in v_race_result. Ingest writes only what one row can say.
      status: place === '*' || place === 'DNF' || timeRaw === 'DNF' ? 'dnf' : 'finished',
      timeRaw,
      timeSeconds: parseTimeSeconds(timeRaw)?.toString() ?? null,
      points: parseIntOrNull(at(row, 'points')),
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

  const publishedCount = publishedRowCount(payload.list?.ListFooterText);
  if (publishedCount !== null && publishedCount !== rows.length) {
    throw new DecodeError(
      `${where}: decoded ${rows.length} rows but the source footer says ${publishedCount}. ` +
        'A count that disagrees with the published one means rows were lost or duplicated.',
    );
  }

  const plates = new Set(rows.map((row) => row.plate));
  if (plates.size !== rows.length) {
    throw new DecodeError(
      `${where}: ${rows.length} rows carry only ${plates.size} distinct plates. ` +
        'The plate is the row key for an event; a collision would silently drop a result.',
    );
  }

  return { variant, expressions: layout.dataFields, publishedCount, rows };
}
