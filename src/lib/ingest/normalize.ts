/**
 * Decode archived payloads into the source-mirroring tables.
 *
 * Reads `raw_fetch` and nothing else. There is no network call anywhere on this
 * path, and there must never be one: the payloads are archived precisely so
 * that recovery from a decode bug is fix-the-code-and-re-normalize, and so that
 * a volunteer-run nonprofit's timing vendor is never asked twice for the same
 * answer.
 *
 * **Whole-event halt.** One transaction per event, rolled back on the first
 * failure. There is no partial ingest, no null-where-it-did-not-parse, and no
 * readiness flag: an event is either decoded completely or it is not in the
 * database at all. Re-running is free, because the upsert key is the natural
 * one and the archive is append-only.
 *
 * **Idempotent.** Every write is an upsert on `(event_id, plate)`, so a second
 * normalize over unchanged payloads changes no rows.
 *
 * The order of operations inside an event is deliberate: every list is decoded
 * *before* anything is written, so a failure on the last list of an event
 * cannot leave the first list's rows behind.
 *
 * A failing event stops the run rather than being skipped past. Continuing
 * would produce a database that is quietly missing a race day, which is the
 * outcome strict fatality exists to prevent; the events already written stay
 * written, and re-running after the fix is a no-op for them.
 */

import type { PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '../db/schema.ts';
import { readCatalog, type EventCatalog } from './catalog.ts';
import { readEventIdentity, upsertEvent } from './calendar.ts';
import { readColumnLayout, type DisplayField } from './columns.ts';
import { dataDepth, decodeIndividualFlat, type DecodedList, type ListPayload } from './decode.ts';
import { IngestError } from './errors.ts';
import { assignFamily, INDIVIDUAL_FLAT, type Family, type LayoutVariant } from './families.ts';
import { latestPayloads, type ArchivedPayload } from './raw.ts';

type Db = PgliteDatabase<typeof schema>;

/** An event that cannot be assembled from what the archive holds. */
export class NormalizeError extends IngestError {}

/** One list, placed and (where this ticket decodes it) decoded. */
export interface PlacedList {
  season: number;
  eventId: string;
  listId: string;
  listName: string;
  family: Family;
  variant: LayoutVariant;
  expressions: readonly string[];
  /** Rows the payload carries, counted without decoding them. */
  rowCount: number;
  /** True where the config marks the list hidden on the published page. */
  hidden: boolean;
  /**
   * True for the one list of each event that was actually decoded.
   *
   * Not the same as `family.decoded`, which says the family *has* a decoder.
   * An event can carry two lists of a decoded family — see `soleListFor` — and
   * only one of them feeds the table.
   */
  decoded: boolean;
}

export interface NormalizeResult {
  events: number;
  /** Lists placed into a family, decoded or not. */
  lists: number;
  /** Lists that fed a table. */
  decodedLists: number;
  /** Recognized and not decoded: another family's, or an unchosen duplicate. */
  skipped: number;
  individualRows: number;
  placed: PlacedList[];
}

/** Rows under a `data` object at any nesting depth, counted not decoded. */
export function countRows(data: unknown): number {
  if (Array.isArray(data)) return data.length;
  if (data === null || typeof data !== 'object') return 0;
  return Object.values(data as Record<string, unknown>).reduce<number>(
    (total, group) => total + countRows(group),
    0,
  );
}

function listPayloadOf(where: string, payload: unknown): ListPayload {
  if (payload === null || typeof payload !== 'object') {
    throw new NormalizeError(`${where}: archived payload is not an object.`);
  }
  return payload as ListPayload;
}

/** Place every list of one event into its family. */
function placeLists(
  season: number,
  eventId: string,
  catalog: EventCatalog,
  lists: readonly ArchivedPayload[],
): PlacedList[] {
  return lists.map((row) => {
    const where = `event ${eventId} list ${row.listId} (${row.listName})`;
    const payload = listPayloadOf(where, row.payload);

    const dataFields = payload.DataFields;
    if (!Array.isArray(dataFields) || !dataFields.every((f) => typeof f === 'string')) {
      throw new NormalizeError(`${where}: DataFields is not an array of strings.`);
    }
    const fields = Array.isArray(payload.list?.Fields)
      ? (payload.list.Fields as DisplayField[])
      : [];

    const layout = readColumnLayout(where, dataFields, fields);
    const { family, variant } = assignFamily(where, layout, dataDepth(payload.data));

    return {
      season,
      eventId,
      listId: row.listId!,
      listName: row.listName,
      family,
      variant,
      expressions: dataFields,
      rowCount: countRows(payload.data),
      hidden: catalog.lists.find((list) => list.id === row.listId)?.mode === 'hidden',
      decoded: false,
    };
  });
}

/**
 * The one list of an event that feeds a decoded family.
 *
 * Two lists can land in the same family in one event: the config advertises the
 * prologue time-trial list at all eight 2025 events, and at three of them it was
 * fetched — so 2025 Race 2 North and State Champs each publish a mass-start
 * list *and* a time-trial re-render of the same field, both of them flat
 * individual results.
 *
 * The tie-break is `Mode`, and only as a tie-break. At the events where both
 * exist the time-trial copy is `hidden` — taken off the published results page —
 * while at Race 1, where the prologue *is* the race, it is the visible one. That
 * is the league saying which list it published, and it is not the list's name.
 * If dropping the hidden ones does not leave exactly one, that is fatal.
 */
function soleListFor(
  eventId: string,
  family: Family,
  candidates: readonly PlacedList[],
): PlacedList {
  if (candidates.length === 1) return candidates[0]!;

  const visible = candidates.filter((list) => !list.hidden);
  if (visible.length === 1) return visible[0]!;

  throw new NormalizeError(
    `event ${eventId}: ${candidates.length} lists are ${family.name} ` +
      `(${candidates.map((l) => `${l.listId} ${l.variant.name}${l.hidden ? ' hidden' : ''}`).join(', ')}), ` +
      `and ${visible.length} of them are published. Exactly one must be.`,
  );
}

async function writeEvent(
  db: Db,
  season: number,
  eventId: string,
  catalog: EventCatalog,
  decoded: DecodedList,
): Promise<number> {
  const identity = readEventIdentity(season, eventId, catalog.eventName);

  return db.transaction(async (tx) => {
    const eventPk = await upsertEvent(tx, identity);

    for (const row of decoded.rows) {
      const values = { eventId: eventPk, ...row };
      await tx
        .insert(schema.individualResult)
        .values(values)
        .onConflictDoUpdate({
          target: [schema.individualResult.eventId, schema.individualResult.plate],
          set: values,
        });
    }

    return decoded.rows.length;
  });
}

/**
 * Decode everything the archive holds, event by event in id order.
 *
 * Throws on the first event that cannot be decoded, naming it. Events already
 * written stay written — they are complete, and re-normalizing them after the
 * fix changes nothing.
 */
export async function normalize(db: Db): Promise<NormalizeResult> {
  const archived = await latestPayloads(db);

  const byEvent = new Map<string, ArchivedPayload[]>();
  for (const row of archived) {
    const forEvent = byEvent.get(row.eventId) ?? [];
    forEvent.push(row);
    byEvent.set(row.eventId, forEvent);
  }

  const result: NormalizeResult = {
    events: 0,
    lists: 0,
    decodedLists: 0,
    skipped: 0,
    individualRows: 0,
    placed: [],
  };

  for (const [eventId, rows] of [...byEvent].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const configRow = rows.find((row) => row.listId === null);
    if (!configRow) {
      throw new NormalizeError(
        `event ${eventId}: no archived config. Without it a list has no identity and an ` +
          'event has no place in the season — see src/lib/ingest/corpus.ts.',
      );
    }

    const catalog = readCatalog(eventId, configRow.payload);
    const placed = placeLists(
      configRow.season,
      eventId,
      catalog,
      rows.filter((row) => row.listId !== null),
    );

    const spine = placed.filter((list) => list.family === INDIVIDUAL_FLAT);
    if (spine.length === 0) {
      throw new NormalizeError(
        `event ${eventId}: no flat individual list. It is the spine — every rider on every ` +
          'team — and an event without one has no results to decode.',
      );
    }

    const chosen = soleListFor(eventId, INDIVIDUAL_FLAT, spine);
    chosen.decoded = true;
    const chosenRow = rows.find((row) => row.listId === chosen.listId)!;
    const decoded = decodeIndividualFlat(
      `event ${eventId} list ${chosen.listId} (${chosen.listName})`,
      chosen.variant,
      listPayloadOf(`event ${eventId}`, chosenRow.payload),
    );

    result.individualRows += await writeEvent(db, configRow.season, eventId, catalog, decoded);
    result.events += 1;
    result.lists += placed.length;
    result.decodedLists += placed.filter((list) => list.decoded).length;
    result.skipped += placed.filter((list) => !list.decoded).length;
    result.placed.push(...placed);
  }

  return result;
}
