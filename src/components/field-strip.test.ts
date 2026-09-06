/**
 * The field strip's invariant, held inside the component.
 *
 * Two more views inherit whatever is decided here (issue #1), so the test that
 * matters most is the negative one: a rider with no comparable time cannot be
 * given a position on the axis, no matter what a caller passes.
 */

import { describe, expect, it } from 'vitest';
import { axisMax, axisPosition, buildFieldStrip, MIN_AXIS_MAX } from './field-strip.ts';

describe('the invariant', () => {
  it('gives a rider with no percent back no dot, ever', () => {
    const model = buildFieldStrip([
      { pct: 0, ours: false, place: '1' },
      { pct: null, ours: true, label: '«RIDER-A»', place: '*' }, // lapped, and ours
      { pct: 12.5, ours: false, place: '2' },
      { pct: null, ours: false, place: '*' }, // a DNF
    ]);

    expect(model.dots).toHaveLength(2);
    expect(model.placed).toBe(2);
    // Unplaced riders are counted, not quietly dropped — `outside` is where a
    // caller puts them, and the count is how a caller notices it forgot.
    expect(model.unplaced).toBe(2);
  });

  it('renders an unplaceable rider beside the strip when the caller says so', () => {
    const model = buildFieldStrip(
      [{ pct: null, ours: true, place: '*' }],
      [{ text: '«RIDER-A» — −1 lap · 65 of 24', kind: 'lapped' }],
    );
    expect(model.dots).toHaveLength(0);
    expect(model.outside[0]!.kind).toBe('lapped');
  });
});

/*
 * Issue #60. A time trial publishes no percent back for anybody, so the whole
 * field is unplaceable at once. The model used to hand back the axis floor,
 * which the renderer drew as a `+10%` scale with nothing under it — on all 25
 * cards at the corpus prologue.
 *
 * The data half of this was already asserted elsewhere and still passed, which
 * is why these live here: the fact was known, its consequence was never named.
 */
describe('a field with nobody on the axis', () => {
  const timeTrial = [
    { pct: null, ours: false, place: '1' },
    { pct: null, ours: true, label: '«RIDER-A»', place: '2' },
    { pct: null, ours: false, place: '3' },
  ];

  it('has no axis at all, rather than one scaled to the floor', () => {
    const model = buildFieldStrip(timeTrial);

    expect(model.max).toBeNull();
    expect(model.dots).toHaveLength(0);
  });

  it('still counts the field, so nobody is quietly dropped', () => {
    const model = buildFieldStrip(timeTrial);

    expect(model.placed).toBe(0);
    expect(model.unplaced).toBe(3);
  });

  it('says why there is no axis instead of reading out a ceiling', () => {
    const model = buildFieldStrip(timeTrial);

    expect(model.description).toContain('no gap to the winner');
    // The floor must not reach a reader as though something were measured.
    expect(model.description).not.toContain('%');
  });

  it('cannot be given an axis by a caller-supplied ceiling', () => {
    // Rider detail passes a shared ceiling so two races compare. A ceiling
    // still cannot conjure a rider to sit under it.
    const model = buildFieldStrip(timeTrial, [], 60);

    expect(model.max).toBeNull();
    expect(model.dots).toHaveLength(0);
  });

  it('keeps an unplaceable rider beside the strip, as ever', () => {
    const model = buildFieldStrip(timeTrial, [{ text: '«RIDER-A» — DNF', kind: 'dnf' }]);

    expect(model.outside[0]!.text).toBe('«RIDER-A» — DNF');
    expect(model.description).toContain('not on the axis');
  });

  it('leaves a field with one placed rider alone, floor and all', () => {
    // The guard against over-correcting: one placeable rider is still an axis.
    const model = buildFieldStrip([
      { pct: 0, ours: false, place: '1' },
      { pct: null, ours: true, place: '*' },
    ]);

    expect(model.max).toBe(MIN_AXIS_MAX);
    expect(model.dots).toHaveLength(1);
  });
});

describe('the axis', () => {
  it('never draws tighter than the floor, so a close field is not stretched', () => {
    expect(
      axisMax([
        { pct: 0, ours: false, place: '1' },
        { pct: 2.1, ours: false, place: '2' },
      ]),
    ).toBe(MIN_AXIS_MAX);
  });

  it('opens out to hold the slowest placed rider', () => {
    expect(
      axisMax([
        { pct: 0, ours: false, place: '1' },
        { pct: 61.4, ours: false, place: '2' },
      ]),
    ).toBe(61.4);
  });

  it('ignores unplaceable riders when sizing itself', () => {
    expect(
      axisMax([
        { pct: 4, ours: false, place: '1' },
        { pct: null, ours: false, place: '*' },
      ]),
    ).toBe(MIN_AXIS_MAX);
  });

  it('holds the floor even against a smaller explicit ceiling', () => {
    expect(axisMax([{ pct: 0, ours: false, place: '1' }], 3)).toBe(MIN_AXIS_MAX);
  });

  it('puts the winner at the start and the ceiling at the end', () => {
    expect(axisPosition(0, 40)).toBe(0);
    expect(axisPosition(40, 40)).toBe(1);
    expect(axisPosition(10, 40)).toBe(0.25);
  });

  it('clamps a mark that overshoots a caller-supplied ceiling', () => {
    // The prototype did not, so one rider would have drawn past the end of the
    // strip — silently, and only for that rider.
    expect(axisPosition(120, 40)).toBe(1);
    expect(axisPosition(-5, 40)).toBe(0);
  });
});

describe('the shapes the other two views will pass', () => {
  it('marks several riders in one strip — club vs league', () => {
    // That view draws one strip per category with every club member marked, so
    // "ours" has to be a property of a mark rather than a single highlighted
    // rider. Race detail happens to pass exactly one; nothing here requires it.
    const model = buildFieldStrip([
      { pct: 0, ours: false, place: '1' },
      { pct: 4, ours: true, label: '«RIDER-A»', place: '2' },
      { pct: 12, ours: true, label: '«RIDER-B»', place: '3' },
      { pct: 30, ours: false, place: '4' },
      { pct: 41, ours: true, label: '«RIDER-C»', place: '5' },
    ]);

    expect(model.dots.filter((dot) => dot.ours)).toHaveLength(3);
    // All three still paint over the field, and each is named in the
    // description rather than only the first.
    expect(model.dots.slice(2).every((dot) => dot.ours)).toBe(true);
    expect(model.description).toContain('«RIDER-A» at +4% back');
    expect(model.description).toContain('«RIDER-C» at +41% back');
  });

  it('takes a shared ceiling so two strips can be compared — rider detail', () => {
    // One strip per race a rider started, stacked. Left to size themselves each
    // would use its own axis and a rider's line would wander for reasons that
    // are about the field rather than about them, so a caller can fix the
    // ceiling across the set.
    const raceOne = buildFieldStrip(
      [
        { pct: 0, ours: false, place: '1' },
        { pct: 8, ours: true, place: '2' },
      ],
      [],
      60,
    );
    const raceTwo = buildFieldStrip(
      [
        { pct: 0, ours: false, place: '1' },
        { pct: 55, ours: true, place: '2' },
      ],
      [],
      60,
    );

    expect(raceOne.max).toBe(60);
    expect(raceTwo.max).toBe(60);
    // The same percentage lands in the same place in both, which is the point.
    expect(raceOne.dots[1]!.x).toBeCloseTo(8 / 60, 6);
    expect(raceTwo.dots[1]!.x).toBeCloseTo(55 / 60, 6);
  });
});

describe('paint order', () => {
  it('emits our marks last, because SVG has no z-index', () => {
    const model = buildFieldStrip([
      { pct: 5, ours: true, place: '2' },
      { pct: 1, ours: false, place: '1' },
      { pct: 9, ours: false, place: '3' },
    ]);
    expect(model.dots.map((d) => d.ours)).toEqual([false, false, true]);
  });
});

/*
 * Issue #74. `buildFieldStrip` used to sort only on `ours`, a stable sort, so
 * every other dot inherited the caller's own array order — a contract the
 * module never stated. It now sorts by `place` itself, within each of the
 * `ours` groups, so a future caller (the wall, the Category view) gets a
 * correct dot order without pre-sorting.
 */
describe('dot order by place (#74)', () => {
  it('sorts 10 after 2, not lexically before it', () => {
    // Places arrive in an order that would put "10" first if sorted lexically
    // or left in input order. By place, "2" must come first.
    const model = buildFieldStrip([
      { pct: 20, ours: false, place: '10' },
      { pct: 4, ours: false, place: '2' },
    ]);
    expect(model.dots.map((d) => d.x)).toEqual([4 / 20, 20 / 20]);
  });

  it('sends a non-numeric place to the back, after every numeric place', () => {
    const model = buildFieldStrip([
      { pct: 5, ours: false, place: '*' },
      { pct: 30, ours: false, place: '10' },
      { pct: 4, ours: false, place: '2' },
      { pct: 6, ours: false, place: '' }, // published as empty, same rank as non-numeric
    ]);
    // Numeric places first, ascending; the two unplaceable-by-place marks
    // follow, in the order they were given (stable sort over a tie).
    expect(model.dots.map((d) => d.x)).toEqual([4 / 30, 30 / 30, 5 / 30, 6 / 30]);
  });

  it('still paints ours last even when place order would put it first', () => {
    const model = buildFieldStrip([
      { pct: 40, ours: false, place: '9' },
      { pct: 5, ours: true, place: '1' },
    ]);
    expect(model.dots.map((d) => d.ours)).toEqual([false, true]);
  });

  it('keeps the caller order when every mark ties on place', () => {
    // A tie in `comparePlace` (here, three marks with the same non-numeric
    // place) falls back to the stable sort's own input order — the same
    // behavior a mark with no `place` produced before it was required.
    const model = buildFieldStrip([
      { pct: 5, ours: true, place: '*' },
      { pct: 1, ours: false, place: '*' },
      { pct: 9, ours: false, place: '*' },
    ]);
    expect(model.dots.map((d) => d.ours)).toEqual([false, false, true]);
  });
});

describe('the accessible description', () => {
  it('says what the strip shows, including who is marked', () => {
    const model = buildFieldStrip(
      [
        { pct: 0, ours: false, place: '1' },
        { pct: 19.6, ours: true, label: '«RIDER-A»', place: '2' },
      ],
      [{ text: '«RIDER-B» — DNF', kind: 'dnf' }],
    );
    expect(model.description).toBe(
      '2 riders on the axis, winner to +19.6%; «RIDER-A» at +19.6% back; «RIDER-B» — DNF, not on the axis.',
    );
  });

  it('reads correctly for a field of one', () => {
    expect(buildFieldStrip([{ pct: 0, ours: true, place: '1' }]).description).toBe(
      '1 rider on the axis, winner to +10%; marked at +0% back.',
    );
  });
});
