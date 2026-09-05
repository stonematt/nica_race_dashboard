/**
 * The decoder's refusals and its three permitted transformations.
 *
 * Default lane. Every payload here is synthetic — the plates are made up and
 * the names are the pseudonym form docs/fixtures.md uses. What is real is the
 * *shape*: the expressions, the sentinels, the widths and the footers are
 * quoted from the corpus, because those are what the assertions are about.
 * Fidelity against real rows is `normalize.local.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { CategoryError } from './category.ts';
import { ColumnError } from './columns.ts';
import {
  DecodeError,
  dataDepth,
  decodeIndividualFlat,
  parseTimeSeconds,
  publishedRowCount,
  type ListPayload,
} from './decode.ts';
import { INDIVIDUAL_FLAT } from './families.ts';

const PLACE_2025 =
  'if(if([TransgenderOption]="Redundancy";[RANK5];[RANK1])>0;if([STATUS]<2;if([TransgenderOption]="Redundancy";[RANK5];[RANK1]);[TimeOrStatus]);"*")';
const NAME_2025 = 'ucase([DisplayName]) & iif([RANK2]=1 AND [ShowPoints]=1;" (PTS LEADER)";"")';

const MASS_START_FIELDS = [
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

/** plate, id, place, name, club, pts, lap1..4, pen, time, leader-flag */
const winner = [
  '101',
  '7',
  '1',
  '«RIDER-A»',
  'Salem Composite',
  '500',
  '19:27',
  '20:10',
  '-',
  '-',
  '',
  '39:37.12',
  '',
];
const lapped = [
  '102',
  '8',
  '44',
  '«RIDER-B»',
  'Sprague High School Descenders',
  '412',
  '25:00',
  '-',
  '-',
  '-',
  '',
  '25:00.00',
  '',
];
const dnf = [
  '103',
  '9',
  '*',
  '«RIDER-C»',
  'Salem Composite',
  '0',
  '18:00',
  '-',
  '-',
  '-',
  '05:00',
  'DNF',
  '',
];

const massStart = (rows: string[][] = [winner, lapped, dnf], footer = ''): ListPayload => ({
  list: { ListName: 'x|Individual Results - North', ListFooterText: footer, Fields: [] },
  DataFields: MASS_START_FIELDS,
  data: { '#1_HS1 Boys - North': rows },
});

const variant = INDIVIDUAL_FLAT.variants[0]!;
const decode = (payload: ListPayload) => decodeIndividualFlat('a list', variant, payload);

describe('dataDepth', () => {
  it('measures the grouping above the rows', () => {
    expect(dataDepth({ a: [[1]] })).toBe(1);
    expect(dataDepth({ a: { b: { c: [[1]] } } })).toBe(3);
    expect(dataDepth([[1]])).toBe(0);
  });

  it('reports an unmeasurable shape rather than guessing at 0', () => {
    // An empty `data` is the degenerate list. It must not read as depth 1.
    expect(dataDepth({})).toBe(-1);
    expect(dataDepth(null)).toBe(-1);
  });
});

describe('publishedRowCount', () => {
  it('reads the count the source prints', () => {
    expect(publishedRowCount('Number of records: 423')).toBe(423);
  });

  it('is null where the source printed no footer', () => {
    // Populated across 2025, empty at the prologue and at the 2026 opener.
    expect(publishedRowCount('')).toBeNull();
    expect(publishedRowCount(undefined)).toBeNull();
  });
});

describe('parseTimeSeconds', () => {
  it('parses both published time shapes', () => {
    expect(parseTimeSeconds('39:37.12')).toBeCloseTo(2377.12);
    expect(parseTimeSeconds('1:02:27.89')).toBeCloseTo(3747.89);
    expect(parseTimeSeconds('48:14.3')).toBeCloseTo(2894.3);
    expect(parseTimeSeconds('0:00.00')).toBe(0);
  });

  it('is null for a status, not zero', () => {
    // A DNF with a 0 would sort as the fastest rider in the field.
    expect(parseTimeSeconds('DNF')).toBeNull();
    expect(parseTimeSeconds('')).toBeNull();
  });
});

describe('decodeIndividualFlat', () => {
  it('lands place, points and time exactly as published', () => {
    const [first] = decode(massStart()).rows;

    expect(first!.place).toBe('1');
    expect(first!.points).toBe(500);
    expect(first!.timeRaw).toBe('39:37.12');
    expect(first!.plate).toBe('101');
    expect(first!.scoringTeam).toBe('Salem Composite');
  });

  it('keeps the DNF sentinels verbatim and marks the status', () => {
    const row = decode(massStart()).rows[2]!;

    expect(row.place).toBe('*');
    expect(row.timeRaw).toBe('DNF');
    expect(row.status).toBe('dnf');
    expect(row.timeSeconds).toBeNull();
    expect(row.penalty).toBe('05:00');
  });

  it('never writes `lapped`, because one row cannot know it', () => {
    // Lapped-ness needs the category's leading lap count. v_race_result derives
    // it; ingest writes only what a single row can say.
    expect(decode(massStart()).rows.map((row) => row.status)).toEqual([
      'finished',
      'finished',
      'dnf',
    ]);
  });

  it('stores the source row id for provenance and never as a key', () => {
    expect(decode(massStart()).rows[0]!.sourceRowId).toBe('7');
    expect(decode(massStart()).rows[0]!.plate).toBe('101');
  });

  it('keeps a lap sentinel verbatim and an empty cell as null', () => {
    const row = decode(massStart()).rows[0]!;

    expect(row.lap1).toBe('19:27');
    expect(row.lap3).toBe('-');
    expect(row.penalty).toBeNull();
  });

  it('recovers the lap count by counting splits where the column is absent', () => {
    const rows = decode(massStart()).rows;

    expect(rows[0]!.laps).toBe(2);
    expect(rows[1]!.laps).toBe(1);
  });

  it('takes the published lap count where the source prints one', () => {
    // NumberOfLaps is published at only 4 of the 8 2025 events. Where it is
    // there it wins outright: a count that disagrees with the splits is still
    // the league's count, and NICA is the authority.
    const payload: ListPayload = {
      list: { ListFooterText: '', Fields: [] },
      DataFields: [...MASS_START_FIELDS.slice(0, 12), 'NumberOfLaps'],
      data: { '#1_HS1 Boys - North': [[...winner.slice(0, 12), '9']] },
    };

    expect(decode(payload).rows[0]!.laps).toBe(9);
  });

  it('normalizes the category and keeps the raw string beside it', () => {
    const payload = massStart();
    payload.data = { '#21_HS2 Boys- South': [winner] };
    const row = decode(payload).rows[0]!;

    expect(row.categoryRaw).toBe('HS2 Boys- South');
    expect(row.categoryLevel).toBe('HS2 Boys');
    expect(row.categoryGradeBand).toBe('HS2');
    expect(row.conference).toBe('South');
  });

  it('is fatal on an unrecognized expression', () => {
    // Strict, pre-v1. Recognized means mapped or explicitly ignored.
    const payload = massStart();
    payload.DataFields = [...MASS_START_FIELDS, 'SomethingNew'];
    payload.data = { '#1_HS1 Boys - North': [[...winner, 'x']] };

    expect(() => decode(payload)).toThrow(DecodeError);
    expect(() => decode(payload)).toThrow(/unrecognized expression\(s\): SomethingNew/);
  });

  it('is fatal when a required field resolves to no column', () => {
    const payload = massStart();
    payload.DataFields = MASS_START_FIELDS.filter((f) => f !== 'CLUB');
    payload.data = { '#1_HS1 Boys - North': [winner.filter((_, i) => i !== 4)] };

    expect(() => decode(payload)).toThrow(/required field\(s\) scoringTeam/);
  });

  it('is fatal when a row is not DataFields wide', () => {
    expect(() => decode(massStart([winner.slice(0, 12)]))).toThrow(ColumnError);
  });

  it('is fatal when the decoded count disagrees with the published footer', () => {
    expect(() => decode(massStart([winner], 'Number of records: 2'))).toThrow(
      /decoded 1 rows but the source footer says 2/,
    );
  });

  it('accepts a count that agrees', () => {
    expect(decode(massStart([winner, lapped], 'Number of records: 2')).rows).toHaveLength(2);
  });

  it('is fatal when two rows share a plate', () => {
    // The plate is the row key for an event; a collision would silently drop a
    // published result on the upsert.
    expect(() => decode(massStart([winner, [...winner]]))).toThrow(/distinct plates/);
  });

  it('is fatal on a category it does not recognize', () => {
    const payload = massStart();
    payload.data = { '#1_HS4 Boys - North': [winner] };

    expect(() => decode(payload)).toThrow(CategoryError);
  });

  it('joins a split name, which is how the 2025 prologue publishes one', () => {
    const payload: ListPayload = {
      list: { ListFooterText: '', Fields: [] },
      DataFields: [
        'BIB',
        'ID',
        'RankOrStatusTT',
        'FIRSTNAME',
        'LASTNAME',
        'CLUB',
        'Start.TOD',
        'End.TOD',
        'if([TT_Rank]>0;[T1025])',
        'if([T20]>0;[TIME20])',
        'TIME',
      ],
      data: {
        '#1_Varsity Girls - North': [
          ['6', '5', 'DNF', 'RIDER', 'A', 'Salem Composite', '', '', '', '', '38:47.84'],
        ],
      },
    };

    const row = decodeIndividualFlat('a list', INDIVIDUAL_FLAT.variants[1]!, payload).rows[0]!;
    expect(row.displayName).toBe('RIDER A');
    // The time trial publishes a real time for a DNF; the place is the sentinel.
    expect(row.place).toBe('DNF');
    expect(row.status).toBe('dnf');
    expect(row.timeRaw).toBe('38:47.84');
    expect(row.points).toBeNull();
    // No lap columns at all, so no lap count to recover.
    expect(row.laps).toBeNull();
  });

  it('reports the layout it decoded, for the snapshot', () => {
    const decoded = decode(massStart([winner], 'Number of records: 1'));

    expect(decoded.variant).toBe(variant);
    expect(decoded.expressions).toEqual(MASS_START_FIELDS);
    expect(decoded.publishedCount).toBe(1);
  });
});
