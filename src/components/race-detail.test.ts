/**
 * The five guards, each of which encodes a real defect in the real data.
 *
 * These are correctness tests, not polish tests. Every fixture below is shaped
 * after a published 2025 result — the numbers are the ones that broke a naive
 * reading — but no fixture carries a real name: riders here are `«RIDER-A»`,
 * the redaction form `docs/fixtures.md` names. Default lane, no corpus read.
 */

import { describe, expect, it } from 'vitest';
import { GENDERS, GRADE_BANDS } from '../lib/ingest/category.ts';
import {
  buildSquadCard,
  categoryMarks,
  categoryRank,
  chips,
  fieldPosition,
  fieldsByCategory,
  headline,
  lapDisplay,
  lapsDownText,
  outsideFor,
  placeRank,
  riderCard,
  squadSummary,
  stats,
  type RaceResultRow,
} from './race-detail.ts';

/** A finisher who rode the full distance, in a field big enough to rank. */
function row(over: Partial<RaceResultRow> = {}): RaceResultRow {
  return {
    plate: '974',
    category: 'HS1 Boys',
    place: '1',
    status: 'finished',
    timeRaw: '47:09.83',
    points: 500,
    isLapped: false,
    lapsDown: 0,
    pctBack: 0,
    fieldSize: 24,
    fieldTopPct: 4,
    scored: true,
    ptsLeader: false,
    grade: 9,
    lapSplits: ['15:42.11', '15:39.02', '15:48.70'],
    lapSeconds: [942.11, 939.02, 948.7],
    ...over,
  };
}

/**
 * Pulled a lap short at 2025 Race 4 North. Their clock time is FASTER than the
 * 3-lap riders and the source still ranks them 65th; a naive percent-back would
 * put them ahead of the winner.
 */
const lapped = row({
  plate: '204',
  place: '65',
  isLapped: true,
  lapsDown: 1,
  pctBack: null,
  fieldTopPct: 90,
  timeRaw: '49:10.82',
  points: 120,
  lapSplits: ['24:35.10', '24:35.72'],
  lapSeconds: [1475.1, 1475.72],
});

/** A DNF as the source marks it: `*` in place, `DNF` in time, points published. */
const dnf = row({
  plate: '928',
  place: '*',
  status: 'dnf',
  timeRaw: 'DNF',
  pctBack: null,
  isLapped: false,
  lapsDown: null,
  fieldTopPct: null,
  points: 80,
  scored: false,
  lapSplits: ['16:02.44'],
  lapSeconds: [962.44],
});

describe('guard 1 — a lapped rider never renders a percentage', () => {
  it('renders the lap deficit, with a real minus sign', () => {
    const h = headline(lapped);
    expect(h.kind).toBe('laps-down');
    expect(h.value).toBe('−1 lap');
    // U+2212, not a hyphen-minus. A lap deficit is a number, not a dash.
    expect(h.value.charCodeAt(0)).toBe(0x2212);
  });

  it('pluralises a deficit of more than one lap', () => {
    expect(lapsDownText(1)).toBe('−1 lap');
    expect(lapsDownText(2)).toBe('−2 laps');
  });

  it('puts no percentage anywhere on the card', () => {
    const card = riderCard(lapped, '«RIDER-B»');
    const rendered = [
      card.headline.value,
      card.headline.caption ?? '',
      ...card.stats.map((s) => s.value),
      ...card.chips.map((c) => c.text),
      card.outside?.text ?? '',
    ].join(' ');
    expect(rendered).not.toMatch(/%/);
  });

  it('gives them no position on the axis, and a line beside it instead', () => {
    expect(riderCard(lapped, '«RIDER-B»').mark.pct).toBeNull();
    expect(outsideFor(lapped, '«RIDER-B»')).toEqual({
      text: '«RIDER-B» — −1 lap · 65 of 24',
      kind: 'lapped',
    });
  });
});

describe('guard 2 — a field under ten starters shows no percentile', () => {
  it('says how many started instead of ranking them', () => {
    // HS2 Girls fielded 7 at 2025 Race 4 North. `v_race_result` suppresses
    // field_top_pct below n=10; the cell says why rather than sitting empty.
    const small = row({ fieldSize: 7, fieldTopPct: null, place: '3' });
    expect(fieldPosition(small)).toBe('7 started, too few to rank');
  });

  it('never prints a percentile for a field of one', () => {
    // Varsity Girls fielded ONE at Race 2 North.
    const solo = row({ fieldSize: 1, fieldTopPct: null, place: '1' });
    expect(fieldPosition(solo)).toBe('1 started, too few to rank');
    expect(fieldPosition(solo)).not.toMatch(/top/);
  });
});

describe('guard 3 — a percentile appears only in the top half', () => {
  it('shows the percentile above the median', () => {
    expect(fieldPosition(row({ fieldTopPct: 4 }))).toBe('top 4%');
    expect(fieldPosition(row({ fieldTopPct: 50, place: '12' }))).toBe('top 50%');
  });

  it('shows the raw place below the median', () => {
    expect(fieldPosition(row({ fieldTopPct: 51, place: '13' }))).toBe('13 of 24');
    expect(fieldPosition(row({ fieldTopPct: 92, place: '22' }))).toBe('22 of 24');
  });
});

describe('guard 4 — a DNF renders as the source marks it', () => {
  it('imputes no time and no place', () => {
    const cells = Object.fromEntries(stats(dnf).map((s) => [s.label, s.value]));
    expect(cells.Place).toBe('—');
    expect(cells.Time).toBe('—');
    expect(cells.Field).toBe('—');
  });

  it('still shows the points, because they were published', () => {
    expect(Object.fromEntries(stats(dnf).map((s) => [s.label, s.value])).Points).toBe('80');
  });

  it('leads with DNF rather than a number', () => {
    expect(headline(dnf)).toEqual({ kind: 'dnf', value: 'DNF', caption: null });
    expect(chips(dnf)).toContainEqual({ text: 'DNF', tone: 'dnf' });
  });

  it('keeps them off the axis and beside the strip', () => {
    expect(riderCard(dnf, '«RIDER-C»').mark.pct).toBeNull();
    expect(outsideFor(dnf, '«RIDER-C»')).toEqual({ text: '«RIDER-C» — DNF', kind: 'dnf' });
  });
});

describe('a finisher who rode the full distance', () => {
  it('leads with percent back', () => {
    expect(headline(row({ pctBack: 19.6, place: '20' }))).toEqual({
      kind: 'pct-back',
      value: '19.6%',
      caption: 'back',
    });
  });

  it('falls back to place where the race has no percent-back axis at all', () => {
    // The 2025 prologue: a time trial publishes no lap columns, so nobody in
    // the list has a percent-back (issue #48). The card must still say
    // something true rather than a blank or a zero.
    expect(headline(row({ pctBack: null, place: '11', fieldSize: 457 }))).toEqual({
      kind: 'place',
      value: '11',
      caption: 'of 457',
    });
  });
});

describe('lap splits', () => {
  it('draws a bar per split, marking the fastest', () => {
    const display = lapDisplay(row());
    expect(display.kind).toBe('bars');
    if (display.kind !== 'bars') throw new Error('unreachable');
    expect(display.bars.map((b) => b.best)).toEqual([false, true, false]);
    expect(display.bars.map((b) => b.label)).toEqual(['15:42.11', '15:39.02', '15:48.70']);
    // Heights are relative to the slowest lap, so the tallest bar is full.
    expect(Math.max(...display.bars.map((b) => b.height))).toBe(100);
  });

  it('renders a single split as a value, not a full-width bar', () => {
    // One lap is a split, not a chart: a lone bar has nothing to compare to.
    expect(lapDisplay(row({ lapSplits: ['16:02.44'], lapSeconds: [962.44] }))).toEqual({
      kind: 'value',
      label: 'Lap 1',
      value: '16:02.44',
    });
  });

  it('draws nothing where the list published no splits', () => {
    expect(lapDisplay(row({ lapSplits: [], lapSeconds: [] }))).toEqual({ kind: 'none' });
  });

  it('falls back to the published strings when a split will not parse', () => {
    const display = lapDisplay(row({ lapSplits: ['15:42.11', '-'], lapSeconds: [942.11, 0] }));
    expect(display).toEqual({ kind: 'value', label: 'Laps', value: '15:42.11 · -' });
  });
});

describe('the squad frame', () => {
  it('counts the squad, not the field', () => {
    expect(squadSummary([row(), row(), lapped, dnf])).toBe('4 raced · 3 scored · 1 DNF');
  });

  it('omits the DNF clause when there are none', () => {
    expect(squadSummary([row(), lapped])).toBe('2 raced · 2 scored');
  });
});

describe('the category field handed to the strip', () => {
  it('passes every starter through and marks only ours', () => {
    const field = [row({ plate: '974' }), lapped, dnf, row({ plate: '886', pctBack: 19.6 })];
    const marks = categoryMarks(field, new Set(['204', '886']));

    expect(marks).toHaveLength(4);
    expect(marks.filter((m) => m.ours)).toHaveLength(2);
    // The lapped rider is ours AND unplaceable — both facts survive the trip.
    expect(marks[1]).toEqual({ pct: null, ours: true });
  });
});

/**
 * Card order (issue #61).
 *
 * The page used to render whatever order the database happened to return. These
 * tests scramble the input on purpose: a comparator that is a total order gives
 * the same answer whatever it is handed, and that is the whole property.
 */
describe('card order is decided here, not by the database', () => {
  const entry = (over: Partial<RaceResultRow>, name: string) => ({ row: row(over), name });

  /** The order the cards come out in, as plates. */
  const plates = (entries: readonly { row: RaceResultRow; name: string }[]) =>
    buildSquadCard('Descenders', entries, new Map()).riders.map((r) => r.card.plate);

  it('sorts a category by finishing place, with 10 after 2', () => {
    const scrambled = [
      entry({ plate: '10', place: '10' }, '«RIDER-C»'),
      entry({ plate: '01', place: '1' }, '«RIDER-A»'),
      entry({ plate: '02', place: '2' }, '«RIDER-B»'),
    ];
    expect(plates(scrambled)).toEqual(['01', '02', '10']);
  });

  it('puts a DNF last in its category, behind every finisher', () => {
    const scrambled = [
      entry({ plate: '928', place: '*', status: 'dnf' }, '«RIDER-C»'),
      entry({ plate: '930', place: '10' }, '«RIDER-B»'),
      entry({ plate: '974', place: '1' }, '«RIDER-A»'),
    ];
    expect(plates(scrambled)).toEqual(['974', '930', '928']);
  });

  it('orders a category of nothing but DNFs, repeatably', () => {
    const dnfs = [
      entry({ plate: '928', place: '*', status: 'dnf' }, '«RIDER-C»'),
      entry({ plate: '204', place: 'DNF', status: 'dnf' }, '«RIDER-A»'),
      entry({ plate: '886', place: '', status: 'dnf' }, '«RIDER-B»'),
    ];
    // By name, then plate — arbitrary as a choice, defined as a rule.
    expect(plates(dnfs)).toEqual(['204', '886', '928']);
    expect(plates([...dnfs].reverse())).toEqual(['204', '886', '928']);
  });

  it('keeps each category contiguous, in the order the league ranks them', () => {
    const scrambled = [
      entry({ plate: '3', category: 'Varsity Girls', place: '1' }, '«RIDER-E»'),
      entry({ plate: '2', category: 'HS1 Boys', place: '2' }, '«RIDER-C»'),
      entry({ plate: '5', category: 'MS2 Girls', place: '1' }, '«RIDER-A»'),
      entry({ plate: '1', category: 'HS1 Boys', place: '1' }, '«RIDER-B»'),
      entry({ plate: '4', category: 'HS1 Girls', place: '1' }, '«RIDER-D»'),
    ];
    // MS2 < HS1 < Varsity, Boys before Girls, and the two HS1 Boys stay together.
    expect(plates(scrambled)).toEqual(['5', '1', '2', '4', '3']);
  });

  it('sends a category it does not recognize to the end rather than dropping it', () => {
    const scrambled = [
      entry({ plate: '9', category: 'Tandem Unicycle', place: '1' }, '«RIDER-B»'),
      entry({ plate: '1', category: 'MS1 Boys', place: '1' }, '«RIDER-A»'),
    ];
    expect(plates(scrambled)).toEqual(['1', '9']);
  });

  it('leaves the caller its own array', () => {
    const entries = [
      entry({ plate: '930', place: '10' }, '«RIDER-B»'),
      entry({ plate: '974', place: '1' }, '«RIDER-A»'),
    ];
    plates(entries);
    expect(entries.map((e) => e.row.plate)).toEqual(['930', '974']);
  });

  it('orders each category field by place too, so the strip is deterministic', () => {
    const field = [
      row({ plate: '928', place: '*', status: 'dnf' }),
      row({ plate: '930', place: '10' }),
      row({ plate: '974', place: '1' }),
      row({ plate: '502', category: 'HS2 Girls', place: '2' }),
      row({ plate: '501', category: 'HS2 Girls', place: '1' }),
    ];
    const byCategory = fieldsByCategory(field);
    expect(byCategory.get('HS1 Boys')!.map((r) => r.place)).toEqual(['1', '10', '*']);
    expect(byCategory.get('HS2 Girls')!.map((r) => r.place)).toEqual(['1', '2']);
  });
});

describe('the sort keys, on their own', () => {
  it('reads the published place as a number and never re-derives one', () => {
    expect(placeRank('2')).toBe(2);
    expect(placeRank('10')).toBe(10);
    expect(placeRank(' 7 ')).toBe(7);
  });

  it('sends every place it cannot read to the back, rather than guessing', () => {
    for (const unplaceable of ['*', 'DNF', '', '-', '3rd', '1.5']) {
      expect(placeRank(unplaceable)).toBe(Number.POSITIVE_INFINITY);
    }
  });

  it('ranks exactly the fourteen the league publishes, in the league order', () => {
    // The pin. `CATEGORY_SEQUENCE` is a second copy of a vocabulary that lives
    // in `ingest/category.ts`, and this is what keeps the two from drifting: a
    // band added to the league that never reached the page fails here.
    const league = GRADE_BANDS.flatMap((band) => GENDERS.map((gender) => `${band} ${gender}`));
    expect(league.map(categoryRank)).toEqual(league.map((_, rank) => rank));
  });

  it('sorts a category the league does not publish behind all fourteen', () => {
    expect(categoryRank('Tandem Unicycle')).toBe(GRADE_BANDS.length * GENDERS.length);
  });
});
