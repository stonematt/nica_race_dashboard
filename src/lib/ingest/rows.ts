/**
 * The parts of decoding every family shares: walking `data`, resolving a
 * family's canonical fields, and refusing what cannot be read faithfully.
 *
 * The six families differ in what their rows *mean* and agree completely on how
 * a row is reached and how a cell becomes a value, so that agreement lives here
 * rather than being retyped five times. Every refusal in this file is one of
 * the ruling's fatal assertions.
 */

import { readColumnLayout, type ColumnLayout, type DisplayField } from './columns.ts';
import { IngestError } from './errors.ts';
import { recognizedExpressions, type Family, type LayoutVariant } from './families.ts';

/** A payload that cannot be decoded faithfully. Refuse to write. */
export class DecodeError extends IngestError {}

/** The parts of a list payload a decode reads. */
export interface ListPayload {
  list?: { ListName?: unknown; ListFooterText?: unknown; Fields?: unknown };
  DataFields?: unknown;
  data?: unknown;
}

/**
 * What decoding one list produces, whatever family it belongs to.
 *
 * One envelope rather than one per family: the three decoders differ in what a
 * row *is* and agree on everything around it, and the snapshot reads the same
 * three fields from all of them.
 */
export interface DecodedList<Row> {
  variant: LayoutVariant;
  /** `DataFields` verbatim — the snapshot's record of this event's layout. */
  expressions: readonly string[];
  /** The `ListFooterText` count, where the source published one. */
  publishedCount: number | null;
  /** Ordinals of the repeat block, for the families that have one. */
  ordinals?: number[];
  rows: Row[];
}

/** One row, with the group labels above it. */
export interface GroupedRow {
  /** Group labels outermost first, `#N_` ordinals stripped. */
  groups: string[];
  row: string[];
  /** 1-based position in the list, for error messages. */
  number: number;
}

/**
 * Strip the `#N_` ordinal the source prefixes onto every group key.
 *
 * The ordinal is presentation order within one payload and drifts between
 * events, so it is never part of what a group means.
 */
export function stripGroupOrdinal(groupKey: string): string {
  return groupKey.replace(/^#\d+_/, '');
}

/**
 * How many levels of grouping sit above the rows.
 *
 * The flat individual list is 1 — grouped by category and nothing else. By-Team
 * and `Team Results - Detailed` are 3. Depth is part of a family's identity, so
 * it is measured rather than assumed.
 */
export function dataDepth(data: unknown): number {
  if (Array.isArray(data)) return 0;
  if (data === null || typeof data !== 'object') return -1;
  const first = Object.values(data as Record<string, unknown>)[0];
  if (first === undefined) return -1;
  const inner = dataDepth(first);
  return inner < 0 ? -1 : inner + 1;
}

/** Rows under a `data` object at any nesting depth, counted not decoded. */
export function countRows(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (data === null || typeof data !== 'object') return 0;
  return Object.values(data as Record<string, unknown>).reduce<number>(
    (total, group) => total + countRows(group),
    0,
  );
}

/**
 * Every row of a `data` object at exactly `depth` levels of grouping.
 *
 * Walks to the declared depth rather than to whatever it finds, so a payload
 * that nests differently than its family says fails here instead of quietly
 * yielding group labels as rows.
 */
export function* groupedRows(where: string, data: unknown, depth: number): Generator<GroupedRow> {
  let number = 0;

  function* walk(node: unknown, groups: string[]): Generator<GroupedRow> {
    if (groups.length === depth) {
      if (!Array.isArray(node)) {
        throw new DecodeError(
          `${where}: expected rows ${depth} level(s) down at [${groups.join(' > ')}], got ${typeof node}.`,
        );
      }
      for (const row of node) {
        number += 1;
        if (!Array.isArray(row)) {
          throw new DecodeError(
            `${where}: row ${number} at [${groups.join(' > ')}] is not an array.`,
          );
        }
        yield { groups, row: row.map((cell) => (cell === null ? '' : String(cell))), number };
      }
      return;
    }

    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      throw new DecodeError(
        `${where}: expected a group object ${groups.length} level(s) down, got ${
          Array.isArray(node) ? 'rows' : typeof node
        }.`,
      );
    }
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      yield* walk(child, [...groups, stripGroupOrdinal(key)]);
    }
  }

  yield* walk(data, []);
}

/**
 * The column layout of a list payload.
 *
 * One reader, used both when a list is placed into a family and when it is
 * decoded, so the two cannot disagree about a payload's columns or report the
 * same drift as two different errors.
 */
export function readListLayout(where: string, payload: ListPayload): ColumnLayout {
  const dataFields = payload.DataFields;
  if (!Array.isArray(dataFields) || !dataFields.every((f) => typeof f === 'string')) {
    throw new DecodeError(`${where}: DataFields is not an array of strings.`);
  }
  const fields = Array.isArray(payload.list?.Fields) ? (payload.list.Fields as DisplayField[]) : [];

  return readColumnLayout(where, dataFields, fields);
}

/**
 * Every transported expression must be accounted for by the family.
 *
 * Strict unknown-expression fatality, pre-v1. Recognized means mapped to a
 * canonical field, matched by a repeat group, or explicitly ignored; an
 * expression nobody has classified halts the event rather than being decoded
 * around.
 */
export function checkExpressionsRecognized(
  where: string,
  layout: ColumnLayout,
  family: Family,
): void {
  const known = recognizedExpressions(family);
  const unknown = layout.dataFields.filter((expression) => !known.has(expression));

  if (unknown.length > 0) {
    throw new DecodeError(
      `${where}: ${unknown.length} expression(s) unrecognized for ${family.name}: ${unknown.join(', ')}. ` +
        'Every expression must be mapped to a canonical field, matched by a repeat group, or ' +
        'explicitly ignored (src/lib/ingest/families.ts) before this event can be decoded.',
    );
  }
}

/** Canonical field -> its column in this layout, or null where absent. */
export type FieldColumns = Record<string, number | null>;

/** Resolve a family's canonical fields, refusing if a required one is missing. */
export function resolveFamilyFields(
  where: string,
  layout: ColumnLayout,
  family: Family,
): FieldColumns {
  const columns: FieldColumns = {};
  for (const [field, aliases] of Object.entries(family.aliases)) {
    columns[field] = layout.resolve(field, aliases)?.column ?? null;
  }

  const missing = family.required.filter((field) => columns[field] === null);
  if (missing.length > 0) {
    throw new DecodeError(
      `${where}: required field(s) ${missing.join(', ')} resolve to no column. ` +
        `Columns present: ${layout.dataFields.join(', ')}`,
    );
  }

  return columns;
}

/** A reader for one row: canonical field in, published cell (or null) out. */
export function cellReader(layout: ColumnLayout, columns: FieldColumns) {
  return (row: readonly string[], field: string): string | null => {
    const column = columns[field];
    if (column === undefined || column === null) return null;
    return cellOrNull(layout.cell(row, column));
  };
}

/** An empty cell carries no value. A published sentinel like `-` is a value. */
export function cellOrNull(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

/**
 * An integer cell, or null when the source left it empty.
 *
 * Refuses anything else rather than returning null. Most integer columns have
 * no verbatim sibling the way `time_raw` sits beside `time_seconds`, so a value
 * that failed to parse would simply vanish — which is the one thing a fidelity
 * layer may never do.
 */
export function parseIntOrRefuse(
  where: string,
  field: string,
  value: string | null,
): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new DecodeError(
      `${where}: ${field} is "${value}", which is not an integer. ` +
        'There is no verbatim column to fall back on, so this cannot be stored as null.',
    );
  }
  return parsed;
}

/** `Number of records: 423`, or null where the source published no footer. */
export function publishedRowCount(footer: unknown): number | null {
  if (typeof footer !== 'string') return null;
  const match = /Number of records:\s*(\d+)/i.exec(footer);
  return match ? Number(match[1]) : null;
}

/**
 * The decoded count must agree with the count the source printed.
 *
 * Skipped where there is no footer — populated across 2025, empty at the
 * prologue and at the 2026 opener.
 */
export function checkRowCount(where: string, footer: unknown, decoded: number): number | null {
  const published = publishedRowCount(footer);
  if (published !== null && published !== decoded) {
    throw new DecodeError(
      `${where}: decoded ${decoded} rows but the source footer says ${published}. ` +
        'A count that disagrees with the published one means rows were lost or duplicated.',
    );
  }
  return published;
}

/** A key that must identify one row per event. A collision would drop a result. */
export function checkUniqueKey(where: string, what: string, keys: readonly string[]): void {
  if (new Set(keys).size !== keys.length) {
    throw new DecodeError(
      `${where}: ${keys.length} rows carry only ${new Set(keys).size} distinct ${what}. ` +
        'That is the row key for an event; a collision would silently drop a published result.',
    );
  }
}
