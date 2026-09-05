/**
 * `season -> round -> event`, read out of the archived config.
 *
 * A result row hangs off an `event`, an event off a `round`, and a round off a
 * `season`, so normalize has to build the calendar before it can write a row.
 * All three come from one string — the config's `eventname` — because that is
 * the only place the source states which race a payload belongs to.
 *
 * **Why a round exists at all**, when a result row only needs an `event`.
 * `event.round_id` is `NOT NULL` and references `round`, and `round.season_id`
 * references `season`, so the frozen schema requires all three before a single
 * result can be written. It is not an extra: it is the shape of the FK.
 *
 * A league race is not a RaceResult event. 2025
 * Race 2 is two events (`359477` South, `359478` North); the Prologue is one
 * event carrying both conferences as a category suffix; State Champs is one
 * event with no suffix. Meanwhile the season standings publish `RACE1..RACE4`,
 * and those ordinals are rounds, not event ids. The round is the join that lets
 * a rider's Race 3 season points sit beside their Race 3 lap times.
 *
 * Everything here is derived rather than configured, and an event name that
 * does not state its race number is fatal. Guessing an ordinal would silently
 * merge two race days.
 */

import { eq, and } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '../db/schema.ts';
import type { Conference } from './category.ts';
import { IngestError } from './errors.ts';

type Db = PgliteDatabase<typeof schema>;
/**
 * A database or a transaction on one. Derived from Drizzle's own callback
 * signature so the calendar can be built inside the event's transaction — which
 * is the whole point of whole-event halt — without a cast.
 */
export type Writer = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/** An event whose place in the calendar cannot be read. */
export class CalendarError extends IngestError {}

export interface EventIdentity {
  seasonYear: number;
  roundOrdinal: number;
  roundName: string;
  sourceEventId: string;
  /** North/South for a conference event, null where the event carries both. */
  conference: Conference | null;
  /** The config's `eventname`, verbatim. */
  name: string;
}

/**
 * Place an event in the calendar from its published name.
 *
 * Both 2025 (`Race 4 - ORLeague Newport Gnarnia - North`) and 2026
 * (`NICA Oregon - Race 1 - Old Oak Prologue`) state the race number the same
 * way, which is why this reads a number rather than a position.
 *
 * The round takes the bare name `Race N` rather than the event's own, because
 * two events share a round and their names differ only by conference — a round
 * named after one of them would be wrong for the other.
 */
export function readEventIdentity(
  seasonYear: number,
  sourceEventId: string,
  eventName: string,
): EventIdentity {
  const race = /\bRace\s+(\d+)\b/i.exec(eventName);
  if (!race) {
    throw new CalendarError(
      `event ${sourceEventId}: "${eventName}" does not state a race number, so it cannot be ` +
        'placed in the season. The season standings publish round ordinals, so an event with ' +
        'no round has nothing to join to.',
    );
  }

  const suffix = /-\s*(North|South)\s*$/.exec(eventName);

  return {
    seasonYear,
    roundOrdinal: Number(race[1]),
    roundName: `Race ${Number(race[1])}`,
    sourceEventId,
    conference: (suffix?.[1] ?? null) as Conference | null,
    name: eventName,
  };
}

/**
 * Ensure the season, round and event rows exist. Returns the event's id.
 *
 * Idempotent by construction: every level is keyed on something the source
 * publishes, so a second normalize finds what the first one wrote.
 */
export async function upsertEvent(db: Writer, identity: EventIdentity): Promise<number> {
  await db
    .insert(schema.season)
    .values({ year: identity.seasonYear })
    .onConflictDoNothing({ target: schema.season.year });
  const [season] = await db
    .select()
    .from(schema.season)
    .where(eq(schema.season.year, identity.seasonYear));
  if (!season) throw new CalendarError(`could not seed season ${identity.seasonYear}`);

  await db
    .insert(schema.round)
    .values({ seasonId: season.id, ordinal: identity.roundOrdinal, name: identity.roundName })
    .onConflictDoNothing({ target: [schema.round.seasonId, schema.round.ordinal] });
  const [round] = await db
    .select()
    .from(schema.round)
    .where(
      and(eq(schema.round.seasonId, season.id), eq(schema.round.ordinal, identity.roundOrdinal)),
    );
  if (!round) throw new CalendarError(`could not seed round ${identity.roundName}`);

  await db
    .insert(schema.event)
    .values({
      roundId: round.id,
      sourceEventId: identity.sourceEventId,
      conference: identity.conference,
      name: identity.name,
    })
    .onConflictDoUpdate({
      target: schema.event.sourceEventId,
      set: { roundId: round.id, conference: identity.conference, name: identity.name },
    });
  const [event] = await db
    .select()
    .from(schema.event)
    .where(eq(schema.event.sourceEventId, identity.sourceEventId));
  if (!event) throw new CalendarError(`could not seed event ${identity.sourceEventId}`);

  return event.id;
}
