/**
 * The Roster Wall's grid, built from plain facts — no database in this file.
 *
 * The model (`docs/ux/coach-flow-session.md`): **rows are Riders in the Squad,
 * columns are Rounds in the Season**, and each cell is a three-state mark, not
 * a magnitude:
 *
 *   - **positioned** — the rider has a published place at that Round.
 *   - **started but not positioned** — she started and has no position: a DNF,
 *     or lapped. (`v_race_result`'s `is_lapped` already excludes DNFs, so a
 *     lapped rider here always has `status = 'finished'`.)
 *   - **did not start** — on the roster for the Season, no `individual_result`
 *     row at any Event belonging to that Round. This is the *absence* of a
 *     result, never a status value — the source publishes only
 *     `'finished' | 'dnf'`, no DNS.
 *
 * `src/lib/db/roster-wall-query.ts` is the only thing that reads a database. It
 * resolves rider identity across a Round's Event(s) and hands this module three
 * lists of plain objects: the roster, the Rounds, and the results found. That
 * split is what makes this module testable on synthetic data and keeps the ADR
 * boundary honest — this file only arranges facts, it never computes one.
 *
 * ADR-0001 line, restated for this module: a positioned cell carries place (as
 * published), percent back, lapped, field size and category — all description.
 * It never carries or invents points, season place, category assignment, DQ or
 * eligibility. Those are adjudication, and NICA is the scoring authority.
 */

export type RosterWallCellState = 'positioned' | 'started-not-positioned' | 'did-not-start';

/** A rider on the Squad, as the wall renders her — one row. */
export type RosterWallRider = {
  riderId: number;
  riderName: string;
};

/** One Round of the Season — one column, whichever of its Events it took. */
export type RosterWallRound = {
  roundId: number;
  roundOrdinal: number;
  roundName: string;
};

/**
 * One rider's resolved result at one Round — the fact the query layer hands
 * over after crossing the Round's Event(s) and the rider's plate mapping.
 *
 * At most one of these should exist per `(riderId, roundOrdinal)` pair for a
 * club that sits in a single Conference (see `docs/ux/coach-flow-session.md`,
 * "Rule 3"): a Squad's own riders never race two Events in the same Round. If
 * the query layer ever hands over more than one for the same pair — a data
 * anomaly, not the ordinary case — `buildRosterWall` resolves it rather than
 * throwing; see `resolveCell` below.
 */
export type RosterWallResult = {
  riderId: number;
  roundOrdinal: number;
  /** Verbatim. `*`, `DNF` or empty for a non-finisher — never rewritten. */
  place: string;
  status: 'finished' | 'dnf';
  isLapped: boolean;
  /** Null for a DNF, a lapped rider, or anyone the source could not compare. */
  pctBack: number | null;
  fieldSize: number;
  /** The canonical category name, as `v_individual_result` resolves it. */
  category: string;
};

/** A published place, a comparable time, and the description around it. */
export type RosterWallPositionedCell = {
  state: 'positioned';
  place: string;
  pctBack: number | null;
  isLapped: false;
  fieldSize: number;
  category: string;
};

/** She started and the source gives her no position: a DNF, or lapped. */
export type RosterWallStartedCell = {
  state: 'started-not-positioned';
  reason: 'dnf' | 'lapped';
};

/** No `individual_result` row at any Event of this Round. */
export type RosterWallAbsentCell = {
  state: 'did-not-start';
};

export type RosterWallCell =
  RosterWallPositionedCell | RosterWallStartedCell | RosterWallAbsentCell;

/** One row of the wall: a rider, and her mark at every column in `rounds` order. */
export type RosterWallRow = {
  rider: RosterWallRider;
  /** Parallel to the `rounds` array `buildRosterWall` was given, in that order. */
  cells: RosterWallCell[];
};

/** `roundOrdinal` ascending, so the columns read left to right as raced. */
function byOrdinal(a: RosterWallRound, b: RosterWallRound): number {
  return a.roundOrdinal - b.roundOrdinal;
}

/** The mark for one resolved result. Lapped is checked before place, per the
 *  model: a lapped rider is "started but not positioned" even though the
 *  source still prints her a numeric finishing rank. */
function markFor(result: RosterWallResult): RosterWallPositionedCell | RosterWallStartedCell {
  if (result.status === 'dnf') return { state: 'started-not-positioned', reason: 'dnf' };
  if (result.isLapped) return { state: 'started-not-positioned', reason: 'lapped' };
  return {
    state: 'positioned',
    place: result.place,
    pctBack: result.pctBack,
    isLapped: false,
    fieldSize: result.fieldSize,
    category: result.category,
  };
}

/**
 * Rank a cell so the best-known fact wins when more than one result lands on
 * the same `(riderId, roundOrdinal)` pair. Positioned beats started-but-not,
 * which beats nothing at all. Ties (more than one positioned result, which
 * should never happen for a single-Conference club) keep whichever the query
 * layer listed first — deterministic because the input order is.
 */
function cellRank(cell: RosterWallPositionedCell | RosterWallStartedCell): number {
  return cell.state === 'positioned' ? 0 : 1;
}

/** Collapse every result found for one `(rider, round)` pair into one cell. */
function resolveCell(results: readonly RosterWallResult[]): RosterWallCell {
  if (results.length === 0) return { state: 'did-not-start' };
  return results
    .map(markFor)
    .reduce((best, next) => (cellRank(next) < cellRank(best) ? next : best));
}

/**
 * Build the wall: every rider on the roster, crossed with every Round of the
 * Season, ordinal ascending — including Rounds the Squad did not attend.
 *
 * Pure. `rounds` is sorted here rather than trusted from the caller, the same
 * "own the order" instinct as `buildFieldStrip` (#74): a column order this
 * module does not guarantee is a column order a future caller can get wrong.
 * `riders` and `results` are taken in the order given — the roster's own order
 * is a rendering choice for the caller, not a fact this module owns.
 */
export function buildRosterWall(
  riders: readonly RosterWallRider[],
  rounds: readonly RosterWallRound[],
  results: readonly RosterWallResult[],
): RosterWallRow[] {
  const orderedRounds = [...rounds].sort(byOrdinal);

  const byRiderAndRound = new Map<number, Map<number, RosterWallResult[]>>();
  for (const result of results) {
    let byRound = byRiderAndRound.get(result.riderId);
    if (!byRound) {
      byRound = new Map();
      byRiderAndRound.set(result.riderId, byRound);
    }
    const existing = byRound.get(result.roundOrdinal);
    if (existing) existing.push(result);
    else byRound.set(result.roundOrdinal, [result]);
  }

  return riders.map((rider) => {
    const byRound = byRiderAndRound.get(rider.riderId);
    return {
      rider,
      cells: orderedRounds.map((round) => resolveCell(byRound?.get(round.roundOrdinal) ?? [])),
    };
  });
}
