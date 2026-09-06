import Link from 'next/link';
import type { RosterWallCell, RosterWallRound, RosterWallRow } from '@/lib/roster-wall.ts';
import { buildRosterWallColumns, cellMark, describeCell, pctBackText } from './roster-wall.ts';

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
 */
export type RosterWallProps = {
  /** The season the wall is scoped to — only used to build a column's link. */
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

function Cell({ cell }: { cell: RosterWallCell }) {
  if (cell.state === 'did-not-start') {
    // Visibly empty, on purpose: a non-start must not read as a bad result,
    // so there is no chip, no glyph and no colour here at all — only the
    // fact, for a reader who cannot see that the cell is blank.
    return (
      <td className="border-border border p-2 text-center align-middle">
        <span className="sr-only">{describeCell(cell)}</span>
      </td>
    );
  }

  return (
    <td className="border-border border p-2 text-center align-middle">
      {cell.state === 'positioned' ? (
        <PositionedCell cell={cell} />
      ) : (
        <StartedNotPositionedCell cell={cell} />
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
              {row.cells.map((cell, i) => (
                <Cell key={columns[i]?.roundOrdinal ?? i} cell={cell} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
