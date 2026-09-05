/**
 * The drift snapshot.
 *
 * Everything that can go wrong with this ingest is a change in *shape*: a
 * column that appeared, a column that vanished, a list that moved to a new
 * family, a row count that shifted. So the snapshot records shape and only
 * shape — per family, the expression set, which `list_id` resolved to which
 * family at which event, and how many rows each list carried.
 *
 * **It carries no rows, and it never can.** That is the property that lets it
 * be committed to a public repository and diffed in CI (issue #31) while the
 * fidelity suite stays local: expressions and category-free counts say nothing
 * about any rider. Nothing may be added here that could.
 *
 * The shape is an artifact other code reads, so it is versioned. Adding a field
 * is a minor change; renaming or removing one is a `version` bump, because a
 * snapshot diff that silently changes meaning is worse than no snapshot.
 */

import { FAMILIES } from './families.ts';
import type { PlacedList } from './normalize.ts';

export interface SnapshotList {
  season: number;
  eventId: string;
  /** The config's stable hex list ID — the key `raw_fetch` uses. */
  listId: string;
  listName: string;
  /** Which published layout of the family this list matched. */
  variant: string;
  /** True for the list that actually fed a table at this event. */
  decoded: boolean;
  /** True where the config marks the list hidden on the published page. */
  hidden: boolean;
  /** Why a recognized list was not written. Null when it was. */
  skippedBecause: string | null;
  /** `DataFields`, verbatim and in payload order. */
  expressions: readonly string[];
  rows: number;
}

export interface SnapshotFamily {
  name: string;
  /** The table this family's rows land in. */
  target: string;
  /** Every expression seen for this family anywhere in the archive, sorted. */
  expressions: string[];
  /** The resolved `list_id -> family` assignment, one entry per list. */
  lists: SnapshotList[];
}

export interface IngestSnapshot {
  version: 1;
  families: SnapshotFamily[];
}

/**
 * Build the snapshot from a normalize run.
 *
 * Deterministic: families in declaration order, lists sorted by event and then
 * list id, expressions sorted. A snapshot that reordered itself between runs
 * would make every diff unreadable and the CI check useless.
 */
export function buildSnapshot(placed: readonly PlacedList[]): IngestSnapshot {
  const families = new Map<string, SnapshotFamily>();

  for (const list of placed) {
    let family = families.get(list.family.name);
    if (!family) {
      family = {
        name: list.family.name,
        target: list.family.target,
        expressions: [],
        lists: [],
      };
      families.set(list.family.name, family);
    }

    family.lists.push({
      season: list.season,
      eventId: list.eventId,
      listId: list.listId,
      listName: list.listName,
      variant: list.variant.name,
      decoded: list.decoded,
      hidden: list.hidden,
      skippedBecause: list.skippedBecause,
      expressions: [...list.expressions],
      rows: list.rowCount,
    });
  }

  for (const family of families.values()) {
    family.lists.sort((a, b) =>
      a.eventId === b.eventId
        ? a.listId.localeCompare(b.listId)
        : a.eventId.localeCompare(b.eventId),
    );
    family.expressions = [...new Set(family.lists.flatMap((list) => list.expressions))].sort();
  }

  // Declaration order, not first-appearance order: a new event must not be
  // able to reorder the array and turn #31's diff into noise.
  const ordered = FAMILIES.map((family) => families.get(family.name)).filter(
    (family) => family !== undefined,
  );

  return { version: 1, families: ordered };
}
