/**
 * Fetch one event from the live source into the append-only raw archive.
 *
 * This is the only module in the project that expects a response it has not
 * already seen, and it is deliberately the dumbest one. Per the #12 ruling
 * carried into issue #26:
 *
 *   - **It archives unconditionally.** Every 200 that comes back is a row in
 *     `raw_fetch` *before* anything is asserted about it, through
 *     `src/lib/ingest/raw.ts` — the same door `corpus.ts` uses, one insert per
 *     fetch, no dedupe, no update. A payload that looks wrong is the only
 *     artifact anyone can diagnose from a year later; refusing to store it
 *     destroys the evidence and buys nothing, because the source cannot be
 *     re-read politely on demand.
 *   - **It makes exactly one assertion: an empty catalog is a hard error.**
 *     Everything else — field layouts, list families, fidelity — belongs to
 *     normalize, which runs offline against the archived row and is re-runnable
 *     after a code fix without touching the vendor again.
 *
 * **What "unconditionally" does not cover: a non-200.** There is no row for a
 * request the source refused. `raw_fetch.payload` is `NOT NULL` and an error
 * page is not a payload, so archiving one would mean inventing a document to
 * store — which is worse than storing nothing, because normalize reads the
 * latest row per list and would decode the invention. A refusal is recorded as
 * a raised `SourceUnavailableError` and a run that stopped; everything that
 * arrived before it is on disk. The unconditional promise is about *content* —
 * a payload that looks wrong is still archived — not about failed requests.
 *
 * **Why the empty catalog and nothing else.** A 2026 config read with the 2025
 * `lists` key yields `[]` rather than a 404: it looks like an event that
 * published nothing, not like a failure. That one has to die here, because an
 * empty catalog means no list is ever fetched, nothing is archived, and there
 * is no row for anything downstream to notice. `readCatalog` in
 * `src/lib/ingest/catalog.ts` already detects the shape structurally and throws
 * on emptiness in both directions; this module calls it and does not
 * reimplement it. There is one shape detector in this codebase.
 *
 * **The path is chosen, not probed.** One config request per run, at the shape
 * the operator selected (`FETCH_CONFIG_SHAPE`, default 2026 — what a new event
 * is today). A wrong guess produces an archived payload and an error naming the
 * other shape, and the human re-runs. Falling back automatically was rejected
 * twice over: it doubles the requests against a volunteer-run nonprofit's
 * timing vendor, and it turns the ruling's one hard error back into a silent
 * recovery.
 *
 * **The year discriminator is on the row.** `url` records the config path that
 * actually answered — not a reconstruction, unlike a corpus row — and the
 * payload is stored verbatim, so its top-level `Tab` key says which catalog key
 * hit. `shapeOfArchivedConfig` reads both back off a single archived row, which
 * is the first thing anyone will want when the 2027 path moves. `raw_fetch`
 * gained no column for this: the two facts were already recorded, and the
 * schema is not worth widening for a value that is derivable and dated.
 *
 * Pure functions with env-based config (`readFetchConfig`), so the scheduling
 * option reopens by wiring alone if this repository ever stops being public.
 * **It must not reopen while it is public** — see `.github/workflows/ci.yml`.
 */

import type { PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from '../db/schema.ts';
import {
  configUrl,
  listUrl,
  readCatalog,
  SourceCatalogError,
  type SourceShape,
} from './catalog.ts';
import { IngestError } from './errors.ts';
import { isRecord } from '../is-record.ts';
import { archive, CONFIG_LIST_NAME, type RawFetchRecord } from './raw.ts';
import { REQUEST_SPACING_MS, USER_AGENT, type PoliteClient } from './transport.ts';

type Db = PgliteDatabase<typeof schema>;

/** A run that is misconfigured, or that would re-fetch what is already on disk. */
export class SourceFetchError extends IngestError {}

/** The two shapes, oldest first. */
export const SOURCE_SHAPES: readonly SourceShape[] = ['2025', '2026'];

/**
 * Where each shape publishes its list catalog.
 *
 * Stated here rather than exported from `catalog.ts` because it is provenance —
 * what to record about a fetch — and not part of reading one. `catalog.ts`
 * remains the only place that decides which key to *read*.
 */
export const CATALOG_KEY: Record<SourceShape, string> = {
  2025: 'lists',
  2026: 'Tab.Config.Lists',
};

/** Just enough of a `PoliteClient` to fetch with; a test passes a stub. */
export type SourceReader = Pick<PoliteClient, 'get'>;

export interface FetchEventRequest {
  /** Calendar year, stamped onto every row. Raw does not consult the calendar tables. */
  season: number;
  eventId: string;
  /** Which config path to ask. Not a guess about the payload — that is detected. */
  shape: SourceShape;
}

export interface FetchEventResult {
  eventId: string;
  season: number;
  /** The shape the *payload* turned out to be, which may not be the one asked. */
  shape: SourceShape;
  configPath: string;
  catalogKey: string;
  eventName: string;
  lists: number;
  /** Rows appended: the config plus one per list. */
  rows: number;
}

/**
 * The path a config URL asks for, with the event id taken back out:
 * `results/config`, `RRPublish/data/config`.
 */
function configPathOf(url: string, eventId: string): string {
  return new URL(url).pathname.replace(`/${eventId}/`, '');
}

/**
 * Where this shape's config lives, read off the URL `catalog.ts` builds rather
 * than restated here. One place knows the paths, and it is not this one.
 */
function configPathFor(eventId: string, shape: SourceShape): string {
  return configPathOf(configUrl(eventId, shape), eventId);
}

/**
 * Read the year discriminator back off one archived config row.
 *
 * Two independent facts, deliberately reported separately: which path was
 * asked (from `url`) and which shape answered (from the payload's top-level
 * `Tab`). They agree today. The day they stop agreeing is the day the source
 * moved again, and this is where that shows up.
 */
export function shapeOfArchivedConfig(row: { eventId: string; url: string; payload: unknown }): {
  configPath: string;
  requestedShape: SourceShape | undefined;
  payloadShape: SourceShape;
  catalogKey: string;
} {
  const configPath = configPathOf(row.url, row.eventId);
  const requestedShape = SOURCE_SHAPES.find(
    (shape) => configPathFor(row.eventId, shape) === configPath,
  );
  const payloadShape: SourceShape = isRecord(row.payload) && 'Tab' in row.payload ? '2026' : '2025';

  return {
    configPath,
    requestedShape,
    payloadShape,
    catalogKey: CATALOG_KEY[payloadShape],
  };
}

/** Append one payload. `raw.ts` is the only write door, and it is not forked. */
async function append(db: Db, record: RawFetchRecord): Promise<void> {
  await archive(db, [record]);
}

/**
 * Fetch an event's config and every list it publishes.
 *
 * Order is config first — it carries the `key` and the list names, so there is
 * nothing else to ask for until it lands — then the lists in the order the
 * config published them. Each payload is archived as it arrives rather than in
 * one batch at the end: if the source stops answering partway through, what
 * already arrived is on disk and the re-run costs the source only the
 * remainder. Raw appends, so a duplicate row is harmless and a lost one is not.
 */
export async function fetchEvent(
  db: Db,
  reader: SourceReader,
  request: FetchEventRequest,
): Promise<FetchEventResult> {
  const { season, eventId, shape } = request;
  const url = configUrl(eventId, shape);
  const configPath = configPathFor(eventId, shape);

  const config = await reader.get(url);

  await append(db, {
    season,
    eventId,
    // A config is not a list. Null here is what `normalize.ts` finds it by.
    listId: null,
    listName: CONFIG_LIST_NAME,
    url: config.url,
    httpStatus: config.status,
    payload: config.body,
  });

  const catalog = readCatalogOrExplain(eventId, config.body, shape, configPath);

  for (const list of catalog.lists) {
    // The name is read from the config and sent back verbatim — the numeric
    // prefix, the pipe and 2026's `Online|` are all part of the query parameter.
    const listRequest = listUrl(eventId, catalog.key, list.name);
    const response = await reader.get(listRequest);
    await append(db, {
      season,
      eventId,
      listId: list.id,
      listName: list.name,
      url: response.url,
      httpStatus: response.status,
      payload: response.body,
    });
  }

  return {
    eventId,
    season,
    shape: catalog.shape,
    configPath,
    catalogKey: CATALOG_KEY[catalog.shape],
    eventName: catalog.eventName,
    lists: catalog.lists.length,
    rows: catalog.lists.length + 1,
  };
}

/**
 * `readCatalog`, with the one thing the operator needs that it cannot know:
 * which path was asked, and what to ask instead.
 */
function readCatalogOrExplain(
  eventId: string,
  payload: unknown,
  shape: SourceShape,
  configPath: string,
) {
  try {
    return readCatalog(eventId, payload);
  } catch (cause) {
    if (!(cause instanceof SourceCatalogError)) throw cause;
    const other = shape === '2025' ? '2026' : '2025';
    throw new SourceCatalogError(
      `${(cause as Error).message}\n` +
        `Asked at ${configPath} (the ${shape} shape, catalog key \`${CATALOG_KEY[shape]}\`). ` +
        'The payload is archived under list_name `config` — read it there, and if the event ' +
        `publishes under the other shape, re-run with FETCH_CONFIG_SHAPE=${other}. ` +
        'No list was fetched, so nothing was archived for this event beyond the config.',
    );
  }
}

/** One run's configuration, read from the environment and validated. */
export interface FetchConfig {
  eventIds: string[];
  season: number;
  shape: SourceShape;
  spacingMs: number;
  userAgent: string;
  databaseUrl: string;
  allowRefetch: boolean;
}

function requiredList(env: Record<string, string | undefined>, name: string): string[] {
  const ids = (env[name] ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id !== '');
  if (ids.length === 0) {
    throw new SourceFetchError(
      `${name} is required and must name at least one event id. Fetch never crawls the source: ` +
        'it asks for exactly the events you name, so that a mistake costs one event and not a season.',
    );
  }
  return ids;
}

/**
 * Read a run out of the environment.
 *
 * Pure — it takes the environment rather than reading `process.env` — so every
 * refusal below is a test rather than a comment.
 */
export function readFetchConfig(env: Record<string, string | undefined>): FetchConfig {
  const eventIds = requiredList(env, 'FETCH_EVENT_IDS');

  const season = Number(env.FETCH_SEASON);
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    throw new SourceFetchError(
      `FETCH_SEASON must be a four-digit year; got ${env.FETCH_SEASON ?? 'nothing'}. ` +
        'Every archived row is stamped with it and raw does not consult the calendar tables, ' +
        'so it is stated rather than inferred.',
    );
  }

  const shape = (env.FETCH_CONFIG_SHAPE ?? '2026') as SourceShape;
  if (!SOURCE_SHAPES.includes(shape)) {
    throw new SourceFetchError(
      `FETCH_CONFIG_SHAPE must be 2025 or 2026; got ${env.FETCH_CONFIG_SHAPE}. ` +
        'Those are the two config paths the source has ever published.',
    );
  }

  const spacingMs =
    env.FETCH_SPACING_MS === undefined ? REQUEST_SPACING_MS : Number(env.FETCH_SPACING_MS);
  if (!Number.isFinite(spacingMs) || spacingMs < REQUEST_SPACING_MS) {
    throw new SourceFetchError(
      `FETCH_SPACING_MS must be at least ${REQUEST_SPACING_MS}; got ${env.FETCH_SPACING_MS}. ` +
        'The interval is a floor out of respect for a volunteer-run nonprofit, and widening it is ' +
        'the only direction this knob turns.',
    );
  }

  return {
    eventIds,
    season,
    shape,
    spacingMs,
    userAgent: env.FETCH_USER_AGENT ?? USER_AGENT,
    // The same default `bin/normalize.ts` uses, so the two halves of ingest
    // land in one database without either being told about it.
    databaseUrl: env.DATABASE_URL ?? './.pglite',
    allowRefetch: env.FETCH_ALLOW_REFETCH === '1',
  };
}

/**
 * Refuse to re-fetch an event the corpus already holds.
 *
 * The 2025 season and the 2026 opener were crawled once, deliberately slowly.
 * Asking for them again spends the vendor's bandwidth on bytes already sitting
 * in `fixtures/` — so the default is no, and the override exists because a
 * *correction* to a published result is a legitimate reason to ask again, and
 * an append-only archive is built to record exactly that.
 */
export function refuseCorpusRefetch(
  eventIds: readonly string[],
  corpusEventIds: readonly string[],
  allowRefetch: boolean,
): string[] {
  const already = eventIds.filter((id) => corpusEventIds.includes(id));
  if (already.length > 0 && !allowRefetch) {
    throw new SourceFetchError(
      `Event ${already.join(', ')} is already in the local corpus and will not be re-fetched. ` +
        'Archive it offline with `pnpm normalize --load-fixtures` (see docs/fixtures.md). ' +
        'If the source published a correction and you mean to ask again, set FETCH_ALLOW_REFETCH=1.',
    );
  }
  return [...eventIds];
}
