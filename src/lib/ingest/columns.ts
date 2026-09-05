/**
 * Column resolution — the one place an expression becomes an index.
 *
 * This is the seam the whole decode hangs off, and it is isolated on purpose:
 * **no column index is ever written down anywhere else.** The layout drifts
 * five ways inside one 2025 season (`DataFields` runs 11, 12, 13 and 14 wide on
 * the flat individual list alone), so an index that outlives the event it was
 * read from is a wrong answer waiting to happen.
 *
 * Two rules carry the weight.
 *
 *   - **Resolve against `DataFields`, by expression.** `DataFields.indexOf(expr)`
 *     is the whole mechanism.
 *
 *   - **Never zip `Fields` with `DataFields`.** They are different lengths —
 *     10 vs 11 at the 2026 opener, 11 vs 13 at 2025 Race 2 South — because
 *     `BIB` and `ID` ride in `DataFields` without being displayed. Zipping them
 *     shifts every column right of the first gap, silently, and produces a
 *     decode that type-checks and is entirely wrong.
 *
 * `Fields` is still read, for one thing only: every displayed expression must
 * exist in `DataFields`. A displayed column with no transported column is drift
 * worth halting on.
 *
 * A note on style: this is a factory returning a frozen object rather than a
 * class with parameter properties, because `bin/normalize.ts` runs under Node's
 * native type stripping and parameter properties are not strippable. Nothing
 * reachable from a `bin/` entry point may use them.
 */

import { IngestError } from './errors.ts';

/** A layout that cannot be resolved. Never recoverable — refuse to write. */
export class ColumnError extends IngestError {}

/** One entry of `list.Fields[]`, reduced to what resolution needs. */
export interface DisplayField {
  Expression: string;
  Label?: string;
}

/** A resolved alias and the column it sits in. */
export interface ResolvedColumn {
  alias: string;
  column: number;
}

/**
 * A resolved layout for exactly one list at exactly one event.
 *
 * Build it per event, use it, drop it. There is deliberately no cache, no
 * module-level map and no memoisation keyed on anything but the payload itself.
 */
export interface ColumnLayout {
  /** `DataFields`, verbatim and in payload order. */
  readonly dataFields: readonly string[];
  /** Where this layout came from, for error messages. */
  readonly where: string;
  has(expression: string): boolean;
  /** The column for an expression, or -1. */
  indexOf(expression: string): number;
  /** The cell at a column, or undefined when the column is absent. */
  cell(row: readonly string[], column: number): string | undefined;
  /**
   * The single alias of `canonical` this layout carries, or null for none.
   *
   * More than one is fatal: two spellings of the same canonical field in one
   * payload means the source changed under us in a way the alias table does not
   * describe, and choosing between them by list order would bury it.
   */
  resolve(canonical: string, aliases: readonly string[]): ResolvedColumn | null;
  /** Every row must be exactly `DataFields` wide. A short row is not a null. */
  checkRowWidth(row: readonly unknown[], rowNumber: number): void;
}

/**
 * Read a layout out of a list payload.
 *
 * A duplicate expression in `DataFields` is fatal: it makes resolution
 * ambiguous, and taking the first would be a guess.
 */
export function readColumnLayout(
  where: string,
  dataFields: readonly string[],
  fields: readonly DisplayField[],
): ColumnLayout {
  if (dataFields.length === 0) {
    throw new ColumnError(`${where}: DataFields is empty, so no column can be resolved.`);
  }

  const index = new Map<string, number>();
  for (const [position, expression] of dataFields.entries()) {
    if (index.has(expression)) {
      throw new ColumnError(
        `${where}: DataFields carries "${expression}" at both ${index.get(expression)} and ${position}. ` +
          'A duplicated expression makes the column ambiguous; resolving it would be a guess.',
      );
    }
    index.set(expression, position);
  }

  for (const field of fields) {
    if (!index.has(field.Expression)) {
      throw new ColumnError(
        `${where}: displayed field "${field.Expression}" has no column in DataFields. ` +
          'Fields and DataFields are never zipped, so this is real drift, not an offset.',
      );
    }
  }

  const has = (expression: string) => index.has(expression);

  return Object.freeze({
    dataFields,
    where,
    has,
    indexOf: (expression: string) => index.get(expression) ?? -1,
    cell: (row: readonly string[], column: number) => (column < 0 ? undefined : row[column]),

    resolve(canonical: string, aliases: readonly string[]): ResolvedColumn | null {
      const present = aliases.filter(has);
      if (present.length > 1) {
        throw new ColumnError(
          `${where}: ${present.length} aliases for ${canonical} are present at once ` +
            `(${present.join(', ')}). Picking one would be a guess.`,
        );
      }
      const alias = present[0];
      return alias === undefined ? null : { alias, column: index.get(alias)! };
    },

    checkRowWidth(row: readonly unknown[], rowNumber: number): void {
      if (row.length !== dataFields.length) {
        throw new ColumnError(
          `${where}: row ${rowNumber} is ${row.length} wide, DataFields is ${dataFields.length}. ` +
            'A row that does not match the declared width cannot be decoded positionally.',
        );
      }
    },
  });
}
