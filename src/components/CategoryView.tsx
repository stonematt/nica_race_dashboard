import type { CategoryField, CategoryFieldRow } from '@/lib/category.ts';
import { pctBackText } from './roster-wall-view.ts';
import {
  HER_ROW_ID,
  anchorHeadline,
  listDescription,
  rowMark,
  scopeStatement,
} from './category-view.ts';

/**
 * The crossing's destination (ADR-0002, issue #92): a ranked list anchored on
 * her own row, not a distribution. `docs/adr/0001-description-not-adjudication.md`
 * line, restated here: every fact this component draws — place, percent
 * back, lapped, field size — comes verbatim from `CategoryField`
 * (`src/lib/category.ts`), already ranked; this component never re-sorts or
 * re-derives any of it.
 *
 * **Anchored, not scrolled to.** Her own row carries the `id` `HER_ROW_ID`
 * (`src/components/category-view.ts`), and every crossing link that opens
 * this page ends in `#her` (`categoryHref`, `src/components/roster-wall-view.ts`).
 * A browser scrolls to a URL's own fragment on load, with no client script —
 * the same mechanism an in-page "jump to her row" link at the top of the
 * list also uses, for the rare direct hit that lands here without the
 * fragment. This is what makes the list read identically at both ends of the
 * corpus: 2 riders (`Varsity Girls - South`) or 80 (`HS1 Boys - North`), her
 * row is one native scroll away, never a search through a wall of names.
 *
 * The three states render inline, in the list's own order: a DNF or a
 * lapped rider is a row with no numeric place, never a row that is missing.
 * Her row and a squad-mate's row are told apart from an ordinary row by more
 * than colour — each carries its own text badge and its own left border, not
 * only a tint.
 */
export type CategoryViewProps = {
  field: CategoryField;
  /** The Rider the crossing was opened for — whose row gets `HER_ROW_ID`. */
  riderId: number;
};

const CHIP_TONE: Record<'dnf' | 'lapped', string> = {
  dnf: 'bg-fg text-bg',
  lapped: 'bg-navy text-white',
};

function RowMark({ row }: { row: CategoryFieldRow }) {
  if (row.status === 'dnf' || row.isLapped) {
    const tone = row.status === 'dnf' ? 'dnf' : 'lapped';
    return (
      <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${CHIP_TONE[tone]}`}>
        {rowMark(row)}
      </span>
    );
  }
  return (
    <span className="font-display tabular-nums block w-10 text-right text-lg leading-none">
      {rowMark(row)}
    </span>
  );
}

/** One row of the ranked list. `isHer` and `isSquadMate` are mutually
 *  exclusive in the rendering: her own row always wins, even though she is
 *  necessarily also a squad-mate. */
function Row({ row, isHer }: { row: CategoryFieldRow; isHer: boolean }) {
  const tone = isHer
    ? 'border-l-accent bg-accent/10 border-l-4'
    : row.isSquadMate
      ? 'border-l-navy bg-navy/5 border-l-4'
      : 'border-l-4 border-l-transparent';

  return (
    <li
      id={isHer ? HER_ROW_ID : undefined}
      className={`border-border flex items-center justify-between gap-3 border-b p-2 text-sm ${tone}`}
    >
      <div className="flex items-center gap-3">
        <RowMark row={row} />
        <div>
          <div className="font-semibold">
            {row.displayName}
            {isHer ? (
              <span className="bg-accent on-accent ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide uppercase">
                Her result
              </span>
            ) : row.isSquadMate ? (
              <span className="bg-navy ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white uppercase">
                Squad
              </span>
            ) : null}
          </div>
          <div className="text-muted text-xs">{row.scoringTeam}</div>
        </div>
      </div>
      <div
        className={
          row.pctBack === null ? 'text-muted text-xs italic' : 'text-accent text-xs font-semibold'
        }
      >
        {pctBackText(row.pctBack)}
      </div>
    </li>
  );
}

export function CategoryView({ field, riderId }: CategoryViewProps) {
  const her = field.rows.find((row) => row.riderId === riderId);

  return (
    <div className="mt-6">
      <h1 className="font-display text-3xl tracking-wide uppercase">{field.categoryName}</h1>
      <p className="text-muted mt-1 text-sm">{scopeStatement(field)}</p>

      {her ? (
        <div className="border-border bg-surface mt-4 rounded-lg border p-4">
          <p className="text-muted text-xs font-bold tracking-wider uppercase">Her result</p>
          <p className="font-display mt-1 text-3xl leading-none">
            {anchorHeadline(her, field.fieldSize)}
          </p>
          <p
            className={
              her.pctBack === null
                ? 'text-muted mt-1 text-sm italic'
                : 'text-accent mt-1 text-sm font-semibold'
            }
          >
            {pctBackText(her.pctBack)}
          </p>
          <a href={`#${HER_ROW_ID}`} className="text-accent mt-3 inline-block text-xs underline">
            Jump to her row in the list below
          </a>
        </div>
      ) : null}

      <p className="sr-only">{listDescription(field, her)}</p>

      <ol className="border-border mt-6 list-none rounded-lg border p-0">
        {field.rows.map((row, i) => (
          <Row key={`${row.plate}-${i}`} row={row} isHer={her !== undefined && row === her} />
        ))}
      </ol>
    </div>
  );
}
