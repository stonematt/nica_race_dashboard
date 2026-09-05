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
  /** The axis ceiling actually drawn, in percent back. */
  max: number;
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

/**
 * Turn a field into a drawable strip.
 *
 * Ours are emitted last so they paint over the field — SVG has no z-index, so
 * paint order is the only ordering there is, and it has to be decided here
 * rather than left to the renderer.
 */
export function buildFieldStrip(
  marks: readonly FieldMark[],
  outside: readonly OutsideMark[] = [],
  max?: number,
): FieldStripModel {
  const ceiling = axisMax(marks, max);
  const placeable = marks.filter((m) => m.pct !== null);

  const dots: FieldDot[] = [...placeable]
    .sort((a, b) => Number(a.ours) - Number(b.ours))
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
 * The text a screen reader gets.
 *
 * The prototype conveyed everything through dot position and colour, which is
 * to say it conveyed nothing at all to a reader that cannot see it. A strip
 * whose whole content is "our rider sat here in this field" can say exactly
 * that in a sentence, so it does.
 */
function describe(
  marks: readonly FieldMark[],
  max: number,
  outside: readonly OutsideMark[],
): string {
  const placed = marks.filter((m) => m.pct !== null).length;
  const ours = marks.filter((m) => m.ours && m.pct !== null);

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
