/**
 * The committed shape corpus is still what the stripper would write.
 *
 * **Local-only lane.** It reads `fixtures/` — minors' full names, schools,
 * grades, plates and finish times — and never runs in CI. That is the whole
 * reason the split exists (issue #29), and it is why this assertion cannot live
 * beside the detection suite: the detection suite's value is that it runs
 * everywhere, and this one's is that it caught the corpus going stale.
 *
 * A stale corpus is the failure this lane exists for. The detection suite would
 * stay green against last season's shapes while the real source had moved, and
 * "the tests pass" would mean nothing at exactly the moment it needed to mean
 * something. Re-run `node src/lib/shape/strip.ts` and commit the diff.
 */

import { describe, expect, it } from 'vitest';
import { readShapeCorpus } from './corpus.ts';
import { stripCorpus } from './strip.ts';

const committed = readShapeCorpus();
const derived = stripCorpus();

describe('the committed shape corpus against the real one', () => {
  it('covers the same events', () => {
    expect(derived.map((event) => `${event.season}/${event.eventId}`)).toEqual(
      committed.map((event) => `${event.season}/${event.eventId}`),
    );
  });

  it('is byte-for-byte what the stripper derives today', () => {
    for (const [index, event] of derived.entries()) {
      const against = committed[index]!;

      expect(event.config).toEqual(against.config);
      expect(event.lists.map((list) => list.shape.listId).sort()).toEqual(
        against.lists.map((list) => list.shape.listId).sort(),
      );

      for (const list of event.lists) {
        const match = against.lists.find((file) => file.shape.listId === list.shape.listId);
        expect(match).toEqual(list);
      }
    }
  });
});
