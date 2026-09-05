/**
 * Column resolution. Default lane — this reads layouts, never rows.
 *
 * The layouts here are the real ones, quoted from the corpus: `Fields` and
 * `DataFields` at 11 and 13 wide from 2025 Race 2 South, and at 10 and 11 from
 * the 2026 opener. Their *lengths* are the point.
 */

import { describe, expect, it } from 'vitest';
import { ColumnError, readColumnLayout } from './columns.ts';

/** 2025 Race 2 South: DataFields 13, Fields 11. */
const PLACE_2025 =
  'if(if([TransgenderOption]="Redundancy";[RANK5];[RANK1])>0;if([STATUS]<2;if([TransgenderOption]="Redundancy";[RANK5];[RANK1]);[TimeOrStatus]);"*")';
const NAME_2025 = 'ucase([DisplayName]) & iif([RANK2]=1 AND [ShowPoints]=1;" (PTS LEADER)";"")';

const DATA_FIELDS_2025 = [
  'BIB',
  'ID',
  PLACE_2025,
  NAME_2025,
  'CLUB',
  'DisplayPoints',
  'DisplayLapTime(1)',
  'DisplayLapTime(2)',
  'DisplayLapTime(3)',
  'DisplayLapTime(4)',
  'if([T20]>0;[TIME20])',
  'TimeOrStatus',
  'iif([RANK2]=1 AND [ShowPoints]=1;"B")',
];

/** The displayed columns. Note: no BIB, no ID, no styling flag. */
const FIELDS_2025 = [
  PLACE_2025,
  'BIB',
  NAME_2025,
  'CLUB',
  'DisplayPoints',
  'DisplayLapTime(1)',
  'DisplayLapTime(2)',
  'DisplayLapTime(3)',
  'DisplayLapTime(4)',
  'if([T20]>0;[TIME20])',
  'TimeOrStatus',
].map((Expression) => ({ Expression }));

const layout = () => readColumnLayout('a list', DATA_FIELDS_2025, FIELDS_2025);

describe('readColumnLayout', () => {
  it('resolves by expression, not by position in Fields', () => {
    // This is the whole trap. Fields is 11 long and DataFields is 13, and the
    // two do not even agree on order — Fields leads with place, DataFields with
    // BIB. Zipping them would put the place expression in column 0.
    expect(FIELDS_2025).toHaveLength(11);
    expect(DATA_FIELDS_2025).toHaveLength(13);

    const l = layout();
    expect(l.indexOf('BIB')).toBe(0);
    expect(l.indexOf(PLACE_2025)).toBe(2);
    expect(l.indexOf('TimeOrStatus')).toBe(11);
  });

  it('reports -1 for an expression the layout does not carry', () => {
    expect(layout().indexOf('NumberOfLaps')).toBe(-1);
    expect(layout().has('NumberOfLaps')).toBe(false);
  });

  it('keeps DataFields verbatim and in payload order', () => {
    expect(layout().dataFields).toEqual(DATA_FIELDS_2025);
  });

  it('refuses a displayed field with no transported column', () => {
    expect(() =>
      readColumnLayout('a list', DATA_FIELDS_2025, [...FIELDS_2025, { Expression: 'Grade' }]),
    ).toThrow(/no column in DataFields/);
  });

  it('refuses a duplicated expression rather than taking the first', () => {
    expect(() => readColumnLayout('a list', ['BIB', 'CLUB', 'BIB'], [])).toThrow(ColumnError);
    expect(() => readColumnLayout('a list', ['BIB', 'CLUB', 'BIB'], [])).toThrow(/both 0 and 2/);
  });

  it('refuses an empty DataFields', () => {
    expect(() => readColumnLayout('a list', [], [])).toThrow(/DataFields is empty/);
  });
});

describe('resolve', () => {
  it('finds the alias the layout actually carries', () => {
    expect(layout().resolve('points', ['DisplayPoints', 'PointsMatrix'])).toEqual({
      alias: 'DisplayPoints',
      column: 5,
    });
  });

  it('returns null when no alias is present', () => {
    expect(layout().resolve('laps', ['NumberOfLaps', 'TS1.LAPTIMENUMBER'])).toBeNull();
  });

  it('is fatal when two aliases for one field are present at once', () => {
    // Two spellings of the same field in one payload means the alias table has
    // stopped describing the source. Order would be an arbitrary tie-break.
    const drifted = readColumnLayout('a list', ['BIB', 'DisplayPoints', 'PointsMatrix'], []);

    expect(() => drifted.resolve('points', ['DisplayPoints', 'PointsMatrix'])).toThrow(ColumnError);
    expect(() => drifted.resolve('points', ['DisplayPoints', 'PointsMatrix'])).toThrow(
      /2 aliases for points/,
    );
  });
});

describe('row width', () => {
  it('accepts a row exactly DataFields wide', () => {
    expect(() => layout().checkRowWidth(new Array(13).fill(''), 1)).not.toThrow();
  });

  it('refuses a short row instead of nulling its tail', () => {
    expect(() => layout().checkRowWidth(new Array(12).fill(''), 7)).toThrow(ColumnError);
    expect(() => layout().checkRowWidth(new Array(12).fill(''), 7)).toThrow(
      /row 7 is 12 wide, DataFields is 13/,
    );
  });

  it('refuses a long row too', () => {
    expect(() => layout().checkRowWidth(new Array(14).fill(''), 1)).toThrow(ColumnError);
  });
});

describe('cell', () => {
  it('reads the column it is given', () => {
    const row = DATA_FIELDS_2025.map((_, i) => `c${i}`);
    expect(layout().cell(row, layout().indexOf('CLUB'))).toBe('c4');
  });

  it('reads nothing from an absent column', () => {
    expect(layout().cell(['a'], -1)).toBeUndefined();
  });
});
