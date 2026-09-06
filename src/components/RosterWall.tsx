import Link from 'next/link';
import type { RosterWallCell, RosterWallRound, RosterWallRow } from '@/lib/roster-wall.ts';
import {
  buildRosterWallColumns,
  categoryHref,
  cellMark,
  describeCell,
  pctBackText,
} from './roster-wall-view.ts';

/**
 * The Roster Wall: rows are Riders on the Squad, columns are Rounds of the
 * Season, left to right as raced (`docs/ux/coach-flow-session.md`). No data
 * access — every fact on the page comes from `RosterWallRow[]`, built by
 * `buildRosterWall` (`src/lib/roster-wall.ts`) from a database read the
 * caller already did.
 *
 * **The cell is a three-state mark, not a magnitude.** This is the session's
 * deliberate constraint, restated here because it is the one thing this
 * component must never quietly undo: no bar, no sparkline, nothing that
 * encodes "how well" as a length or an area. A positioned cell states its
 * place, its field size and its percent back, verbatim, in words. A
 * started-not-positioned cell says DNF or Lapped, in words. A did-not-start
 * cell is visibly empty — and, because empty must not read as a bad result,
 * it carries no chip, no colour and no glyph that a coach could mistake for
 * one.
 *
 * The three states are told apart by more than colour: each has its own
 * shape (numeral vs. chip vs. nothing) and its own words, so a coach who
 * cannot see colour still reads three different things.
 *
 * **The crossing** (ADR-0002, issue #92): a `positioned` or
 * `started-not-positioned` cell — any Round she started — links to her own
 * Category field at that Round (`categoryHref`, `src/components/roster-wall-view.ts`).
 * A `did-not-start` cell links nowhere; there is no Category to open for a
 * non-start. This is the one kind of link on the page that leaves the club
 * tree, so `Crossing` gives it its own mark rather than the plain underline
 * a round header gets.
 */
export type RosterWallProps = {
  /** The season the wall is scoped to — used to build a column's link and a crossing's. */
  seasonYear: number;
  rounds: readonly RosterWallRound[];
  rows: readonly RosterWallRow[];
};

/** A started-not-positioned cell's chip. Tone matches `RaceDetail.tsx`'s
 *  `CHIP_TONE` — the same words mean the same colours everywhere in the app. */
function StartedNotPositionedCell({
  cell,
}: {
  cell: Extract<RosterWallCell, { state: 'started-not-positioned' }>;
}) {
  const dnf = cell.reason === 'dnf';
  return (
    <span
      className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
        dnf ? 'bg-fg text-bg' : 'bg-navy text-white'
      }`}
    >
      {cellMark(cell)}
    </span>
  );
}

/** A positioned cell's place, field size and percent back — all read
 *  verbatim from the source, never re-derived (ADR-0001). */
function PositionedCell({ cell }: { cell: Extract<RosterWallCell, { state: 'positioned' }> }) {
  return (
    <div>
      <div className="font-display text-lg leading-none">{cell.place}</div>
      <div className="text-muted text-[10px]">of {cell.fieldSize}</div>
      <div
        className={`text-[11px] ${
          cell.pctBack === null ? 'text-muted italic' : 'text-accent font-semibold'
        }`}
      >
        {pctBackText(cell.pctBack)}
      </div>
    </div>
  );
}

/**
 * The crossing (ADR-0002): the one link out of the club tree, from a cell
 * that started to her own Category field at that Round. Everywhere else on
 * this page is a link within the club tree (a round header to the Round
 * page); this is the single kind of link that leaves it, so it carries its
 * own small "↗ category" mark rather than the plain underline a round header
 * gets — a shape difference, not just a colour, and named in words for a
 * screen reader too.
 */
function Crossing({
  href,
  cell,
  children,
}: {
  href: string;
  cell: RosterWallCell;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="focus-visible:outline-accent block rounded outline-offset-2 focus-visible:outline-2"
    >
      {children}
      <span
        aria-hidden="true"
        className="text-accent mt-0.5 block text-[9px] font-bold tracking-wide"
      >
        ↗ category
      </span>
      <span className="sr-only">{`${describeCell(cell)}. Open her Category at this round.`}</span>
    </Link>
  );
}

function Cell({ cell, href }: { cell: RosterWallCell; href: string | null }) {
  if (cell.state === 'did-not-start') {
    // Visibly empty, on purpose: a non-start must not read as a bad result,
    // so there is no chip, no glyph and no colour here at all — only the
    // fact, for a reader who cannot see that the cell is blank. It also
    // never links: there is no Category to open for a Round she did not
    // start.
    return (
      <td className="border-border border p-2 text-center align-middle">
        <span className="sr-only">{describeCell(cell)}</span>
      </td>
    );
  }

  const mark =
    cell.state === 'positioned' ? (
      <PositionedCell cell={cell} />
    ) : (
      <StartedNotPositionedCell cell={cell} />
    );

  return (
    <td className="border-border border p-2 text-center align-middle">
      {href ? (
        <Crossing href={href} cell={cell}>
          {mark}
        </Crossing>
      ) : (
        mark
      )}
    </td>
  );
}

export function RosterWall({ seasonYear, rounds, rows }: RosterWallProps) {
  const columns = buildRosterWallColumns(seasonYear, rounds);

  if (rows.length === 0) {
    return (
      <p className="border-border bg-surface text-muted mt-8 rounded-lg border p-5 text-sm">
        No riders are on this squad&rsquo;s roster yet.
      </p>
    );
  }

  if (columns.length === 0) {
    return (
      <p className="border-border bg-surface text-muted mt-8 rounded-lg border p-5 text-sm">
        No rounds are published yet for the {seasonYear} season.
      </p>
    );
  }

  return (
    <div className="mt-8 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">
          Roster wall: one row per rider, one column per round. Each cell states whether the rider
          was positioned, started without a position — a DNF or lapped — or did not start.
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              className="border-border text-muted border-b p-2 text-left text-xs font-bold tracking-wider uppercase"
            >
              Rider
            </th>
            {columns.map((column) => (
              <th
                key={column.roundOrdinal}
                scope="col"
                className="border-border border-b p-2 text-center text-xs font-bold tracking-wider uppercase"
              >
                <Link href={column.href} className="hover:text-accent underline">
                  {column.roundName}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.rider.riderId}>
              <th
                scope="row"
                className="border-border bg-surface border-b p-2 text-left font-semibold"
              >
                {row.rider.riderName}
              </th>
              {row.cells.map((cell, i) => {
                const roundOrdinal = columns[i]?.roundOrdinal;
                const href =
                  cell.state === 'did-not-start' || roundOrdinal === undefined
                    ? null
                    : categoryHref(seasonYear, roundOrdinal, row.rider.riderId);
                return <Cell key={roundOrdinal ?? i} cell={cell} href={href} />;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
