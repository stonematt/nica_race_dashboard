/**
 * Has the source published a shape this codebase has never seen?
 *
 * `src/lib/ingest/snapshot.ts` records what every list looked like, per family:
 * the expression set, the variant each list resolved to, the row counts. This
 * module compares two of those and names what the newer one carries that the
 * older one does not.
 *
 * **The comparison is one-directional on purpose.** The question is "is this
 * season drifted from what we know", not "are these two snapshots equal", and
 * the two are different questions: a candidate built from one event is missing
 * most of a season's expressions without anything having drifted. So a finding
 * is always something *present in the candidate and absent from the baseline* —
 * a new family, a new layout variant, a new expression. That is what has to be
 * classified before an ingest can be trusted, and it is what a new season
 * produces.
 *
 * The comparison deliberately ignores `decoded`, `skippedBecause` and row
 * counts. The first two are decode-pass outcomes the shape lane cannot know
 * (see `src/lib/shape/place.ts`); the third changes every event by design and
 * would drown the signal.
 */

import type { IngestSnapshot } from '../ingest/snapshot.ts';

export type DriftKind = 'family-added' | 'variant-added' | 'expression-added';

export interface DriftFinding {
  kind: DriftKind;
  /** The family the drift landed in. */
  family: string;
  /** The variant or expression that is new. */
  what: string;
  /** The list that introduced it — `<eventId>/<listId>`, or the family alone. */
  where: string;
}

/** A one-line description, for a test failure or a CI log. */
export function describeDrift(finding: DriftFinding): string {
  return `${finding.kind}: ${finding.family} — ${finding.what} (${finding.where})`;
}

/**
 * What `candidate` carries that `baseline` has never seen.
 *
 * An empty result means the candidate's shape is entirely accounted for.
 */
export function driftAgainst(baseline: IngestSnapshot, candidate: IngestSnapshot): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const known = new Map(baseline.families.map((family) => [family.name, family]));

  for (const family of candidate.families) {
    const seen = known.get(family.name);

    if (seen === undefined) {
      findings.push({
        kind: 'family-added',
        family: family.name,
        what: family.name,
        where: family.lists.map((list) => `${list.eventId}/${list.listId}`).join(', '),
      });
      continue;
    }

    const knownVariants = new Set(seen.lists.map((list) => list.variant));
    for (const list of family.lists) {
      if (!knownVariants.has(list.variant)) {
        findings.push({
          kind: 'variant-added',
          family: family.name,
          what: list.variant,
          where: `${list.eventId}/${list.listId}`,
        });
      }
    }

    const knownExpressions = new Set(seen.expressions);
    for (const expression of family.expressions) {
      if (knownExpressions.has(expression)) continue;
      const introducer = family.lists.find((list) => list.expressions.includes(expression));
      findings.push({
        kind: 'expression-added',
        family: family.name,
        what: expression,
        where: introducer ? `${introducer.eventId}/${introducer.listId}` : family.name,
      });
    }
  }

  return findings;
}
