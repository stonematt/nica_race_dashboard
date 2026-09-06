/**
 * The `[season]/round/[ordinal]` segment's own read: which Round a URL names,
 * and which Events it was published as.
 *
 * A Round is not an Event (`CONTEXT.md`, Round): the league publishes one
 * Event per Conference, or a single Event when the whole league rides
 * together (the Prologue, State Champs). This module resolves only that
 * shape — the field itself is `loadRaceDetail`'s job
 * (`src/app/races/[eventId]/query.ts`), called once per Event the page
 * decides to render rather than re-queried here.
 *
 * Imports here are relative, not `@/`-aliased, for the same reason as the
 * sibling query modules this one sits beside: it is loaded directly by a
 * test, and the `@/` alias is a tsconfig path Next resolves that vitest does
 * not.
 */

import { sql } from 'drizzle-orm';
import type { Database } from '../../../../lib/db/index.ts';

/**
 * Any database this module can read: the app's, or a test's in-memory one.
 */
export type AnyDatabase = Pick<Database, 'execute'>;

export type RoundRef = { id: number; seasonId: number; ordinal: number; name: string };

export type RoundEvent = {
  sourceEventId: string;
  name: string;
  /** North | South, or null for a combined Event (Prologue, State Champs). */
  conference: string | null;
};

type Row = Record<string, unknown>;
const rowsOf = (result: { rows: unknown[] }): Row[] => result.rows as Row[];
const str = (v: unknown): string => String(v ?? '');
const num = (v: unknown): number => Number(v);
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

/**
 * The Round a `[season]/round/[ordinal]` URL segment names, or null when it
 * does not name one. A segment that is not a bare non-negative integer, or
 * one that is but matches no Round in this Season, are both "not one" — the
 * page's cue to render a real not-found rather than crash on a bad lookup.
 * Mirrors `resolveSeasonByYear`'s shape in `[season]/query.ts`.
 */
export async function resolveRound(
  db: AnyDatabase,
  seasonId: number,
  ordinalSegment: string,
): Promise<RoundRef | null> {
  if (!/^\d+$/.test(ordinalSegment)) return null;

  const result = await db.execute(sql`
    select id, season_id, ordinal, name from round
     where season_id = ${seasonId} and ordinal = ${Number(ordinalSegment)}
     limit 1`);
  const row = rowsOf(result)[0];
  return row
    ? {
        id: num(row.id),
        seasonId: num(row.season_id),
        ordinal: num(row.ordinal),
        name: str(row.name),
      }
    : null;
}

/**
 * The Events this Round was published as, ordered by the source's own event
 * id so the page renders in a stable order run to run. One row is the common
 * case; more than one means the Conferences raced separately and the page has
 * to say so rather than concatenate their fields into one.
 */
export async function listRoundEvents(db: AnyDatabase, roundId: number): Promise<RoundEvent[]> {
  const result = await db.execute(sql`
    select source_event_id, name, conference from event
     where round_id = ${roundId}
     order by source_event_id`);

  return rowsOf(result).map((row) => ({
    sourceEventId: str(row.source_event_id),
    name: str(row.name),
    conference: strOrNull(row.conference),
  }));
}
