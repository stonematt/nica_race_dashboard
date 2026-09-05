/**
 * Place a shape-corpus list into its family, the way normalize does.
 *
 * Every step here is an exported ingest primitive, called in the order
 * `src/lib/ingest/normalize.ts` calls them: read the layout, measure the data
 * depth, assign the family by signature, then classify every transported
 * expression. Nothing about the rules lives in this file — a family is declared
 * once, in `src/lib/ingest/families.ts`, and this lane only feeds it payloads.
 *
 * It is a separate composition rather than a call into normalize because
 * normalize's own `placeLists()` is private to that module and takes archived
 * database rows, and `src/lib/ingest/` is not this lane's to edit. The five
 * calls below are the whole of it.
 *
 * **Two fields the shape lane cannot fill honestly.** `decoded` and
 * `skippedBecause` are outcomes of the decode pass — which list won the
 * hidden-mode tie-break, whether a season layout was a record, whether the
 * event carried a conference. All three read facts a stripped payload does not
 * carry, so they are left at their neutral values here and
 * `src/lib/shape/drift.ts` compares nothing that depends on them.
 */

import { assignFamily, type Family, type LayoutVariant } from '../ingest/families.ts';
import type { PlacedList } from '../ingest/normalize.ts';
import {
  checkExpressionsRecognized,
  countRows,
  dataDepth,
  readListLayout,
} from '../ingest/rows.ts';
import { readColumnLayout, type ColumnLayout } from '../ingest/columns.ts';
import { hydrate, whereOf, type ShapeListFile } from './corpus.ts';

/** The resolved column layout of a shape list, as ingest reads it. */
export function layoutOf(file: ShapeListFile): ColumnLayout {
  return readListLayout(whereOf(file), hydrate(file));
}

/**
 * A layout built straight from a column list, for the mutation tests.
 *
 * The same door `readListLayout` goes through, without a payload around it, so
 * a test can state "these columns, at this depth" and nothing else.
 */
export function layoutFrom(where: string, dataFields: readonly string[]): ColumnLayout {
  return readColumnLayout(
    where,
    dataFields,
    dataFields.map((expression) => ({ Expression: expression })),
  );
}

/** Which family and layout variant a shape list belongs to. */
export function familyOf(file: ShapeListFile): { family: Family; variant: LayoutVariant } {
  const payload = hydrate(file);
  return assignFamily(whereOf(file), layoutOf(file), dataDepth(payload.data));
}

/**
 * One shape list, placed — the input `buildSnapshot()` takes.
 *
 * Throws exactly where normalize would: an unrecognized list, an ambiguous one,
 * a duplicated column, a displayed field with no transported column, or an
 * expression nobody has classified.
 */
export function placeShapeList(file: ShapeListFile): PlacedList {
  const where = whereOf(file);
  const payload = hydrate(file);
  const layout = readListLayout(where, payload);
  const { family, variant } = assignFamily(where, layout, dataDepth(payload.data));

  checkExpressionsRecognized(where, layout, family);

  return {
    season: file.shape.season,
    eventId: file.shape.eventId,
    listId: file.shape.listId,
    listName: file.list.ListName,
    family,
    variant,
    expressions: layout.dataFields,
    rowCount: countRows(payload.data),
    hidden: file.shape.hidden,
    decoded: false,
    skippedBecause: null,
  };
}
