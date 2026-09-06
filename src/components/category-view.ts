/**
 * The Category view's presentational model — pure functions `CategoryView.tsx`
 * draws from, no database and no JSX here.
 *
 * Same split as `roster-wall-view.ts`: `src/lib/category.ts` and
 * `src/lib/db/category-query.ts` already resolve, rank and package the
 * field (ADR-0002's crossing). This module only chooses the words the page
 * says about facts those two already settled — the headline stat for her own
 * row, the mark each row shows, and the sentence stating exactly who is in
 * the list.
 *
 * ADR-0001 line, restated for this module: everything here is a description
 * of what the source already published, dressed in words for a coach to
 * read. It never computes or invents a place, a percent back, a field size
 * or a Category assignment — `ordinal` below reads a published place as a
 * number only to choose an English suffix, the same number, never a
 * different one.
 */

import type { CategoryField, CategoryFieldRow } from '@/lib/category.ts';
import { CROSSING_ANCHOR } from './roster-wall-view.ts';

/**
 * The `id` her own row on the Category page carries, so the crossing link's
 * `#` fragment lands the browser on it natively — the mechanism "visible on
 * load" runs on, at both ends of the corpus (2 riders, 80 riders), with no
 * client script required. Re-exported from `roster-wall-view.ts` so the two
 * sides of the crossing (the link, and the row it points at) can never name
 * two different anchors.
 */
export const HER_ROW_ID = CROSSING_ANCHOR;

const WHOLE_NUMBER = /^\d+$/;

/**
 * A whole number, spelled as the English ordinal a coach reads — "1st",
 * "2nd", "3rd", "11th", "22nd"… Formatting only: the number is exactly the
 * source's own published place, read once to choose a suffix, never
 * re-derived and never re-sorted (`src/lib/category.ts` already ranked the
 * field; this never touches order).
 */
export function ordinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * The headline stat for her own row — "3rd of 30" when the source published
 * a numeric place. When it did not, this names her state instead of
 * inventing a rank for it: a DNF or a lapped rider carries no ordinal to
 * give, and both still state the field size in words.
 */
export function anchorHeadline(row: CategoryFieldRow, fieldSize: number): string {
  // Lapped is checked before place, matching `src/lib/roster-wall.ts`'s
  // `markFor`: NICA still prints a numeric finishing rank for a rider it
  // pulled at the line, but that rank is not a position she holds, so it
  // never becomes an ordinal here.
  if (row.status === 'dnf') return `DNF, field of ${fieldSize}`;
  if (row.isLapped) return `Lapped, field of ${fieldSize}`;
  const trimmed = row.place.trim();
  if (WHOLE_NUMBER.test(trimmed)) return `${ordinal(Number(trimmed))} of ${fieldSize}`;
  return `Unplaced, field of ${fieldSize}`;
}

/**
 * The mark one row of the ranked list shows — the source's own place,
 * verbatim, or the reason there is none. The three states render inline,
 * here as everywhere else in this app: a DNF is a row with this mark, never
 * a row that is simply missing.
 */
export function rowMark(row: CategoryFieldRow): string {
  if (row.status === 'dnf') return 'DNF';
  if (row.isLapped) return 'Lapped';
  return row.place;
}

/**
 * The sentence stating exactly who is in this list: the Category as
 * published, and whether the peer set is this Club's own Conference or the
 * whole league (`CONTEXT.md`, Category — Conference-scoped through Round 4,
 * league-wide at State Champs). Read this instead of inferring it from
 * `scope`/`conference` — the ticket's own words for why this function
 * exists.
 */
export function scopeStatement(field: CategoryField): string {
  return field.scope === 'league'
    ? `${field.categoryName} — every starter across the league.`
    : `${field.categoryName} — every starter in the ${field.conference} Conference.`;
}

/**
 * The screen-reader summary for the ranked list as a whole — the field size,
 * her own row (when she has one to point at), and that squad-mates are
 * marked separately. Sighted and non-sighted readers get the same facts;
 * this is the non-sighted phrasing, matching the split `describeCell` makes
 * in `roster-wall-view.ts`.
 */
export function listDescription(field: CategoryField, her: CategoryFieldRow | undefined): string {
  const base = `Ranked list of ${field.fieldSize} starter${field.fieldSize === 1 ? '' : 's'} in ${field.categoryName}.`;
  if (her === undefined) return base;
  return `${base} ${her.displayName}'s row is marked. Squad-mates are marked separately.`;
}
