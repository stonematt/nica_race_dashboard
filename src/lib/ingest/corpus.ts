/**
 * Archive the fixture corpus into the raw layer, offline.
 *
 * The whole 2025 Oregon League season plus the 2026 opener is already on disk
 * at `fixtures/` (docs/fixtures.md). This module walks it and appends every
 * payload to `raw_fetch` exactly as `bin/fetch.ts` would have, so the raw layer
 * becomes real — and every decode slice downstream becomes testable — **without
 * a single request to a volunteer-run nonprofit's timing vendor.** The crawl
 * that produced the corpus was deliberately slow out of respect for that
 * vendor; do not re-fetch what is already here.
 *
 * Two properties are worth stating outright.
 *
 *   - **Configs are archived too, not just result lists.** A config carries the
 *     `list_id` for every list, and the `Fields`/`DataFields` layout is only
 *     interpretable against the config that shipped with it. A config you
 *     cannot replay is a normalize you cannot reproduce.
 *
 *   - **A row's URL and status are reconstructed, not recorded.** The corpus
 *     files are response bodies with no envelope, so `url` is rebuilt from the
 *     archived config and `httpStatus` is asserted as 200. The URL is
 *     provenance — it says which request produced the row — and a list URL
 *     embeds the config's short-lived `key`, so it is not a request anyone can
 *     repeat. Nothing downstream may treat either as observed.
 *
 *   - **A list's identity comes from the config, not from its filename.** The
 *     fixture filenames are a slug someone chose during the crawl; the payload
 *     carries `list.ListName`, and the config turns that into the stable hex
 *     ID. Nothing here reads meaning out of a filename beyond which event it
 *     belongs to and whether it is a config.
 *
 * The split between the three exported layers is deliberate: `groupCorpusFiles`
 * and `buildEventRecords` are pure, so what a row *is* can be tested without
 * reading minors' race results, and only `discoverCorpus`/`readEventRecords`
 * touch the disk.
 */

import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as schema from '../db/schema.ts';
import { CORPUS_SEASONS, requireCorpus } from '../fixtures.ts';
import { configUrl, listIdForName, listUrl, readCatalog } from './catalog.ts';
import { IngestError } from './errors.ts';
import { archive, CONFIG_LIST_NAME, type RawFetchRecord } from './raw.ts';

type Db = PgliteDatabase<typeof schema>;

/** A corpus file that is missing, malformed, or cannot be placed. */
export class CorpusError extends IngestError {}

/** One event's files, as they sit on disk. */
export interface CorpusEvent {
  season: number;
  eventId: string;
  /** Absolute path to `config-<eventId>.json`. */
  configPath: string;
  /** Absolute paths to `raw-<eventId>-*.json`, sorted. */
  listPaths: string[];
}

/** A list payload and where it was read from, for error messages. */
export interface LoadedPayload {
  path: string;
  payload: unknown;
}

export interface LoadCorpusResult {
  events: number;
  configs: number;
  lists: number;
  /** Total rows appended — `configs + lists`, stated so a caller can assert it. */
  rows: number;
}

const CONFIG_FILE = /^config-(\d+)\.json$/;
const LIST_FILE = /^raw-(\d+)-(.+)\.json$/;

/**
 * Group one season directory's filenames into events.
 *
 * The corpus also carries `*-summary.json` decode notes written during the
 * field inventory. They are analysis, not source responses, and drop out by not
 * matching either pattern rather than by being named in a denylist — a new
 * summary file should not need a code change to stay out.
 *
 * A list payload with no config beside it is fatal: without the config there is
 * no `list_id`, and `raw_fetch` is keyed on `list_id`.
 */
export function groupCorpusFiles(season: number, dir: string, fileNames: string[]): CorpusEvent[] {
  const configs = new Map<string, string>();
  const lists = new Map<string, string[]>();

  for (const name of [...fileNames].sort()) {
    const config = CONFIG_FILE.exec(name);
    if (config) {
      configs.set(config[1]!, join(dir, name));
      continue;
    }
    const list = LIST_FILE.exec(name);
    if (list) {
      const forEvent = lists.get(list[1]!) ?? [];
      forEvent.push(join(dir, name));
      lists.set(list[1]!, forEvent);
    }
  }

  for (const [eventId, listPaths] of lists) {
    if (!configs.has(eventId)) {
      throw new CorpusError(
        `${dir}: event ${eventId} has ${listPaths.length} list payload(s) but no config-${eventId}.json. ` +
          'A list cannot be archived without the config that gives it a list_id.',
      );
    }
  }

  return [...configs.keys()].sort().map((eventId) => ({
    season,
    eventId,
    configPath: configs.get(eventId)!,
    listPaths: lists.get(eventId) ?? [],
  }));
}

/** Group the whole corpus into events, season by season. */
export function discoverCorpus(root: string = requireCorpus()): CorpusEvent[] {
  return CORPUS_SEASONS.flatMap((seasonDir) => {
    const dir = join(root, seasonDir);
    return groupCorpusFiles(Number(seasonDir), dir, readdirSync(dir));
  });
}

/** The `list.ListName` a list payload declares itself under. */
function declaredListName(path: string, payload: unknown): string {
  const list = (payload as { list?: { ListName?: unknown } } | null)?.list;
  if (typeof list?.ListName !== 'string' || list.ListName === '') {
    throw new CorpusError(
      `${basename(path)}: no \`list.ListName\`, so this payload cannot be matched to a published list.`,
    );
  }
  return list.ListName;
}

/**
 * Every row one event contributes, config first.
 *
 * Config first is not cosmetic: it is the order a fetch happens in, because the
 * config is where the `key` and the list names come from.
 */
export function buildEventRecords(
  event: Pick<CorpusEvent, 'season' | 'eventId'>,
  configPayload: unknown,
  listPayloads: readonly LoadedPayload[],
): RawFetchRecord[] {
  const catalog = readCatalog(event.eventId, configPayload);

  const records: RawFetchRecord[] = [
    {
      season: event.season,
      eventId: event.eventId,
      // A config is not a list. Null here is what makes `list_id` mean
      // "which published list", and it is what a config fetch looks like.
      listId: null,
      listName: CONFIG_LIST_NAME,
      url: configUrl(event.eventId, catalog.shape),
      // The corpus records no status. 200 is the only honest value: a file
      // exists and parses, so the request that produced it succeeded. Nothing
      // downstream may read this as evidence of a status that was observed.
      httpStatus: 200,
      payload: configPayload,
    },
  ];

  for (const { path, payload } of listPayloads) {
    const listName = declaredListName(path, payload);
    records.push({
      season: event.season,
      eventId: event.eventId,
      listId: listIdForName(catalog, listName),
      listName,
      url: listUrl(event.eventId, catalog.key, listName),
      httpStatus: 200,
      payload,
    });
  }

  return records;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new CorpusError(`${path}: not readable as JSON — ${(cause as Error).message}`);
  }
}

/** Read one event off disk and turn it into rows. */
export function readEventRecords(event: CorpusEvent): RawFetchRecord[] {
  return buildEventRecords(
    event,
    readJson(event.configPath),
    event.listPaths.map((path) => ({ path, payload: readJson(path) })),
  );
}

/**
 * Append the whole corpus to `raw_fetch`.
 *
 * Appends, so running it twice doubles the row count — by design. The second
 * pass writes rows carrying the same `content_hash` as the first, which is what
 * "we re-read the source and it had not changed" looks like.
 *
 * **The unit of failure is the event**, per the standing ingest decision: an
 * event either contributes every one of its payloads or none of them, because
 * `readEventRecords` throws before a single row is written and `archive` writes
 * the event in one statement. A failure partway through the corpus leaves the
 * earlier events archived, which is harmless precisely because the layer only
 * appends — re-running costs a duplicate row, never a wrong one.
 */
export async function loadCorpus(db: Db): Promise<LoadCorpusResult> {
  const events = discoverCorpus();

  let configs = 0;
  let lists = 0;
  for (const event of events) {
    const records = readEventRecords(event);
    await archive(db, records);
    for (const record of records) {
      if (record.listId === null) configs += 1;
      else lists += 1;
    }
  }

  return { events: events.length, configs, lists, rows: configs + lists };
}
