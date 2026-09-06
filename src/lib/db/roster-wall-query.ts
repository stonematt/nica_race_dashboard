/**
 * Everything the Roster Wall reads, and the one place it reads it.
 *
 * Three plain reads, handed to the pure `buildRosterWall` in
 * `src/lib/roster-wall.ts`:
 *
 *   - `loadSquadRoster` — the rows: every rider currently on the Squad.
 *     Squads are current-state only (no mid-season history, issue #81), so
 *     this is `squad_member` as it stands today, not a Season-bounded log.
 *   - `loadSeasonRounds` — the columns: every Round of the Season, in the
 *     league's own numbering.
 *   - `loadRosterWallResults` — the cells' raw material: `v_rider_result`
 *     joined straight to the Squad, filtered to the Season. Reading the view
 *     rather than `individual_result` is what resolves a rider's identity
 *     across the Round's Event(s) for free — a Round with two Events (North
 *     and South) is already collapsed to one `round_ordinal` per row by the
 *     view's own join through `event -> round`, and a plate change or reissue
 *     mid-season is already resolved within its bounds (issue #7, ADR-0002).
 *
 * A Squad member with no rider_plate mapped for the Season reads as
 * did-not-start here even if she raced under an unmapped plate — the same gap
 * the coach-flow session named and left for the M0 queue (`v_unmapped_rider`)
 * to close, not this wall.
 */

import { sql } from 'drizzle-orm';
import type { Database } from './index.ts';
import type { RosterWallResult, RosterWallRider, RosterWallRound } from '../roster-wall.ts';

/**
 * Any database this module can read: the app's, or a test's in-memory one.
 *
 * Narrowed to `execute`, the same seam `src/app/races/[eventId]/query.ts`
 * uses — it keeps the test seam structural rather than importing
 * `db/testing.ts`, which would pull the migrator into the app bundle.
 */
export type AnyDatabase = Pick<Database, 'execute'>;

type Row = Record<string, unknown>;

const rowsOf = (result: { rows: unknown[] }): Row[] => result.rows as Row[];

const str = (v: unknown): string => String(v ?? '');
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Every rider currently on the Squad — the wall's rows. */
export async function loadSquadRoster(
  db: AnyDatabase,
  squadId: number,
): Promise<RosterWallRider[]> {
  const result = await db.execute(sql`
    select r.id as rider_id, r.display_name as rider_name
      from squad_member sm
      join rider r on r.id = sm.rider_id
     where sm.squad_id = ${squadId}
     order by r.display_name`);

  return rowsOf(result).map((row) => ({
    riderId: num(row.rider_id),
    riderName: str(row.rider_name),
  }));
}

/** Every Round of the Season — the wall's columns, league-ordinal order. */
export async function loadSeasonRounds(
  db: AnyDatabase,
  seasonId: number,
): Promise<RosterWallRound[]> {
  const result = await db.execute(sql`
    select id as round_id, ordinal as round_ordinal, name as round_name
      from round
     where season_id = ${seasonId}
     order by ordinal`);

  return rowsOf(result).map((row) => ({
    roundId: num(row.round_id),
    roundOrdinal: num(row.round_ordinal),
    roundName: str(row.round_name),
  }));
}

/**
 * Every result the Squad's own riders have for the Season, one row per
 * `(rider, round)` the source actually published — the wall derives
 * did-not-start itself, by finding no row here.
 */
export async function loadRosterWallResults(
  db: AnyDatabase,
  squadId: number,
  seasonId: number,
): Promise<RosterWallResult[]> {
  const result = await db.execute(sql`
    select rr.rider_id, rr.round_ordinal, rr.place, rr.status, rr.is_lapped,
           rr.pct_back, rr.field_size, rr.category
      from v_rider_result rr
      join squad_member sm on sm.rider_id = rr.rider_id
     where sm.squad_id = ${squadId}
       and rr.season_id = ${seasonId}`);

  return rowsOf(result).map((row) => ({
    riderId: num(row.rider_id),
    roundOrdinal: num(row.round_ordinal),
    place: str(row.place),
    status: row.status === 'dnf' ? 'dnf' : 'finished',
    isLapped: row.is_lapped === true,
    pctBack: numOrNull(row.pct_back),
    fieldSize: num(row.field_size),
    category: str(row.category),
  }));
}

/** The three reads together — everything `buildRosterWall` needs for one Squad and Season. */
export async function loadRosterWallInputs(
  db: AnyDatabase,
  squadId: number,
  seasonId: number,
): Promise<{ riders: RosterWallRider[]; rounds: RosterWallRound[]; results: RosterWallResult[] }> {
  const [riders, rounds, results] = await Promise.all([
    loadSquadRoster(db, squadId),
    loadSeasonRounds(db, seasonId),
    loadRosterWallResults(db, squadId, seasonId),
  ]);
  return { riders, rounds, results };
}
