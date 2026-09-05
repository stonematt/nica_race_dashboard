/**
 * The event config, read as one catalog across the source's two API shapes.
 *
 * Everything downstream keys on the config's stable hex list ID, so this module
 * is where an event's payloads acquire their identity. It reads a config
 * response and nothing else — no network, no filesystem, no database.
 *
 * **Two API shapes, one catalog.** 2025 publishes the list catalog as a
 * top-level `lists` array; 2026 moved it to `Tab.Config.Lists` and prefixed
 * every name with `Online|`. The dangerous half of that move is that it is
 * silent: a 2026 config read with 2025 assumptions finds no `lists` key,
 * yields `[]`, and archives nothing — a whole event quietly missing rather
 * than an error. So an empty catalog is fatal here, and the shape is detected
 * rather than assumed.
 *
 * **The list name is read, never constructed.** The same logical list is named
 * four ways across one 2025 season (`Individual Results - ALL`, `- North`,
 * `- South`, `Prologue/TT Results ALL`), the numeric prefix and the pipe are
 * part of the string, and it is the exact `listname` query parameter.
 *
 * **`Name` is not unique; `ID` is the key.** Event 357242 publishes the same
 * `Name` twice — once visible, once hidden — which is why `raw_fetch` is keyed
 * on the hex ID (see src/lib/db/schema.ts).
 */

import { IngestError } from './errors.ts';

/** Which API shape a config response came from. */
export type SourceShape = '2025' | '2026';

/** One published list, as the config advertises it. */
export interface SourceList {
  /** The config's stable hex ID — `F1A053`, `2A48B4`. The raw layer's key. */
  id: string;
  /** The exact `listname` query parameter, pipe and numeric prefix included. */
  name: string;
  /**
   * `''` or `'hidden'`. A hidden list is still published and still fetchable —
   * the prologue TT list is hidden at seven of the eight 2025 events — so this
   * is recorded, never used to decide whether to archive.
   */
  mode: string;
}

/** An event's config, reduced to the parts ingest depends on. */
export interface EventCatalog {
  /** RaceResult's event id, as a string — it is an opaque key, not a number. */
  eventId: string;
  shape: SourceShape;
  /** The short-lived token every list request needs. */
  key: string;
  /** Deduplicated by ID, in the order the config publishes them. */
  lists: SourceList[];
}

/** A config that cannot be read, or that reads as empty. Never recoverable. */
export class SourceCatalogError extends IngestError {}

const HOST = 'https://my.raceresult.com';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(source: Record<string, unknown>, field: string, where: string): string {
  const value = source[field];
  if (typeof value !== 'string') {
    throw new SourceCatalogError(
      `${where}: expected a string \`${field}\`, got ${value === undefined ? 'nothing' : typeof value}`,
    );
  }
  return value;
}

/**
 * Locate the list catalog, and say which shape it came from.
 *
 * Detection is by structure rather than by season, because the season is not
 * knowable from the payload and a URL is not evidence of what came back.
 */
function findLists(payload: Record<string, unknown>): { shape: SourceShape; raw: unknown[] } {
  if (Array.isArray(payload.lists)) return { shape: '2025', raw: payload.lists };

  const tab = payload.Tab;
  if (isRecord(tab) && isRecord(tab.Config) && Array.isArray(tab.Config.Lists)) {
    return { shape: '2026', raw: tab.Config.Lists };
  }

  throw new SourceCatalogError(
    'config carries neither a top-level `lists` array (2025) nor `Tab.Config.Lists` (2026). ' +
      'This is the shape trap: a 2026 config read with 2025 assumptions archives nothing at all.',
  );
}

/**
 * Read a config response into a catalog.
 *
 * Throws on anything it cannot make sense of. An event whose config is
 * unreadable has no list identities, so there is nothing partial worth keeping.
 */
export function readCatalog(eventId: string, payload: unknown): EventCatalog {
  const where = `event ${eventId} config`;
  if (!isRecord(payload)) {
    throw new SourceCatalogError(`${where}: expected a JSON object, got ${typeof payload}`);
  }

  const { shape, raw } = findLists(payload);

  if (raw.length === 0) {
    throw new SourceCatalogError(
      `${where}: the list catalog is empty. An event that publishes nothing is not a thing ` +
        'that happens; an empty catalog means the config was read with the wrong shape.',
    );
  }

  const byId = new Map<string, SourceList>();
  for (const [index, entry] of raw.entries()) {
    if (!isRecord(entry)) {
      throw new SourceCatalogError(`${where}: list ${index} is not an object`);
    }
    const list: SourceList = {
      id: stringField(entry, 'ID', `${where} list ${index}`),
      name: stringField(entry, 'Name', `${where} list ${index}`),
      mode: typeof entry.Mode === 'string' ? entry.Mode : '',
    };

    const seen = byId.get(list.id);
    if (seen === undefined) {
      byId.set(list.id, list);
      continue;
    }
    if (seen.name !== list.name) {
      throw new SourceCatalogError(
        `${where}: list ID ${list.id} is published under two names, ` +
          `"${seen.name}" and "${list.name}". The hex ID is the raw layer's key and must identify one list.`,
      );
    }
    // Event 357242 publishes 2A48B4 twice, once visible and once hidden. Same
    // list, same payload; keep the visible copy so the recorded provenance
    // matches what a reader of the published page would have fetched.
    if (seen.mode === 'hidden' && list.mode !== 'hidden') byId.set(list.id, list);
  }

  return {
    eventId,
    shape,
    key: stringField(payload, 'key', where),
    lists: [...byId.values()],
  };
}

/**
 * The hex ID for a published list name.
 *
 * A list payload carries its own `list.ListName` but not its ID, so this is the
 * join that gets an archived list onto the key `raw_fetch` uses. Zero matches
 * is fatal and so is more than one: both mean the name cannot identify a list,
 * and guessing would file a payload under the wrong identity.
 */
export function listIdForName(catalog: EventCatalog, listName: string): string {
  const matches = catalog.lists.filter((list) => list.name === listName);

  if (matches.length === 0) {
    throw new SourceCatalogError(
      `event ${catalog.eventId}: no published list is named "${listName}". ` +
        `The config advertises ${catalog.lists.length}: ${catalog.lists.map((l) => l.name).join(', ')}`,
    );
  }
  if (matches.length > 1) {
    throw new SourceCatalogError(
      `event ${catalog.eventId}: "${listName}" matches ${matches.length} published lists ` +
        `(${matches.map((l) => l.id).join(', ')}), so the name cannot identify one.`,
    );
  }
  return matches[0]!.id;
}

/**
 * Where an event's config is fetched from.
 *
 * The 2026 move is config-only. Note that config does *not* redirect: the 2025
 * path has to stay on `RRPublish/data/config` rather than being folded into the
 * newer one.
 *
 * The shape is a parameter because this records where an archived payload came
 * from, after the fact. A live fetch cannot use it that way — it has to pick a
 * path *before* it has a response to detect the shape from, which is issue #15's
 * problem and is why the empty-catalog check in `readCatalog` exists at all.
 */
export function configUrl(eventId: string, shape: SourceShape): string {
  const path = shape === '2026' ? 'results/config' : 'RRPublish/data/config';
  return `${HOST}/${eventId}/${path}?page=results&noVisitor=1`;
}

/**
 * Where a list is fetched from — the same endpoint in both shapes.
 *
 * `/results/list` rather than `/RRPublish/data/list`: the latter works but
 * 301-redirects here, costing an extra round trip against a volunteer-run
 * nonprofit's timing vendor. `contest` and `r` are optional and produce
 * byte-identical output, and are kept because they are what the published page
 * sends.
 */
export function listUrl(eventId: string, key: string, listName: string): string {
  const query = new URLSearchParams({ key, listname: listName, contest: '0', r: 'all' });
  return `${HOST}/${eventId}/results/list?${query}`;
}
