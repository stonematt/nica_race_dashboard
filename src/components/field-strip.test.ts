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
      { pct: 0, ours: false },
      { pct: null, ours: true, label: '«RIDER-A»' }, // lapped, and ours
      { pct: 12.5, ours: false },
      { pct: null, ours: false }, // a DNF
    ]);

    expect(model.dots).toHaveLength(2);
    expect(model.placed).toBe(2);
    // Unplaced riders are counted, not quietly dropped — `outside` is where a
    // caller puts them, and the count is how a caller notices it forgot.
    expect(model.unplaced).toBe(2);
  });

  it('renders an unplaceable rider beside the strip when the caller says so', () => {
    const model = buildFieldStrip(
      [{ pct: null, ours: true }],
      [{ text: '«RIDER-A» — −1 lap · 65 of 24', kind: 'lapped' }],
    );
    expect(model.dots).toHaveLength(0);
    expect(model.outside[0]!.kind).toBe('lapped');
  });
});

describe('the axis', () => {
  it('never draws tighter than the floor, so a close field is not stretched', () => {
    expect(
      axisMax([
        { pct: 0, ours: false },
        { pct: 2.1, ours: false },
      ]),
    ).toBe(MIN_AXIS_MAX);
  });

  it('opens out to hold the slowest placed rider', () => {
    expect(
      axisMax([
        { pct: 0, ours: false },
        { pct: 61.4, ours: false },
      ]),
    ).toBe(61.4);
  });

  it('ignores unplaceable riders when sizing itself', () => {
    expect(
      axisMax([
        { pct: 4, ours: false },
        { pct: null, ours: false },
      ]),
    ).toBe(MIN_AXIS_MAX);
  });

  it('holds the floor even against a smaller explicit ceiling', () => {
    expect(axisMax([{ pct: 0, ours: false }], 3)).toBe(MIN_AXIS_MAX);
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
      { pct: 0, ours: false },
      { pct: 4, ours: true, label: '«RIDER-A»' },
      { pct: 12, ours: true, label: '«RIDER-B»' },
      { pct: 30, ours: false },
      { pct: 41, ours: true, label: '«RIDER-C»' },
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
        { pct: 0, ours: false },
        { pct: 8, ours: true },
      ],
      [],
      60,
    );
    const raceTwo = buildFieldStrip(
      [
        { pct: 0, ours: false },
        { pct: 55, ours: true },
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
      { pct: 5, ours: true },
      { pct: 1, ours: false },
      { pct: 9, ours: false },
    ]);
    expect(model.dots.map((d) => d.ours)).toEqual([false, false, true]);
  });
});

describe('the accessible description', () => {
  it('says what the strip shows, including who is marked', () => {
    const model = buildFieldStrip(
      [
        { pct: 0, ours: false },
        { pct: 19.6, ours: true, label: '«RIDER-A»' },
      ],
      [{ text: '«RIDER-B» — DNF', kind: 'dnf' }],
    );
    expect(model.description).toBe(
      '2 riders on the axis, winner to +19.6%; «RIDER-A» at +19.6% back; «RIDER-B» — DNF, not on the axis.',
    );
  });

  it('reads correctly for a field of one', () => {
    expect(buildFieldStrip([{ pct: 0, ours: true }]).description).toBe(
      '1 rider on the axis, winner to +10%; marked at +0% back.',
    );
  });
});
