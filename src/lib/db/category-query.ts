/**
 * Everything the crossing reads, and the one place it reads it.
 *
 * Given a Rider and a Round, this module resolves the single Event her own
 * result sits in (`docs/ux/coach-flow-session.md`, Rule 3: a Squad-mate races
 * exactly one of the Round's Events, because a Club sits in one Conference),
 * reads every starter the source published in her Category at that Event, and
 * flags which of them are on the caller's Squad. `src/lib/category.ts`'s
 * `buildCategoryField` ranks and packages what this hands over.
 *
 * Three reads:
 *
 *   - `resolveRiderCategory` — where the crossing lands: the Event and
 *     Category name of the Rider's own result at the Round, and whether that
 *     Category still carries a Conference. Reads `v_rider_result`, so a plate
 *     change or reissue mid-season is already resolved within its bounds.
 *     Null when she has no result at the Round — there is no Category to
 *     open for a non-start.
 *   - `loadCategoryRows` — the field itself: every starter `v_race_result`
 *     published in that Category, at that Event, in that Conference,
 *     left-joined to `v_rider_result` so a plate that happens to belong to a
 *     tracked Rider (usually one of ours) carries her `rider_id`; everyone
 *     else's is null.
 *   - `loadSquadRiderIds` — the caller's own Squad, for flagging squad-mates
 *     in the field without the caller doing that join itself.
 *
 * An open question this lane found and did not resolve: `v_race_result`'s
 * `pct_back`, `category_laps` and `winner_seconds` are windowed over
 * `(event_id, category)`, and `category` is always Conference-stripped
 * (`src/lib/ingest/category.ts`). At the Prologue — one Event carrying 28
 * Conference-scoped contests for 14 Categories — that partition mixes North
 * and South into one winner and one lap count for the same Category. This
 * module corrects field size itself (below) because ADR-0001 allows field
 * size as computed description, but `pct_back` is arithmetic this lane is not
 * permitted to recompute, so a North rider's `pctBack` at the Prologue may be
 * measured against a South winner today. Flagged for the ticket owner, not
 * fixed here — and not the same gap as issue #98.
 */

import { sql } from 'drizzle-orm';
import type { Database } from './index.ts';
import { buildCategoryField, type CategoryField, type CategoryFieldRow } from '../category.ts';

/**
 * Any database this module can read: the app's, or a test's in-memory one.
 *
 * Narrowed to `execute`, the same seam `src/lib/db/roster-wall-query.ts` and
 * `src/app/races/[eventId]/query.ts` use.
 */
export type AnyDatabase = Pick<Database, 'execute'>;

type Row = Record<string, unknown>;

const rowsOf = (result: { rows: unknown[] }): Row[] => result.rows as Row[];

const str = (v: unknown): string => String(v ?? '');
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** The Round's own coordinates — the Season and league ordinal every other read here keys on. */
async function resolveRound(
  db: AnyDatabase,
  roundId: number,
): Promise<{ seasonId: number; roundOrdinal: number } | null> {
  const result = await db.execute(sql`select season_id, ordinal from round where id = ${roundId}`);
  const row = rowsOf(result)[0];
  return row ? { seasonId: num(row.season_id), roundOrdinal: num(row.ordinal) } : null;
}

/**
 * Where the Rider's own result puts her: the Event to cross into, the
 * Category to filter the field on, and the Conference her Category still
 * carries (null at State Champs). Null when she has no result at this Round
 * — a non-start opens no Category.
 *
 * Two names for the same Category, on purpose. `category` is the canonical,
 * Conference-stripped form `v_individual_result` coalesces to
 * (`src/lib/ingest/category.ts`) — safe to filter on even across a stable
 * spelling defect. `categoryRaw` is the source's own string, defects
 * included ("HS2 Boys- South"), which is what `buildCategoryField` shows as
 * "the Category's own name as published" — read verbatim, per ADR-0001, the
 * same treatment `place` gets.
 */
async function resolveRiderCategory(
  db: AnyDatabase,
  riderId: number,
  seasonId: number,
  roundOrdinal: number,
): Promise<{
  eventId: number;
  category: string;
  categoryRaw: string;
  conference: string | null;
} | null> {
  const result = await db.execute(sql`
    select event_id, category, category_raw, conference
      from v_rider_result
     where rider_id = ${riderId} and season_id = ${seasonId} and round_ordinal = ${roundOrdinal}
     limit 1`);
  const row = rowsOf(result)[0];
  if (!row) return null;
  return {
    eventId: num(row.event_id),
    category: str(row.category),
    categoryRaw: str(row.category_raw),
    conference:
      row.conference === null || row.conference === undefined ? null : str(row.conference),
  };
}

type RawCategoryRow = Omit<CategoryFieldRow, 'isSquadMate'>;

/**
 * Every starter the source published in this Category, at this Event, in
 * this Conference — and the Rider each plate resolves to, when it does. Most
 * rows resolve to no Rider at all — the Category's field is the whole
 * league, not this club's roster.
 *
 * The Conference filter matters even though `event_id` and `category` look
 * sufficient: `category` is always Conference-stripped (`v_individual_result`
 * coalesces to the canonical name, `src/lib/ingest/category.ts`), and the
 * Prologue and State Champs each publish the whole league as *one* Event. At
 * State Champs that is correct — the Categories genuinely merge — so
 * `conference` is null there and this filters to `rr.conference is null`.
 * At the Prologue, 28 Conference-scoped contests still share one `event_id`,
 * so filtering on `category` alone would silently fold North and South into
 * one field. See this module's header for what that leaves unresolved in
 * `v_race_result`'s own aggregates.
 */
async function loadCategoryRows(
  db: AnyDatabase,
  eventId: number,
  category: string,
  conference: string | null,
): Promise<RawCategoryRow[]> {
  const conferenceFilter =
    conference === null ? sql`rr.conference is null` : sql`rr.conference = ${conference}`;

  const result = await db.execute(sql`
    select rr.plate, rr.display_name, rr.scoring_team, rr.place, rr.status,
           rr.is_lapped, rr.pct_back, ident.rider_id
      from v_race_result rr
      left join (
        select event_id, plate, rider_id from v_rider_result
      ) ident on ident.event_id = rr.event_id and ident.plate = rr.plate
     where rr.event_id = ${eventId} and rr.category = ${category} and ${conferenceFilter}
     order by rr.display_name`);

  return rowsOf(result).map((row) => ({
    plate: str(row.plate),
    displayName: str(row.display_name),
    scoringTeam: str(row.scoring_team),
    place: str(row.place),
    status: row.status === 'dnf' ? 'dnf' : 'finished',
    isLapped: row.is_lapped === true,
    pctBack: numOrNull(row.pct_back),
    riderId: row.rider_id === null || row.rider_id === undefined ? null : num(row.rider_id),
  }));
}

/** The Squad's own riders, for flagging squad-mates in the field. */
async function loadSquadRiderIds(db: AnyDatabase, squadId: number): Promise<Set<number>> {
  const result = await db.execute(
    sql`select rider_id from squad_member where squad_id = ${squadId}`,
  );
  return new Set(rowsOf(result).map((row) => num(row.rider_id)));
}

/**
 * The crossing: a Rider's own Category field at a Round, with squad-mates
 * flagged for the caller's own Squad.
 *
 * Null when the Rider has no result at this Round — there is no Category to
 * open for a non-start, and the wall cell that would have offered this
 * crossing is a different lane's did-not-start mark, not this one.
 */
export async function loadCategoryField(
  db: AnyDatabase,
  riderId: number,
  roundId: number,
  squadId: number,
): Promise<CategoryField | null> {
  const round = await resolveRound(db, roundId);
  if (!round) return null;

  const anchor = await resolveRiderCategory(db, riderId, round.seasonId, round.roundOrdinal);
  if (!anchor) return null;

  const [rawRows, squadRiderIds] = await Promise.all([
    loadCategoryRows(db, anchor.eventId, anchor.category, anchor.conference),
    loadSquadRiderIds(db, squadId),
  ]);

  // Field size as the count of the Conference-scoped rows just read, not
  // `v_race_result`'s own `field_size` column — that column is keyed on
  // `(event_id, category)` alone, which is right at a single-Conference Event
  // and wrong at a combined one where this read already applies the
  // Conference filter `field_size` does not. ADR-0001 lists field size as
  // description we are allowed to compute; this is that computation, done
  // once, over exactly the rows returned below.
  const fieldSize = rawRows.length;
  const rows: CategoryFieldRow[] = rawRows.map((row) => ({
    ...row,
    isSquadMate: row.riderId !== null && squadRiderIds.has(row.riderId),
  }));

  return buildCategoryField(anchor.categoryRaw, anchor.conference, fieldSize, rows);
}
