/**
 * The shape corpus: what every published list *looked like*, with nobody in it.
 *
 * Every fatal assertion ingest makes reads shape rather than rows — family
 * signature matching, alias collision, unknown-expression fatality, required
 * fields, the empty-catalog trap, repeat-group widths, the footer row count.
 * None of them reads a cell. So the layer they read carries no names, no
 * plates, no schools and no finish times, and it can live in a public
 * repository (issue #31) while the real corpus stays gitignored and local.
 *
 * This module is the reader. `src/lib/shape/strip.ts` is the writer.
 *
 * ## Why the file is not simply a payload with empty rows
 *
 * The obvious format — the real payload with its `data` groups emptied out — is
 * not committable, because `scripts/privacy-guard.ts` cannot pass it. Its
 * `rowsOf()` flattens exactly one level, so for a nested list (`data` grouped
 * three deep, which is four of the six families) the *group objects* count as
 * rows and the guard fails a correctly stripped file. Extending the guard is
 * outside this lane, so the format is chosen to fit the guard instead:
 *
 *   - `DataFields` and `data` stay at the top level, `data` as `{}`. That keeps
 *     the file RaceResult-shaped, so the guard's payload-rows rule stays armed
 *     over it: a stripper regression that starts writing rows into `data` fails
 *     `pnpm privacy:check` rather than publishing them.
 *   - The nesting lives in `shape.groups`, a tree whose leaves are integer row
 *     counts. A row cannot be spelled in that tree without becoming an array,
 *     and an array of cells is what the guard's name rules already look for.
 *
 * `hydrate()` turns a shape file back into a payload the ingest modules accept,
 * with fabricated cells. That happens in memory, in a test, and never on disk.
 *
 * ## What is kept, and what is dropped
 *
 * Kept verbatim: `DataFields`, every `Fields[].Expression`, every
 * `Orders[].Expression`/`Grouping`, `ListName`, `ListFooterText`, the config's
 * list catalog and `eventname`, the nesting depth and the row counts.
 *
 * Dropped: every row, every presentation setting, and the config's `key` — a
 * short-lived request token with nothing to say about shape.
 *
 * Replaced: group labels. The real ones carry race categories and packed team
 * strings ("1.///Portland Metro Composite///3834 Points"); nothing in the
 * detection layer reads a group label, only the depth and the counts, so they
 * are synthesized. The `#N_` ordinal prefix is kept because
 * `stripGroupOrdinal()` exists to remove it.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SourceShape } from '../ingest/catalog.ts';
import type { ListPayload } from '../ingest/rows.ts';
import { repoRoot } from '../fixtures.ts';

/** Where the committed shape corpus lives, relative to the repo root. */
export const SHAPE_CORPUS_DIRNAME = 'shape-corpus';

/** Seasons the shape corpus carries. Same span as the real corpus. */
export const SHAPE_SEASONS = ['2025', '2026'] as const;

/** A shape file that is missing, malformed, or carries something it must not. */
export class ShapeCorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShapeCorpusError';
  }
}

/**
 * The `data` nesting, with an integer row count where the rows were.
 *
 * A number is a leaf — the array of rows that sat there. An object is a level
 * of grouping.
 */
export type GroupTree = { [label: string]: number | GroupTree };

/** One displayed column. Only the expression matters; the label is chrome. */
export interface ShapeField {
  Expression: string;
}

/** One sort/group order. `Grouping` is what makes a level of `data`. */
export interface ShapeOrder {
  Expression: string;
  Grouping: number;
}

/** One published list, reduced to shape. The committed unit. */
export interface ShapeListFile {
  shape: {
    season: number;
    eventId: string;
    /** The config's stable hex list ID — the key `raw_fetch` uses. */
    listId: string;
    /** True where the config marks the list hidden on the published page. */
    hidden: boolean;
    /** The `data` nesting, rows replaced by their counts. */
    groups: GroupTree;
  };
  list: {
    ListName: string;
    ListFooterText: string;
    Fields: ShapeField[];
    Orders: ShapeOrder[];
  };
  DataFields: string[];
  /** Always `{}`. See the module note: this is what arms the privacy guard. */
  data: Record<string, never>;
}

/** One published list in a config's catalog. */
export interface ShapeCatalogEntry {
  ID: string;
  Name: string;
  Mode: string;
}

/**
 * One event's config, reduced to the catalog and the event name.
 *
 * Deliberately still shaped like the response it came from — `lists` for 2025,
 * `Tab.Config.Lists` for 2026 — because the shape trap this corpus exists to
 * prove is exactly that difference, and `readCatalog()` detects it by structure.
 */
export interface ShapeConfigFile {
  shape: {
    season: number;
    eventId: string;
    /** Which API shape the real config came from, as `readCatalog()` read it. */
    sourceShape: SourceShape;
  };
  /** A stand-in. The real one is a short-lived request token, never committed. */
  key: string;
  eventname: string;
  lists?: ShapeCatalogEntry[];
  Tab?: { Config: { Lists: ShapeCatalogEntry[] } };
}

/** One event: its config and every list published under it. */
export interface ShapeEvent {
  season: number;
  eventId: string;
  config: ShapeConfigFile;
  lists: ShapeListFile[];
}

/** The stand-in written where the config's request token was. */
export const REDACTED_KEY = '«KEY»';

/**
 * The cell every fabricated row is made of.
 *
 * A pseudonym, in the form the privacy guard already recognizes, so that a row
 * hydrated in memory is unmistakable if it ever reaches a file by accident.
 */
export const FABRICATED_CELL = '«CELL»';

/** Absolute path to the committed shape corpus. */
export function shapeCorpusRoot(): string {
  return join(repoRoot(), SHAPE_CORPUS_DIRNAME);
}

/** `list-<eventId>-<listId>.json` — named by identity, not by the crawl's slug. */
export function shapeListFileName(eventId: string, listId: string): string {
  return `list-${eventId}-${listId}.json`;
}

/** `config-<eventId>.json`, mirroring the real corpus. */
export function shapeConfigFileName(eventId: string): string {
  return `config-${eventId}.json`;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new ShapeCorpusError(`${path}: not readable as JSON — ${(cause as Error).message}`);
  }
}

/**
 * Refuse a group tree that is anything but labels and non-negative integers.
 *
 * This is the format invariant that makes the corpus safe by construction: a
 * row is an array of cells, and there is nowhere in a tree of integers to put
 * one. A stripper regression fails here rather than committing people.
 */
function checkGroupTree(where: string, node: unknown, path: string): void {
  if (typeof node === 'number') {
    if (!Number.isInteger(node) || node < 0) {
      throw new ShapeCorpusError(`${where}: group ${path} holds ${node}, not a row count.`);
    }
    return;
  }
  if (node === null || typeof node !== 'object' || Array.isArray(node)) {
    throw new ShapeCorpusError(
      `${where}: group ${path} is ${Array.isArray(node) ? 'an array' : typeof node}. ` +
        'A shape file carries counts and labels only — an array here would be rows.',
    );
  }
  for (const [label, child] of Object.entries(node as Record<string, unknown>)) {
    checkGroupTree(where, child, `${path}/${label}`);
  }
}

/** Read and validate one list shape file. */
export function readShapeListFile(path: string): ShapeListFile {
  const parsed = readJson(path) as ShapeListFile;

  if (typeof parsed?.shape?.listId !== 'string' || !Array.isArray(parsed.DataFields)) {
    throw new ShapeCorpusError(`${path}: not a list shape file.`);
  }
  if (Object.keys(parsed.data ?? {}).length > 0) {
    throw new ShapeCorpusError(
      `${path}: \`data\` is not empty. A committed shape file carries no rows; ` +
        'the nesting belongs in `shape.groups` as counts.',
    );
  }
  checkGroupTree(path, parsed.shape.groups, '');

  return parsed;
}

/** Read one config shape file. */
export function readShapeConfigFile(path: string): ShapeConfigFile {
  const parsed = readJson(path) as ShapeConfigFile;
  if (typeof parsed?.shape?.eventId !== 'string' || typeof parsed.eventname !== 'string') {
    throw new ShapeCorpusError(`${path}: not a config shape file.`);
  }
  return parsed;
}

/**
 * Every event in the committed shape corpus, in event-id order per season.
 *
 * Reads `shape-corpus/` and nothing else. It never touches `fixtures/`, which
 * is what lets the detection suite run in CI on a public repository and on a
 * fresh clone with no corpus on disk at all.
 */
export function readShapeCorpus(root: string = shapeCorpusRoot()): ShapeEvent[] {
  const events: ShapeEvent[] = [];

  for (const seasonDir of SHAPE_SEASONS) {
    const dir = join(root, seasonDir);
    if (!existsSync(dir)) {
      throw new ShapeCorpusError(
        `${dir} is missing. The shape corpus is committed; regenerate it with ` +
          '`node src/lib/shape/strip.ts` from a checkout that has fixtures/.',
      );
    }

    const names = readdirSync(dir).sort();
    const configs = names.filter((name) => name.startsWith('config-'));

    for (const configName of configs) {
      const config = readShapeConfigFile(join(dir, configName));
      const eventId = config.shape.eventId;
      const lists = names
        .filter((name) => name.startsWith(`list-${eventId}-`))
        .map((name) => readShapeListFile(join(dir, name)));

      events.push({ season: Number(seasonDir), eventId, config, lists });
    }
  }

  return events;
}

/** Build `data` back out of a group tree, with fabricated rows. */
function hydrateGroups(node: number | GroupTree, width: number): unknown {
  if (typeof node === 'number') {
    const row = Array.from({ length: width }, () => FABRICATED_CELL);
    return Array.from({ length: node }, () => [...row]);
  }
  return Object.fromEntries(
    Object.entries(node).map(([label, child]) => [label, hydrateGroups(child, width)]),
  );
}

/**
 * A shape file, back in the form the ingest modules read.
 *
 * The rows are fabricated and identical: every cell is `«CELL»`. Nothing in the
 * detection layer reads a cell — it resolves columns, matches signatures and
 * counts rows — so a fabricated row is a faithful stand-in for exactly the
 * assertions this corpus exists to check, and a dishonest one for anything that
 * reads a value. Nothing here may be handed to a decoder.
 */
export function hydrate(file: ShapeListFile): ListPayload {
  return {
    list: {
      ListName: file.list.ListName,
      ListFooterText: file.list.ListFooterText,
      Fields: file.list.Fields,
    },
    DataFields: file.DataFields,
    data: hydrateGroups(file.shape.groups, file.DataFields.length),
  };
}

/** Where a shape list came from, in the form ingest's error messages use. */
export function whereOf(file: ShapeListFile): string {
  return `event ${file.shape.eventId} list ${file.shape.listId} (${file.list.ListName})`;
}
