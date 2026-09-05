/**
 * Derive the committed shape corpus from the real fixture corpus.
 *
 * Run it from a checkout that has `fixtures/` on disk:
 *
 * ```
 * node src/lib/shape/strip.ts
 * ```
 *
 * No build step and no package script: `bin/*.ts` already run this way under
 * Node's native type stripping, `package.json` is not this lane's to edit, and
 * a regeneration that needs a script entry is a regeneration that needs
 * somebody's permission. `src/lib/shape/strip-runs.test.ts` is what keeps the
 * command working.
 *
 * It is re-runnable, and re-running it when the corpus grows is the point: a
 * new season is fetched into `fixtures/`, this rewrites `shape-corpus/`, and
 * the diff is the season's shape drift, reviewable in a pull request with no
 * rider in it.
 *
 * **It reads the real payloads and writes files that carry none of them.** Every
 * function below is subtractive — it names the handful of fields it keeps and
 * builds a new object out of them, rather than deleting from a copy of the
 * source. A field nobody thought about is therefore dropped by default, which
 * is the safe direction for a script whose input is minors' race results.
 *
 * Output is formatted with the repository's own Prettier settings, so a
 * regeneration leaves `pnpm format:check` green without a follow-up pass.
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { readCatalog, type SourceShape } from '../ingest/catalog.ts';
import { discoverCorpus, readEventRecords } from '../ingest/corpus.ts';
import { isRecord } from '../is-record.ts';
import {
  REDACTED_KEY,
  shapeConfigFileName,
  shapeCorpusRoot,
  shapeListFileName,
  ShapeCorpusError,
  type GroupTree,
  type ShapeCatalogEntry,
  type ShapeConfigFile,
  type ShapeField,
  type ShapeListFile,
  type ShapeOrder,
} from './corpus.ts';

/** Everything about a list that the payload itself does not say. */
export interface ListIdentity {
  season: number;
  eventId: string;
  listId: string;
  hidden: boolean;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

/**
 * A synthetic group label, ordinal prefix and all.
 *
 * The real labels are race categories, divisions and packed team strings. The
 * detection layer reads the nesting and the counts and never a label, so they
 * are replaced rather than published. The `#N_` prefix survives because
 * `stripGroupOrdinal()` exists to take it off, and a corpus that never carried
 * one would stop testing that.
 *
 * The counter runs per level, the way the source's own does.
 */
function labelFor(level: number, ordinal: number): string {
  return `#${ordinal}_group-${level}-${ordinal}`;
}

/** Turn `data` into a tree of row counts under synthetic labels. */
export function groupTreeOf(
  data: unknown,
  level = 1,
  counters = new Map<number, number>(),
): GroupTree {
  if (!isRecord(data)) {
    throw new ShapeCorpusError(
      `expected a group object at level ${level}, got ${Array.isArray(data) ? 'rows' : typeof data}. ` +
        'Every list in the corpus groups its rows at least once.',
    );
  }

  const tree: GroupTree = {};
  for (const child of Object.values(data)) {
    const ordinal = (counters.get(level) ?? 0) + 1;
    counters.set(level, ordinal);
    const label = labelFor(level, ordinal);
    tree[label] = Array.isArray(child) ? child.length : groupTreeOf(child, level + 1, counters);
  }
  return tree;
}

/**
 * A list the source publishes, or nothing where it publishes none.
 *
 * Absent is a shape the reader already handles — `readListLayout()` treats a
 * missing `Fields` as an empty display list. *Present but not a list* is not:
 * it means the source changed under us, and returning `[]` for it would commit
 * a file claiming the list displayed no columns. Refuse instead.
 */
function arrayOr(where: string, field: string, value: unknown): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ShapeCorpusError(
      `${where}: \`${field}\` is ${value === null ? 'null' : typeof value}, not a list. ` +
        'Stripping it to nothing would publish a shape the source never had.',
    );
  }
  return value;
}

/** Every displayed expression, in payload order. Labels and styling go. */
function fieldsOf(where: string, fields: unknown): ShapeField[] {
  return arrayOr(where, 'list.Fields', fields)
    .filter(isRecord)
    .map((field) => ({ Expression: stringOr(field.Expression, '') }));
}

/**
 * The sort/group orders, reduced to the expression and its grouping level.
 *
 * `Grouping` is what turns an order into a level of `data`, so the two together
 * are the source's own statement of the nesting this file records counts for.
 */
function ordersOf(where: string, orders: unknown): ShapeOrder[] {
  return arrayOr(where, 'list.Orders', orders)
    .filter(isRecord)
    .map((order) => ({
      Expression: stringOr(order.Expression, ''),
      Grouping: typeof order.Grouping === 'number' ? order.Grouping : 0,
    }));
}

/** One published list payload, reduced to shape. */
export function stripListPayload(identity: ListIdentity, payload: unknown): ShapeListFile {
  if (!isRecord(payload)) {
    throw new ShapeCorpusError(`event ${identity.eventId} list ${identity.listId}: not an object.`);
  }
  const where = `event ${identity.eventId} list ${identity.listId}`;
  const list = isRecord(payload.list) ? payload.list : {};
  const dataFields = payload.DataFields;
  if (!Array.isArray(dataFields) || !dataFields.every((field) => typeof field === 'string')) {
    throw new ShapeCorpusError(`${where}: DataFields is not an array of strings.`);
  }

  return {
    shape: {
      season: identity.season,
      eventId: identity.eventId,
      listId: identity.listId,
      hidden: identity.hidden,
      groups: groupTreeOf(payload.data),
    },
    list: {
      ListName: stringOr(list.ListName, ''),
      ListFooterText: stringOr(list.ListFooterText, ''),
      Fields: fieldsOf(where, list.Fields),
      Orders: ordersOf(where, list.Orders),
    },
    DataFields: [...dataFields],
    data: {},
  };
}

/**
 * The raw catalog array, read from where the shape says it is.
 *
 * `readCatalog()` has already found it and refused a config that has neither
 * key, so this walk cannot fail on a config the caller passed. It is still
 * written as a guarded read rather than a cast: the coupling is a comment
 * today, and a comment is not what should stand between a rewritten config and
 * a `TypeError` three frames down.
 */
function catalogArrayOf(eventId: string, payload: unknown, shape: SourceShape): unknown[] {
  const source = isRecord(payload) ? payload : {};
  const raw =
    shape === '2025'
      ? source.lists
      : isRecord(source.Tab) && isRecord(source.Tab.Config)
        ? source.Tab.Config.Lists
        : undefined;

  if (!Array.isArray(raw)) {
    throw new ShapeCorpusError(
      `event ${eventId} config: no ${shape === '2025' ? '`lists`' : '`Tab.Config.Lists`'} array, ` +
        `though it reads as the ${shape} API shape.`,
    );
  }
  return raw;
}

/** The catalog entries a config advertises, duplicates and all. */
function catalogEntriesOf(raw: unknown[]): ShapeCatalogEntry[] {
  return raw.filter(isRecord).map((entry) => ({
    ID: stringOr(entry.ID, ''),
    Name: stringOr(entry.Name, ''),
    Mode: stringOr(entry.Mode, ''),
  }));
}

/**
 * One event config, reduced to the catalog and the event name.
 *
 * The catalog is emitted where the source published it — top-level `lists` for
 * 2025, `Tab.Config.Lists` for 2026 — because the trap this corpus proves is
 * closed is exactly that move, and `readCatalog()` detects it by structure. A
 * shape config normalized into one shape would test nothing.
 *
 * Entries are emitted **before** deduplication: event 357242 publishes the same
 * hex ID twice, once visible and once hidden, and that is a shape fact the
 * catalog reader has a rule for.
 */
export function stripConfigPayload(
  season: number,
  eventId: string,
  payload: unknown,
): ShapeConfigFile {
  // readCatalog is the authority on which API shape this is, and it refuses a
  // config that cannot be read at all — so a corpus file is never written from
  // a config the ingest layer would reject.
  const catalog = readCatalog(eventId, payload);
  const entries = catalogEntriesOf(catalogArrayOf(eventId, payload, catalog.shape));
  const base = {
    shape: { season, eventId, sourceShape: catalog.shape },
    // The real key is a short-lived request token. It says nothing about shape
    // and there is no reason for a public repository to carry one.
    key: REDACTED_KEY,
    eventname: catalog.eventName,
  };

  return catalog.shape === '2025'
    ? { ...base, lists: entries }
    : { ...base, Tab: { Config: { Lists: entries } } };
}

/** Everything one event contributes to the shape corpus. */
export interface StrippedEvent {
  season: number;
  eventId: string;
  config: ShapeConfigFile;
  lists: ShapeListFile[];
}

/**
 * Strip the whole real corpus.
 *
 * Reads `fixtures/` through `src/lib/ingest/corpus.ts`, so a list acquires its
 * `list_id` from the config exactly the way archiving does rather than from a
 * filename someone chose during the crawl.
 */
export function stripCorpus(): StrippedEvent[] {
  return discoverCorpus().map((event) => {
    const records = readEventRecords(event);
    const configRecord = records.find((record) => record.listId === null);
    if (configRecord === undefined) {
      throw new ShapeCorpusError(
        `event ${event.eventId}: no config among its ${records.length} archived payload(s). ` +
          'Without one a list has no list_id and the catalog cannot be read.',
      );
    }
    const catalog = readCatalog(event.eventId, configRecord.payload);

    return {
      season: event.season,
      eventId: event.eventId,
      config: stripConfigPayload(event.season, event.eventId, configRecord.payload),
      lists: records
        .filter((record) => record.listId !== null)
        .map((record) =>
          stripListPayload(
            {
              season: event.season,
              eventId: event.eventId,
              listId: record.listId!,
              hidden: catalog.lists.find((list) => list.id === record.listId)?.mode === 'hidden',
            },
            record.payload,
          ),
        ),
    };
  });
}

/** Serialize one file the way `pnpm format:check` expects to find it. */
async function render(path: string, value: unknown): Promise<string> {
  const options = await resolveConfig(path);
  return format(JSON.stringify(value, null, 2), { ...options, filepath: path, parser: 'json' });
}

/**
 * Write the shape corpus, replacing whatever was there.
 *
 * The whole root is cleared first so that a list — or a season — the source
 * stopped publishing disappears from the corpus instead of lingering as a file
 * nothing regenerates. The directories are made from the events being written
 * rather than from a declared season list, so a 2027 season needs no edit here.
 */
export async function writeShapeCorpus(
  events: readonly StrippedEvent[],
  root: string = shapeCorpusRoot(),
): Promise<string[]> {
  rmSync(root, { recursive: true, force: true });

  const written: string[] = [];
  for (const event of events) {
    const dir = join(root, String(event.season));
    mkdirSync(dir, { recursive: true });

    const configPath = join(dir, shapeConfigFileName(event.eventId));
    writeFileSync(configPath, await render(configPath, event.config));
    written.push(configPath);

    for (const list of event.lists) {
      const path = join(dir, shapeListFileName(event.eventId, list.shape.listId));
      writeFileSync(path, await render(path, list));
      written.push(path);
    }
  }
  return written;
}

async function main(): Promise<void> {
  const events = stripCorpus();
  const written = await writeShapeCorpus(events);
  const lists = events.reduce((total, event) => total + event.lists.length, 0);
  console.log(
    `shape corpus: ${written.length} file(s) — ${events.length} event(s), ${lists} list(s), 0 rows`,
  );
}

// Run only as a script, never on import from a test.
if (process.argv[1] !== undefined && process.argv[1].endsWith('strip.ts')) {
  await main();
}
