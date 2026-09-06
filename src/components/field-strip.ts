/**
 * The field strip's contract, and the geometry behind it.
 *
 * **This is the app's core chart, not race detail's chart.** The wayfinder map
 * (issue #1) commits all three views to this one component:
 *
 *   - race detail — one strip per rider, their category's field
 *   - rider detail — one strip per race the rider started
 *   - club vs league — one strip per category, every club member marked
 *
 * So the seam is the mark, not the view: a caller hands over every starter as a
 * `FieldMark` and says which of them are theirs. Nothing about a squad, a race
 * or a season reaches this module.
 *
 * ## The invariant
 *
 * **A rider who did not complete the winner's lap count gets no position on the
 * axis.** NICA pulls lapped riders at the line and scores them with a valid
 * time, so their clock time is *faster* than riders who rode the full distance
 * — at 2025 Race 4 North a naive percent-back puts five 2-lap HS1 Boys ahead of
 * the actual winner. A DNF has no comparable time either.
 *
 * The invariant lives here rather than in the caller. A `FieldMark` whose `pct`
 * is null is structurally incapable of producing a dot; a caller who wants such
 * a rider seen passes them in `outside`, which renders beside the strip. Two
 * more views are going to consume this component, and "remember to filter"
 * is not a contract they can inherit.
 *
 * Percent back is null for a lapped rider, a DNF, and every rider in a time
 * trial — `v_race_result` guarantees that (migration 0002, issue #48), and this
 * module never recomputes it. NICA is the scoring authority.
 *
 * ## Dot order (issue #74)
 *
 * `buildFieldStrip` used to sort only on `ours`, a stable sort, so every other
 * dot kept whatever order the caller's array happened to arrive in — a
 * contract the module never stated and a future caller could easily miss.
 * **This module now owns the order**: it sorts every placeable mark by its
 * `place`, the same guard `race-detail.ts`'s `placeRank` uses (`10` after `2`,
 * a non-numeric or omitted `place` sorts last), so the wall and the Category
 * view — the two callers this file's header already anticipates — get a
 * correct dot order without having to remember to pre-sort.
 *
 * `place` is required on `FieldMark`, not optional: an optional field is a
 * guarantee a future caller could still omit by accident, silently
 * reproducing the exact pre-#74 bug for that caller — ties on `ours` alone,
 * falling back to whatever order its array happened to arrive in. Owning the
 * order only works if the module cannot be handed a mark without one, so the
 * guarantee lives in the type rather than in a caller's memory. Every caller —
 * `race-detail.ts`'s `categoryMarks`/`markFor`, and the wall and Category
 * views this file's header already anticipates — passes through the source's
 * published `place` string verbatim; nothing here computes or re-derives one.
 * `ours` still wins over everything else: it is the primary sort key, `place`
 * only orders within each of the two `ours` groups.
 */

/**
 * The axis floor, in percent back.
 *
 * A tight field would otherwise scale up to fill the strip and read as though
 * it were spread out. Ten percent is the narrowest span the axis will draw.
 */
export const MIN_AXIS_MAX = 10;

/**
 * One starter.
 *
 * `pct` is percent back from the category's winner, as `v_race_result`
 * published it — **null means this rider has no position on the axis**, which
 * is a fact about the result and not a missing value to be filled in.
 */
export type FieldMark = {
  pct: number | null;
  /**
   * The published place, exactly as the source printed it — `"1"`, `"10"`,
   * `"*"` for a DNF. Required: see "Dot order" in the module header for why an
   * optional field does not close issue #74. Never computed or re-derived
   * here — the only legal value is what the source published.
   */
  place: string;
  /** Highlighted. Orange with an ink ring: our rider, in a field of grey. */
  ours: boolean;
  /** Named only for a highlighted mark; it reaches the accessible description. */
  label?: string;
};

/** A rider the axis cannot hold, rendered beside the strip instead. */
export type OutsideMark = {
  text: string;
  kind: 'lapped' | 'dnf';
};

/** A dot, placed. `x` is a fraction of the axis span, already clamped to 0..1. */
export type FieldDot = {
  x: number;
  ours: boolean;
  label?: string;
};

export type FieldStripModel = {
  /**
   * The axis ceiling actually drawn, in percent back — or **null when there is
   * no axis at all**, because not one rider in the field is placeable.
   *
   * Null rather than a number the renderer is trusted to ignore. A ceiling
   * computed over no riders is the floor, and a floor drawn as an axis is a
   * scale nothing was measured against: at a time trial that rendered a
   * `+10%` axis with no marks on it, on every card (issue #60). Making the
   * absence a type the renderer has to answer for is the same move the
   * invariant makes with a null `pct` — see the module header.
   */
  max: number | null;
  dots: FieldDot[];
  outside: OutsideMark[];
  /** Starters with a position on the axis. */
  placed: number;
  /** Starters without one. Never silently dropped — this is what `outside` is for. */
  unplaced: number;
  /** One sentence naming what the strip shows, for a screen reader. */
  description: string;
};

/**
 * Where a percentage sits on the axis, as a fraction of its span.
 *
 * Clamped, unlike the prototype's version. A caller that passes an explicit
 * `max` smaller than a mark it also passed would otherwise draw a dot past the
 * end of the strip, silently and only for that one rider.
 */
export function axisPosition(pct: number, max: number): number {
  if (!(max > 0)) return 0;
  return Math.min(1, Math.max(0, pct / max));
}

/** The axis ceiling: the slowest placed rider, never tighter than the floor. */
export function axisMax(marks: readonly FieldMark[], override?: number): number {
  if (override !== undefined) return Math.max(override, MIN_AXIS_MAX);
  const placed = marks.filter((m) => m.pct !== null).map((m) => m.pct as number);
  return Math.max(MIN_AXIS_MAX, ...placed);
}

/** The only shape a published place is allowed to be read as a number in. */
const WHOLE_NUMBER = /^\d+$/;

/**
 * A published `place` as a sort key, and nothing more.
 *
 * Mirrors `race-detail.ts`'s `placeRank`: `place` is the source's own string —
 * `"1"`, `"10"`, `"*"` for a rider it did not place — so sorting it lexically
 * would put `10` ahead of `2`. Read as a number when it is one; everything
 * else, including an empty string, sorts to the same rank at the back.
 * Nothing here computes or re-derives a place.
 */
function placeRank(place: string): number {
  const trimmed = place.trim();
  return WHOLE_NUMBER.test(trimmed) ? Number(trimmed) : Number.POSITIVE_INFINITY;
}

/**
 * Two marks, by `place`. Ties (any pair of non-numeric places) come back `0` —
 * `Array.prototype.sort` is stable, so they keep whatever order the caller
 * handed in.
 */
function comparePlace(a: string, b: string): number {
  const rankA = placeRank(a);
  const rankB = placeRank(b);
  if (rankA === rankB) return 0;
  return rankA < rankB ? -1 : 1;
}

/**
 * Turn a field into a drawable strip.
 *
 * Dots are ordered `ours` last, then by `place` within each of those two
 * groups (issue #74) — ours still paints over the field, since SVG has no
 * z-index and paint order is the only ordering there is, and `place` settles
 * the rest so a caller does not have to pre-sort correctly on its own.
 */
export function buildFieldStrip(
  marks: readonly FieldMark[],
  outside: readonly OutsideMark[] = [],
  max?: number,
): FieldStripModel {
  const placeable = marks.filter((m) => m.pct !== null);

  /*
   * No placeable rider, no axis — and this holds even against a caller-supplied
   * ceiling. Rider detail passes a shared `max` so two races can be compared
   * side by side, but a ceiling cannot conjure marks to sit under it, and a race
   * that published no percent back has nothing to compare. Drawing the axis
   * anyway is the whole of issue #60.
   */
  const ceiling = placeable.length === 0 ? null : axisMax(marks, max);

  const dots: FieldDot[] =
    ceiling === null
      ? []
      : [...placeable]
          .sort((a, b) => Number(a.ours) - Number(b.ours) || comparePlace(a.place, b.place))
          .map((m) => ({
            x: axisPosition(m.pct as number, ceiling),
            ours: m.ours,
            ...(m.label === undefined ? {} : { label: m.label }),
          }));

  return {
    max: ceiling,
    dots,
    outside: [...outside],
    placed: placeable.length,
    unplaced: marks.length - placeable.length,
    description: describe(marks, ceiling, outside),
  };
}

/**
 * Why a field has no axis, in one sentence.
 *
 * It lives here rather than in the renderer because this module already owns
 * the strip's prose, and because the sentence has two readers: it is the
 * visible copy where the strip would have been, and it opens the description a
 * screen reader gets. Two wordings of the same reason would drift, and a test
 * asserting on a phrase would keep passing while they did.
 */
export const NO_AXIS_REASON =
  'This race published no gap to the winner, so there is no axis to place riders on.';

/**
 * The text a screen reader gets.
 *
 * The prototype conveyed everything through dot position and colour, which is
 * to say it conveyed nothing at all to a reader that cannot see it. A strip
 * whose whole content is "our rider sat here in this field" can say exactly
 * that in a sentence, so it does.
 */
function describe(
  marks: readonly FieldMark[],
  max: number | null,
  outside: readonly OutsideMark[],
): string {
  const placed = marks.filter((m) => m.pct !== null).length;
  const ours = marks.filter((m) => m.ours && m.pct !== null);

  /*
   * No axis, so there is no position to describe and nobody sitting at one.
   * Say what is true instead — the reason there is no chart — rather than
   * reading out a ceiling that measured nothing.
   */
  if (max === null) {
    const parts = [
      `${NO_AXIS_REASON} None of the ${marks.length} ` +
        `rider${marks.length === 1 ? '' : 's'} can be placed`,
    ];
    for (const mark of outside) {
      parts.push(`${mark.text}, not on the axis`);
    }
    return `${parts.join('; ')}.`;
  }

  const parts = [
    `${placed} rider${placed === 1 ? '' : 's'} on the axis, winner to +${round(max)}%`,
  ];

  for (const mark of ours) {
    const at = `+${round(mark.pct as number)}% back`;
    parts.push(mark.label === undefined ? `marked at ${at}` : `${mark.label} at ${at}`);
  }
  for (const mark of outside) {
    parts.push(`${mark.text}, not on the axis`);
  }
  return `${parts.join('; ')}.`;
}

const round = (n: number) => Math.round(n * 10) / 10;
