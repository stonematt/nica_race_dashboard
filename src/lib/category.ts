/**
 * The crossing: a Rider's own Category field at a Round.
 *
 * ADR-0002 names it the single door from the club tree into the league tree.
 * Everywhere else in this app moves inside the club tree (Club → Squad →
 * Rider); this module is the one place a Rider's own result hands over to the
 * league's own ranked peer group — her Category (`CONTEXT.md`).
 *
 * `src/lib/db/category-query.ts` is the only thing that reads a database. It
 * resolves which Category and Event a Rider's own result at a Round belongs
 * to, reads every starter the source published in that Category at that
 * Event, and flags which of them share the caller's Squad. This module only
 * ranks and packages what the query layer already resolved — the same split
 * as `roster-wall.ts` / `roster-wall-query.ts`.
 *
 * ADR-0001 line, restated for this module: a row carries place (as
 * published), percent back, lapped and the Category's own field size — all
 * description. It never carries or invents points, season place, Category
 * assignment, DQ or eligibility. Those are adjudication, and NICA is the
 * scoring authority.
 *
 * A live inconsistency this module does not paper over (issue #98):
 * `v_race_result` nulls `pct_back` for every rider at a time trial today,
 * though `CONTEXT.md` says the Prologue has a real one. `pctBack` here is
 * exactly what the source view publishes — null included.
 */

/** Conference-scoped at Rounds 1–4; league-wide at State Champs (`CONTEXT.md`, Category). */
export type CategoryFieldScope = 'conference' | 'league';

/**
 * One starter in the Category, as the source published her.
 *
 * Most rows resolve to no Rider at all — the Category's field is the whole
 * league, and only a handful of its starters are on this club's roster.
 */
export type CategoryFieldRow = {
  plate: string;
  displayName: string;
  scoringTeam: string;
  /** Verbatim. May carry `*` or be empty for a non-finisher — never rewritten. */
  place: string;
  status: 'finished' | 'dnf';
  isLapped: boolean;
  /**
   * Null for a DNF, a lapped rider, and — today, issue #98 — every rider at a
   * time trial. Read exactly as `v_race_result` publishes it; never derived
   * from times here.
   */
  pctBack: number | null;
  /** The Rider this row resolves to, when its plate is mapped. Null for the rest of the field. */
  riderId: number | null;
  /** True when `riderId` is a member of the Squad the caller asked about. */
  isSquadMate: boolean;
};

/**
 * The Category's own field at one Round — the crossing's destination.
 *
 * Every starter the source published appears here, including a DNF as a row
 * with no position: the three states render inline, never as a missing row.
 */
export type CategoryField = {
  /**
   * The Category's own name, published verbatim — "HS2 Girls – North" through
   * Round 4, "HS2 Girls" at State Champs once the Conference suffix drops.
   */
  categoryName: string;
  /** Conference-scoped through Round 4; league-wide at State Champs. */
  scope: CategoryFieldScope;
  /** The Conference this Category is scoped to. Null exactly when `scope` is `'league'`. */
  conference: string | null;
  /**
   * Every starter the source published in this Category at this Round's
   * Event, in this Conference — a count `src/lib/db/category-query.ts` takes
   * over the same rows it hands to this module, not `v_race_result`'s own
   * `field_size` (see that module's header for why). ADR-0001 lists field
   * size as description we may compute; this is that computation, done once,
   * so "3rd of 30" never has to be recomputed by a caller.
   */
  fieldSize: number;
  /** Every starter, ranked by the source's own published place. Never re-derived. */
  rows: CategoryFieldRow[];
};

/**
 * The only shape a published place is allowed to be read as a number in.
 * Mirrors `src/components/field-strip.ts`'s `placeRank`.
 */
const WHOLE_NUMBER = /^\d+$/;

/**
 * A published `place` as a sort key, and nothing more — matching
 * `src/components/field-strip.ts`'s `placeRank`/`comparePlace` semantics so
 * the crossing and the field strip never disagree about ordering. `place` is
 * the source's own string ("1", "10", "*" for a non-finisher), so sorting it
 * lexically would put `10` ahead of `2`. Read as a number when it is one;
 * everything else, including an empty string, sorts to the same rank at the
 * back. Nothing here computes or re-derives a place.
 */
function placeRank(place: string): number {
  const trimmed = place.trim();
  return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : Number.POSITIVE_INFINITY;
}

/**
 * Two rows, by `place`. Ties (any pair of non-numeric places, e.g. two DNFs)
 * come back `0` — `Array.prototype.sort` is stable, so they keep whatever
 * order the query layer handed in.
 */
function comparePlace(a: string, b: string): number {
  const rankA = placeRank(a);
  const rankB = placeRank(b);
  if (rankA === rankB) return 0;
  return rankA < rankB ? -1 : 1;
}

/**
 * Build the Category field: every starter the query layer read, ranked by
 * the source's own published place.
 *
 * Pure. `conference` decides `scope` by presence alone — non-null means
 * Conference-scoped, null means the Category is already league-wide, which
 * is exactly how `v_race_result`'s own `conference` column behaves at State
 * Champs (the suffix and the per-event conference both drop). That is a
 * description of what the source already published, not a rule this module
 * invents.
 */
export function buildCategoryField(
  categoryName: string,
  conference: string | null,
  fieldSize: number,
  rows: readonly CategoryFieldRow[],
): CategoryField {
  return {
    categoryName,
    scope: conference === null ? 'league' : 'conference',
    conference,
    fieldSize,
    rows: [...rows].sort((a, b) => comparePlace(a.place, b.place)),
  };
}
