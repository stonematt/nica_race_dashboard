/**
 * Everything the `[season]` segment reads: which years exist, which one a URL
 * segment names, and which squad a coach lands on by default.
 *
 * Season is the ambient frame (CONTEXT.md), not a filter, so this module has
 * no notion of "the current page's data" — it only resolves the frame itself.
 * The wall content that will eventually render inside that frame belongs to a
 * different lane (`src/lib/roster-wall.ts`, `src/components/RosterWall.tsx`).
 *
 * Imports here are relative, not `@/`-aliased, for the same reason as
 * `src/app/races/[eventId]/query.ts`: this module is loaded directly by a
 * test, and the `@/` alias is a tsconfig path Next resolves but vitest does
 * not.
 */

import { cache } from 'react';
import { sql } from 'drizzle-orm';
import type { Database } from '../../lib/db/index.ts';

/**
 * Any database this module can read: the app's, or a test's in-memory one.
 * Narrowed to `execute` for the same reason `races/[eventId]/query.ts` is —
 * it keeps the test seam structural rather than importing `db/testing.ts`.
 */
export type AnyDatabase = Pick<Database, 'execute'>;

export type SeasonRef = { id: number; year: number };
export type SquadRef = { id: number; name: string };

type Row = Record<string, unknown>;
const rowsOf = (result: { rows: unknown[] }): Row[] => result.rows as Row[];
const str = (v: unknown): string => String(v ?? '');
const num = (v: unknown): number => Number(v);

/** Every season year on record, newest first — what the selector offers. */
export async function listSeasonYears(db: AnyDatabase): Promise<number[]> {
  const result = await db.execute(sql`select year from season order by year desc`);
  return rowsOf(result).map((row) => num(row.year));
}

/**
 * The season a `[season]` URL segment names, or null when it does not name
 * one. A segment that is not a bare non-negative integer, or one that is but
 * matches no season on record, are both "not one" — the caller's cue to
 * render a real not-found instead of crashing on a bad lookup.
 *
 * `cache()`-wrapped: `SeasonLayout` and the page beneath it both resolve the
 * same segment against the same `db` (a module-level singleton, `appDb()`),
 * so within one request the second call is deduped rather than re-querying.
 * Outside a request — this file's own tests included — `cache()` has no
 * dispatcher to key into and simply calls through, so behaviour there is
 * unchanged.
 */
export const resolveSeasonByYear = cache(
  async (db: AnyDatabase, segment: string): Promise<SeasonRef | null> => {
    if (!/^\d+$/.test(segment)) return null;

    const result = await db.execute(
      sql`select id, year from season where year = ${Number(segment)} limit 1`,
    );
    const row = rowsOf(result)[0];
    return row ? { id: num(row.id), year: num(row.year) } : null;
  },
);

/** The current season: the latest year on record. Null before anything is seeded. */
export async function resolveCurrentSeason(db: AnyDatabase): Promise<SeasonRef | null> {
  const result = await db.execute(sql`select id, year from season order by year desc limit 1`);
  const row = rowsOf(result)[0];
  return row ? { id: num(row.id), year: num(row.year) } : null;
}

/**
 * The squad a coach lands on by default, for a given season.
 *
 * Read off `squad_coach` (many-to-many). When a coach holds more than one
 * squad in the season, the pick is deterministic — lowest `squad.name`
 * collating — and deliberately arbitrary: there is no coach preference to
 * break the tie honestly yet, so "first alphabetically" is a placeholder,
 * not a judgement about which squad matters more.
 *
 * When the `squad_coach` lookup finds nothing and the season holds exactly one
 * Squad, that Squad is the answer. This mirrors `resolveClub` in
 * `races/[eventId]/query.ts`, which falls back to the only Club for the same
 * reason: the dev sign-in issues a session whose `user.id` is the typed email
 * rather than the `user` row's id, so nothing keyed on `coach.user_id` can
 * match under it. Without the fallback the home surface is dead in local
 * development even though the Squad and its 32 members are seeded — see the
 * identity mismatch tracked separately.
 *
 * Two or more Squads and no coach link is genuinely ambiguous, so it stays
 * null rather than guessing which squad is "the" one.
 */
export async function resolveDefaultSquad(
  db: AnyDatabase,
  userId: string | null,
  seasonId: number,
): Promise<SquadRef | null> {
  if (userId === null) return null;

  const result = await db.execute(sql`
    select s.id, s.name from squad s
      join squad_coach sc on sc.squad_id = s.id
     where sc.user_id = ${userId} and s.season_id = ${seasonId}
     order by s.name
     limit 1`);
  const row = rowsOf(result)[0];
  if (row) return { id: num(row.id), name: str(row.name) };

  // No coach link. `limit 2` so "exactly one" is a fact rather than an
  // assumption — the same shape `resolveClub` uses to test single-club-ness.
  const only = await db.execute(sql`
    select id, name from squad where season_id = ${seasonId} order by name limit 2`);
  const candidates = rowsOf(only);
  if (candidates.length !== 1) return null;
  return { id: num(candidates[0].id), name: str(candidates[0].name) };
}
