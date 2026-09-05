/**
 * A drift snapshot built from the shape corpus rather than from a normalize run.
 *
 * `src/lib/ingest/snapshot.ts` owns what a snapshot *is* and how it is ordered;
 * this only supplies it with placed lists that came from committed shape files
 * instead of from `raw_fetch`. That is the whole reason the snapshot was
 * written to carry no rows: the same artifact can be built in CI, on a public
 * repository, with no payload anywhere on the machine.
 */

import { buildSnapshot, type IngestSnapshot } from '../ingest/snapshot.ts';
import type { ShapeEvent, ShapeListFile } from './corpus.ts';
import { placeShapeList } from './place.ts';

/** Every list of every event in `events`, whatever season. */
export function listsOf(events: readonly ShapeEvent[]): ShapeListFile[] {
  return events.flatMap((event) => event.lists);
}

/** Only the events of one season. */
export function seasonOf(events: readonly ShapeEvent[], season: number): ShapeEvent[] {
  return events.filter((event) => event.season === season);
}

/**
 * Place these shape lists and summarize them.
 *
 * Throws if any list is unrecognized, ambiguous or carries an unclassified
 * expression — building a snapshot is itself one of the detection assertions.
 */
export function snapshotOf(files: readonly ShapeListFile[]): IngestSnapshot {
  return buildSnapshot(files.map(placeShapeList));
}
