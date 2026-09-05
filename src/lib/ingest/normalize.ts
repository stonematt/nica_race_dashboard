/**
 * Decode archived payloads into the source-mirroring tables.
 *
 * Reads `raw_fetch` and nothing else. There is no network call anywhere on this
 * path, and there must never be one: the payloads are archived precisely so
 * that recovery from a decode bug is fix-the-code-and-re-normalize, and so that
 * a volunteer-run nonprofit's timing vendor is never asked twice for the same
 * answer.
 *
 * **Whole-event halt, across families.** Every list of an event is placed and
 * decoded *before* anything is written, and the writes go in one transaction.
 * If any list of an event fails, nothing from that event is written — not a
 * row, not a null, and not a calendar entry pointing at a race day with no
 * results.
 *
 * **Idempotent.** Every write is an upsert on the natural key, so a second
 * normalize over unchanged payloads changes no rows.
 *
 * A failing event stops the run rather than being skipped past. Continuing
 * would produce a database quietly missing a race day, which is the outcome
 * strict fatality exists to prevent; events already written stay written, and
 * re-running after the fix is a no-op for them.
 */

import { eq } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '../db/schema.ts';
import { readCatalog, type EventCatalog } from './catalog.ts';
import { readEventIdentity, upsertEvent, type EventIdentity } from './calendar.ts';
import { decodeIndividualFlat, type IndividualRow } from './decode.ts';
import {
  decodeSeasonIndividual,
  decodeSeasonTeam,
  isDegenerateTeamSeason,
  type SeasonIndividualRow,
  type SeasonTeamRow,
} from './decode-season.ts';
import {
  decodeByTeam,
  decodeTeamCounter,
  decodeTeamRace,
  type ByTeamRow,
  type TeamCounterRow,
  type TeamRaceRow,
} from './decode-team.ts';
import { IngestError } from './errors.ts';
import { assignFamily, INDIVIDUAL_FLAT, type Family, type LayoutVariant } from './families.ts';
import { latestPayloads, type ArchivedPayload } from './raw.ts';
import {
  checkExpressionsRecognized,
  countRows,
  dataDepth,
  readListLayout,
  type DecodedList,
  type ListPayload,
} from './rows.ts';

type Db = PgliteDatabase<typeof schema>;

/** An event that cannot be assembled from what the archive holds. */
export class NormalizeError extends IngestError {}

/** One list, placed into a family and — where it feeds a table — decoded. */
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
  /** True for the lists that actually fed a table at this event. */
  decoded: boolean;
  /** Why a list was recognized but not written. Null when it was written. */
  skippedBecause: string | null;
}

export interface NormalizeResult {
  events: number;
  /** Lists placed into a family, decoded or not. */
  lists: number;
  /** Lists that fed a table. */
  decodedLists: number;
  /** Recognized and not written — a duplicate, or not a season record. */
  skipped: number;
  /** Rows written, per table. */
  rows: Record<string, number>;
  placed: PlacedList[];
}

/**
 * Everything one event contributes, decoded and not yet written.
 *
 * At most one list per family per event — `soleListFor` makes that true — so
 * each slot holds one decode or none. The spine is the exception: an event
 * without it has no results at all, so it is not optional.
 */
interface DecodedEvent {
  identity: EventIdentity;
  individual: DecodedList<IndividualRow>;
  byTeam?: DecodedList<ByTeamRow>;
  teamRace?: DecodedList<TeamRaceRow>;
  teamCounter?: DecodedList<TeamCounterRow>;
  seasonIndividual?: DecodedList<SeasonIndividualRow>;
  seasonTeam?: DecodedList<SeasonTeamRow>;
}

function listPayloadOf(where: string, payload: unknown): ListPayload {
  if (payload === null || typeof payload !== 'object') {
    throw new NormalizeError(`${where}: archived payload is not an object.`);
  }
  return payload as ListPayload;
}

const whereOf = (eventId: string, list: { listId: string | null; listName: string }) =>
  `event ${eventId} list ${list.listId} (${list.listName})`;

/** Place every list of one event into its family. */
function placeLists(
  season: number,
  eventId: string,
  catalog: EventCatalog,
  lists: readonly ArchivedPayload[],
): PlacedList[] {
  return lists.map((row) => {
    const where = whereOf(eventId, row);
    const payload = listPayloadOf(where, row.payload);
    const layout = readListLayout(where, payload);
    const { family, variant } = assignFamily(where, layout, dataDepth(payload.data));

    // Strict unknown-expression fatality covers every list of every family,
    // not only the ones that end up feeding a table. A list dropped by a
    // tie-break, or skipped because it is a snapshot rather than a record,
    // still gets its columns classified — otherwise the corpus is only partly
    // classified and the next layout change hides behind whichever list
    // happened not to be written.
    checkExpressionsRecognized(where, layout, family);

    return {
      season,
      eventId,
      listId: row.listId!,
      listName: row.listName,
      family,
      variant,
      expressions: layout.dataFields,
      rowCount: countRows(payload.data),
      hidden: catalog.lists.find((list) => list.id === row.listId)?.mode === 'hidden',
      decoded: false,
      skippedBecause: null,
    };
  });
}

/**
 * The one list of an event that feeds a single-list family.
 *
 * Two lists can land in the same family in one event: the config advertises the
 * prologue time-trial list at all eight 2025 events, so Race 2 North and State
 * Champs each carry a mass-start list *and* a time-trial re-render of the same
 * field, both flat individual results.
 *
 * The tie-break is `Mode`, and only as a tie-break. At those events the
 * time-trial copy is `hidden` — taken off the published results page — while at
 * Race 1, where the prologue *is* the race, it is the visible one. That is the
 * league saying which list it published, and it is not the list's name. If
 * dropping the hidden ones does not leave exactly one, that is fatal.
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

/**
 * Whether a season list is the league's record, and why not when it is not.
 *
 * Two conditions, and both are needed. **Shape** says whether the layout is a
 * final standing rather than a season-to-date snapshot or, at Race 1, the
 * prologue's own result list wearing the same name. **The event's conference**
 * says whether there is a key to write it under: both season tables are keyed
 * on conference, and the two combined events — the prologue and State Champs —
 * carry both conferences and so have none.
 *
 * The second condition is not redundant. State Champs publishes the team season
 * list in exactly the final layout, so shape alone cannot tell them apart, and
 * without it that copy's `SEASON = 0` rows would overwrite the real record.
 */
function seasonRecordRefusal(list: PlacedList, identity: EventIdentity): string | null {
  if (!list.variant.record) return `${list.variant.name} is not a season record layout`;
  if (identity.conference === null) {
    return 'a season standing is keyed on conference, and this event carries both';
  }
  return null;
}

/**
 * Decode every list of one event. Nothing is written from here.
 *
 * Every family is reduced to at most one list per event before anything is
 * decoded, and the dispatch below is exhaustive: a target with no arm is a
 * refusal, not a fallthrough. A seventh family arriving without a decoder must
 * halt the event rather than be decoded as whatever the last arm happened to be.
 */
function decodeEvent(
  eventId: string,
  identity: EventIdentity,
  placed: PlacedList[],
  rows: readonly ArchivedPayload[],
): DecodedEvent {
  const payloadFor = (list: PlacedList) => {
    const row = rows.find((candidate) => candidate.listId === list.listId)!;
    return listPayloadOf(whereOf(eventId, row), row.payload);
  };

  // One list per family, per event. The spine is not the only family this has
  // to hold for: two By-Team lists at one event would upsert over each other on
  // the same primary key and lose a published result silently.
  const byFamily = new Map<Family, PlacedList[]>();
  for (const list of placed) {
    byFamily.set(list.family, [...(byFamily.get(list.family) ?? []), list]);
  }

  const spine = byFamily.get(INDIVIDUAL_FLAT);
  if (spine === undefined) {
    throw new NormalizeError(
      `event ${eventId}: no flat individual list. It is the spine — every rider on every ` +
        'team — and an event without one has no results to decode.',
    );
  }

  const chosenOf = new Map<Family, PlacedList>();
  for (const [family, candidates] of byFamily) {
    const chosen = soleListFor(eventId, family, candidates);
    chosenOf.set(family, chosen);
    for (const list of candidates) {
      if (list !== chosen) list.skippedBecause = 'another list of this family is the published one';
    }
  }

  const decoded: DecodedEvent = {
    identity,
    individual: decodeSpine(eventId, chosenOf.get(INDIVIDUAL_FLAT)!, payloadFor),
  };

  for (const [family, list] of chosenOf) {
    if (family === INDIVIDUAL_FLAT) continue;

    switch (family.target) {
      case 'individual_result_by_team':
        decoded.byTeam = decodeAs(list, decodeByTeam, eventId, payloadFor);
        break;
      case 'team_race_result':
        decoded.teamRace = decodeAs(list, decodeTeamRace, eventId, payloadFor);
        break;
      case 'team_race_counter':
        decoded.teamCounter = decodeAs(list, decodeTeamCounter, eventId, payloadFor);
        break;
      case 'season_individual_standing': {
        const refusal = seasonRecordRefusal(list, identity);
        if (refusal !== null) {
          list.skippedBecause = refusal;
          break;
        }
        const where = whereOf(eventId, list);
        decoded.seasonIndividual = decodeSeasonIndividual(
          where,
          list.variant,
          payloadFor(list),
          identity.conference,
        );
        list.decoded = true;
        break;
      }
      case 'season_team_standing': {
        const refusal = seasonRecordRefusal(list, identity);
        if (refusal !== null) {
          list.skippedBecause = refusal;
          break;
        }
        const where = whereOf(eventId, list);
        const season = decodeSeasonTeam(where, list.variant, payloadFor(list), identity.conference);
        // Belt and braces on the degenerate copy. It should already have been
        // refused for carrying no conference, so reaching here means the shape
        // rules drifted — refuse rather than overwrite the record with zeros.
        if (isDegenerateTeamSeason(season.rows)) {
          throw new NormalizeError(
            `${where}: every row totals 0 for the season. That is the State Champs copy, ` +
              'which supersedes nothing and must never be written as the season record.',
          );
        }
        decoded.seasonTeam = season;
        list.decoded = true;
        break;
      }
      case 'individual_result':
        throw new NormalizeError(
          `${whereOf(eventId, list)}: a second family targets individual_result. ` +
            'The spine is one list per event.',
        );
      default:
        throw new NormalizeError(
          `${whereOf(eventId, list)}: family ${family.name} targets ${family.target}, ` +
            'which has no decoder. An unhandled target must halt the event, never fall through.',
        );
    }
  }

  return decoded;
}

/** The spine, decoded and marked. Separate because it is not optional. */
function decodeSpine(
  eventId: string,
  list: PlacedList,
  payloadFor: (list: PlacedList) => ListPayload,
): DecodedList<IndividualRow> {
  const decoded = decodeIndividualFlat(whereOf(eventId, list), list.variant, payloadFor(list));
  list.decoded = true;
  return decoded;
}

/**
 * Run one decoder and mark the list decoded.
 *
 * The mark is a statement about the list and is made here rather than inside an
 * argument, so that reading the call does not hide a state change.
 */
function decodeAs<Row>(
  list: PlacedList,
  decoder: (where: string, variant: LayoutVariant, payload: ListPayload) => DecodedList<Row>,
  eventId: string,
  payloadFor: (list: PlacedList) => ListPayload,
): DecodedList<Row> {
  const decoded = decoder(whereOf(eventId, list), list.variant, payloadFor(list));
  list.decoded = true;
  return decoded;
}

/**
 * Write one decoded event, in one transaction.
 *
 * Every table takes the same shape of write — upsert on the natural key, so a
 * second normalize over unchanged payloads changes nothing — so it is spelled
 * once and applied six times rather than retyped per table.
 */
async function writeEvent(db: Db, decoded: DecodedEvent): Promise<Record<string, number>> {
  const written: Record<string, number> = {};

  await db.transaction(async (tx) => {
    const eventPk = await upsertEvent(tx, decoded.identity);
    const [season] = await tx
      .select()
      .from(schema.season)
      .where(eq(schema.season.year, decoded.identity.seasonYear));

    /** Upsert every row of one list, and record how many. */
    const upsertAll = async <Row extends object>(
      name: string,
      table: PgTable,
      target: PgColumn[],
      rows: readonly Row[],
      extra: object = {},
    ) => {
      for (const row of rows) {
        const values = { ...extra, ...row };
        await tx.insert(table).values(values).onConflictDoUpdate({ target, set: values });
      }
      written[name] = (written[name] ?? 0) + rows.length;
    };

    const forEvent = { eventId: eventPk };
    const forSeason = {
      seasonId: season!.id,
      sourceEventId: decoded.identity.sourceEventId,
    };

    await upsertAll(
      'individual_result',
      schema.individualResult,
      [schema.individualResult.eventId, schema.individualResult.plate],
      decoded.individual.rows,
      forEvent,
    );

    if (decoded.byTeam) {
      await upsertAll(
        'individual_result_by_team',
        schema.individualResultByTeam,
        [schema.individualResultByTeam.eventId, schema.individualResultByTeam.plate],
        decoded.byTeam.rows,
        forEvent,
      );
    }

    if (decoded.teamRace) {
      await upsertAll(
        'team_race_result',
        schema.teamRaceResult,
        [schema.teamRaceResult.eventId, schema.teamRaceResult.scoringTeam],
        decoded.teamRace.rows,
        forEvent,
      );
    }

    if (decoded.teamCounter) {
      await upsertAll(
        'team_race_counter',
        schema.teamRaceCounter,
        [schema.teamRaceCounter.eventId, schema.teamRaceCounter.plate],
        decoded.teamCounter.rows,
        forEvent,
      );
    }

    if (decoded.seasonIndividual) {
      let points = 0;
      for (const { racePoints, ...standing } of decoded.seasonIndividual.rows) {
        const values = { ...forSeason, ...standing };
        const [stored] = await tx
          .insert(schema.seasonIndividualStanding)
          .values(values)
          .onConflictDoUpdate({
            target: [
              schema.seasonIndividualStanding.seasonId,
              schema.seasonIndividualStanding.conference,
              schema.seasonIndividualStanding.plate,
            ],
            set: values,
          })
          .returning({ id: schema.seasonIndividualStanding.id });

        // Replaced rather than upserted. The block narrows across the season —
        // RACE1..RACE10 in a snapshot, RACE1..RACE4 at the end — so upserting
        // alone would leave rounds behind that the corrected payload no longer
        // publishes. This is the normalized layer, not the raw archive; only
        // `raw_fetch` is append-only.
        await tx
          .delete(schema.seasonIndividualRacePoints)
          .where(eq(schema.seasonIndividualRacePoints.standingId, stored!.id));
        if (racePoints.length > 0) {
          await tx
            .insert(schema.seasonIndividualRacePoints)
            .values(racePoints.map((race) => ({ standingId: stored!.id, ...race })));
        }
        points += racePoints.length;
      }
      written.season_individual_standing = decoded.seasonIndividual.rows.length;
      written.season_individual_race_points = points;
    }

    if (decoded.seasonTeam) {
      await upsertAll(
        'season_team_standing',
        schema.seasonTeamStanding,
        [
          schema.seasonTeamStanding.seasonId,
          schema.seasonTeamStanding.conference,
          schema.seasonTeamStanding.scoringTeam,
        ],
        decoded.seasonTeam.rows,
        forSeason,
      );
    }
  });

  return written;
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
    rows: {},
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
    const identity = readEventIdentity(configRow.season, eventId, catalog.eventName);
    const placed = placeLists(
      configRow.season,
      eventId,
      catalog,
      rows.filter((row) => row.listId !== null),
    );

    const written = await writeEvent(db, decodeEvent(eventId, identity, placed, rows));

    for (const [table, n] of Object.entries(written)) {
      result.rows[table] = (result.rows[table] ?? 0) + n;
    }
    result.events += 1;
    result.lists += placed.length;
    result.decodedLists += placed.filter((list) => list.decoded).length;
    result.skipped += placed.filter((list) => !list.decoded).length;
    result.placed.push(...placed);
  }

  return result;
}
