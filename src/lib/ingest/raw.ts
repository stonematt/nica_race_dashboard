/**
 * The raw layer: append-only, never mutated.
 *
 * Every archived payload is one row in `raw_fetch`, stored verbatim. Nothing in
 * this module updates or deletes, and nothing downstream may either — that is
 * the whole correction mechanism. Two rows for the same `(event_id, list_id)`
 * with different `content_hash` values *is* a correction; a re-fetch that
 * changed nothing is still a row, because "we checked on Sunday at 21:00 and
 * nothing had moved" is a fact worth keeping. At ~560 KB a season, ten seasons
 * fit in under 6 MB.
 *
 * There is deliberately no dedupe, no `onConflict`, and no "skip if unchanged".
 * An archive that decides what is worth keeping is an archive you cannot
 * reconstruct a decode from.
 *
 * `src/lib/ingest/corpus.ts` archives the fixture corpus already on disk
 * through it. `bin/fetch.ts` will archive from the network through the same
 * door when it is written (issue #15); it is a stub today and calls nothing
 * here.
 */

import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { createHash } from 'node:crypto';
import * as schema from '../db/schema.ts';

type Db = PgliteDatabase<typeof schema>;

/** One payload, ready to append. `fetchedAt` and `contentHash` are added here. */
export interface RawFetchRecord {
  /** Calendar year. Raw does not depend on the `season` table. */
  season: number;
  /** RaceResult's event id as a string. */
  eventId: string;
  /** The config's stable hex list ID. **Null for a config fetch.** */
  listId: string | null;
  /** The published list name, or `CONFIG_LIST_NAME` for a config fetch. */
  listName: string;
  /**
   * Where this payload came from.
   *
   * Provenance, not a live handle. A list URL carries the config's short-lived
   * `key`, so it records *which request produced this row* rather than a
   * request you can repeat — and a corpus row's URL is reconstructed from the
   * archived config, because the corpus files do not carry the URL they were
   * fetched from.
   */
  url: string;
  /** As reported by the fetch. A corpus row asserts 200; see corpus.ts. */
  httpStatus: number;
  /** The response body, verbatim. */
  payload: unknown;
}

/**
 * What a config fetch records as its list name.
 *
 * `raw_fetch.list_name` is `NOT NULL` and a config is not a list, so it needs a
 * name that cannot collide with a published one. Every published name carries a
 * `|` separator, so this bare word is safe and stays greppable.
 */
export const CONFIG_LIST_NAME = 'config';

/**
 * A payload serialized so that two equal documents produce equal bytes.
 *
 * Object keys are sorted; array order is preserved, because array order is data
 * here (rows, fields, splits) while key order never is. The reason this is not
 * simply `JSON.stringify` is the round trip: `payload` is stored as `jsonb`,
 * and Postgres neither preserves key order nor keeps duplicate keys. A hash
 * taken over the raw bytes could therefore never be recomputed from the stored
 * row, which would make the correction check unverifiable after the fact.
 *
 * The trade is deliberate and narrow: a payload that differs only in whitespace
 * or key order hashes the same, and is not a correction. A payload that differs
 * in any *value* — one digit of one finish time — hashes differently.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
  return `{${entries.join(',')}}`;
}

/** sha256 of the canonical payload, lowercase hex. */
export function contentHash(payload: unknown): string {
  return createHash('sha256').update(canonicalJson(payload), 'utf8').digest('hex');
}

/**
 * Append payloads to the raw layer. Returns how many rows were written.
 *
 * Always an insert. Calling this twice with the same records writes both times,
 * and both rows carry the same `content_hash` — which is what "nothing changed"
 * looks like in an append-only archive.
 */
export async function archive(db: Db, records: readonly RawFetchRecord[]): Promise<number> {
  if (records.length === 0) return 0;

  const rows = records.map((record) => ({
    season: record.season,
    eventId: record.eventId,
    listId: record.listId,
    listName: record.listName,
    url: record.url,
    httpStatus: record.httpStatus,
    payload: record.payload,
    contentHash: contentHash(record.payload),
  }));

  await db.insert(schema.rawFetch).values(rows);
  return rows.length;
}
