/**
 * The season standings, and the repeat group that makes them decodable.
 *
 * Default lane. The layouts, the sentinels and the published gaps are quoted
 * from the corpus; the riders are invented.
 */

import { describe, expect, it } from 'vitest';
import {
  decodeSeasonIndividual,
  decodeSeasonTeam,
  isDegenerateTeamSeason,
  UPGRADE,
  type SeasonTeamRow,
} from './decode-season.ts';
import { SEASON_INDIVIDUAL, SEASON_TEAM } from './families.ts';
import { DecodeError, type ListPayload } from './rows.ts';

const BEST_OF = '#[RacesToDrop]/[EVENT.NumberOfRacesInSeason]';
const teamRacePoints = (n: number) =>
  `choose([Division];[TS10${n}.TIME1];[TS20${n}.TIME1];[TS30${n}.TIME1])`;
const TEAM_RANK =
  'switch([TS197.RANK]>0;[TS197.RANK];[TS297.RANK]>0;[TS297.RANK];[TS397.RANK]>0;[TS397.RANK])';
const TEAM_TOTAL =
  'switch([TS197.RANK]>0;[TS197.TIME1];[TS297.RANK]>0;[TS297.TIME1];[TS397.RANK]>0;[TS397.TIME1])';

const variantOf = (family: { variants: readonly { name: string }[] }, name: string) =>
  family.variants.find((variant) => variant.name === name)! as never;

const FINAL = variantOf(SEASON_INDIVIDUAL, 'final-2025');
const SNAPSHOT = variantOf(SEASON_INDIVIDUAL, 'snapshot-2025');

/** The Race 4 North layout: RACE1..RACE4, LOW SCORE present. */
function northFinal(rows: string[][]): ListPayload {
  return {
    list: { ListFooterText: '', Fields: [] },
    DataFields: [
      'BIB',
      'ID',
      'SeasonPlace',
      'DisplayBib',
      'ucase([DisplayName])',
      'CLUB',
      BEST_OF,
      'LowScore',
      'BonusTotal',
      'DisplayUpgrades(1)',
      'DisplayUpgrades(2)',
      'DisplayUpgrades(3)',
      'DisplayUpgrades(4)',
      'T1010',
      'LowScoreFormatting(1)',
      'LowScoreFormatting(2)',
      'LowScoreFormatting(3)',
      'LowScoreFormatting(4)',
    ],
    data: { '#1_Varsity Girls - North': rows },
  };
}

/** plate, id, place, displaybib, name, club, bestof, low, bonus, r1..r4, final, fmt1..4 */
const northRow = (plate: string, points: string[], low = '500', final = '1525') => [
  plate,
  '7',
  '1',
  plate,
  `«RIDER-${plate}»`,
  'West Linn High School',
  '3/4',
  low,
  '25',
  ...points,
  final,
  'C(255,0,0)',
  'B',
  'B',
  'B',
];

describe('decodeSeasonIndividual', () => {
  it('goes long, not wide: one row per rider per published race', () => {
    const decoded = decodeSeasonIndividual(
      'a list',
      FINAL,
      northFinal([northRow('101', ['500', '500', '500', '500'])]),
    );

    expect(decoded.ordinals).toEqual([1, 2, 3, 4]);
    expect(decoded.rows[0]!.racePoints.map((race) => race.roundOrdinal)).toEqual([1, 2, 3, 4]);
  });

  it('reads a ten-wide block off the payload without being told', () => {
    // The mid-season snapshots publish RACE1..RACE10 for a season Oregon never
    // ran. An unseen RACE7 must widen the block, not halt the event.
    const wide: ListPayload = {
      list: { ListFooterText: '', Fields: [] },
      DataFields: [
        'BIB',
        'SeasonPlace',
        'ucase([DisplayName])',
        BEST_OF,
        'FinishCount',
        ...Array.from({ length: 10 }, (_, i) => `DisplayUpgrades(${i + 1})`),
      ],
      data: {
        '#1_Varsity Girls - North': [
          ['101', '1', '«RIDER-101»', '3/4', '2', '500', '490', '', '', '', '', '', '', '', ''],
        ],
      },
    };

    const decoded = decodeSeasonIndividual('a list', SNAPSHOT, wide);

    expect(decoded.ordinals).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // Only the two races that actually published a cell become rows: an absent
    // cell is not a `0`, and `0` is a real published value meaning a DNS.
    expect(decoded.rows[0]!.racePoints).toHaveLength(2);
  });

  it('keeps a published 0, which means the rider did not start', () => {
    const decoded = decodeSeasonIndividual(
      'a list',
      FINAL,
      northFinal([northRow('101', ['0', '490', '490', '490'], '0', '1470')]),
    );

    expect(decoded.rows[0]!.racePoints[0]).toMatchObject({ roundOrdinal: 1, points: '0' });
  });

  it('stores the Upgrade sentinel rather than refusing it or nulling it', () => {
    // A mid-season category change forfeits the points scored under the old
    // category. The source says so in words where a number would go.
    const decoded = decodeSeasonIndividual(
      'a list',
      FINAL,
      northFinal([northRow('101', [UPGRADE, '500', '500', '490'], '0', '1515')]),
    );

    const first = decoded.rows[0]!.racePoints[0]!;
    expect(first.points).toBe('Upgrade');
    expect(first.isUpgrade).toBe(true);
  });

  it('marks the dropped race from the formatting hint', () => {
    const decoded = decodeSeasonIndividual(
      'a list',
      FINAL,
      northFinal([northRow('101', ['500', '500', '500', '500'])]),
    );

    expect(decoded.rows[0]!.racePoints.map((race) => race.isDropped)).toEqual([
      true,
      false,
      false,
      false,
    ]);
  });

  it('leaves a missing LOW SCORE null, and never infers it from min()', () => {
    // Event 363500 omits the column entirely. Its FINAL still has the drop
    // applied; the value the league dropped is simply not published there.
    const south = northFinal([northRow('101', ['472', '490', '490', '481'], '', '1486')]);
    south.DataFields = (south.DataFields as string[]).filter((f) => f !== 'LowScore');
    south.data = {
      '#1_Varsity Boys - South': [
        northRow('101', ['472', '490', '490', '481'], '', '1486').filter((_, i) => i !== 7),
      ],
    };

    const decoded = decodeSeasonIndividual('a list', FINAL, south);

    expect(decoded.rows[0]!.lowScore).toBeNull();
    expect(decoded.rows[0]!.final).toBe(1486);
    expect(Math.min(...[472, 490, 490, 481])).toBe(472); // what it must NOT store
  });

  it('reads the published drop rule and the bonus verbatim', () => {
    const row = decodeSeasonIndividual(
      'a list',
      FINAL,
      northFinal([northRow('101', ['500', '500', '500', '500'])]),
    ).rows[0]!;

    expect(row.bestOf).toBe('3/4');
    expect(row.bonusTotal).toBe(25);
    expect(row.final).toBe(1525);
    // 500+500+500+500 - 500 + 25 = 1525, and nothing here added it up.
  });

  it('refuses a record that declares a one-race season', () => {
    // The State Champs copy publishes BEST OF 1/1 and supersedes nothing. If a
    // layout change ever let it match the record variant, this stops it.
    const degenerate = northFinal([northRow('101', ['500', '', '', ''], '0', '25')]);
    degenerate.data = {
      '#1_Varsity Girls': [
        [
          '101',
          '7',
          '1',
          '101',
          '«RIDER-101»',
          'A',
          '1/1',
          '0',
          '25',
          '500',
          '',
          '',
          '',
          '25',
          'B',
          'B',
          'B',
          'B',
        ],
      ],
    };

    expect(() => decodeSeasonIndividual('a list', FINAL, degenerate)).toThrow(DecodeError);
    expect(() => decodeSeasonIndividual('a list', FINAL, degenerate)).toThrow(/one-race season/);
  });

  it('refuses a list that publishes no per-race block at all', () => {
    const empty = northFinal([]);
    empty.DataFields = (empty.DataFields as string[]).filter(
      (f) => !f.startsWith('DisplayUpgrades'),
    );

    expect(() => decodeSeasonIndividual('a list', FINAL, empty)).toThrow(
      /no per-race points block/,
    );
  });
});

describe('decodeSeasonTeam', () => {
  const finalPayload = (rows: string[][]): ListPayload => ({
    list: { ListFooterText: '', Fields: [] },
    DataFields: [
      'BIB',
      'ID',
      TEAM_RANK,
      'CLUB',
      teamRacePoints(2),
      teamRacePoints(3),
      teamRacePoints(4),
      TEAM_TOTAL,
    ],
    data: { 'High School': { 'Division 1': rows } },
  });

  const decode = (payload: ListPayload) =>
    decodeSeasonTeam('a list', variantOf(SEASON_TEAM, 'final-2025'), payload, 'North');

  it('keys the per-race block by round ordinal, starting at round 2', () => {
    // The prologue does not count toward team season points, which is why the
    // published block starts at RACE 2.
    const decoded = decode(
      finalPayload([['0', '0', '1', 'Portland Metro Composite', '3834', '3594', '3692', '11120']]),
    );

    expect(decoded.ordinals).toEqual([2, 3, 4]);
    expect(decoded.rows[0]!.racePoints).toEqual({ '2': 3834, '3': 3594, '4': 3692 });
    expect(decoded.rows[0]!.seasonTotal).toBe(11120);
  });

  it('leaves an empty per-race cell absent rather than making it zero', () => {
    // Three South teams publish an empty RACE 4 where that race's own list
    // publishes 0. The published season list wins; do not substitute.
    const decoded = decode(
      finalPayload([['0', '0', '9', 'Tualatin High School', '120', '96', '', '216']]),
    );

    expect(decoded.rows[0]!.racePoints).toEqual({ '2': 120, '3': 96 });
    expect('4' in decoded.rows[0]!.racePoints).toBe(false);
  });

  it('carries the event conference, which is the standing key', () => {
    const decoded = decode(finalPayload([['0', '0', '1', 'A', '1', '2', '3', '6']]));

    expect(decoded.rows[0]!.conference).toBe('North');
    expect(decoded.rows[0]!.division).toBe('Division 1');
  });
});

describe('isDegenerateTeamSeason', () => {
  const team = (seasonTotal: number | null): SeasonTeamRow => ({
    conference: null,
    scoringTeam: 'A',
    division: 'Division 1',
    place: '1',
    racePoints: {},
    seasonTotal,
  });

  it('recognizes the State Champs copy, which shape alone cannot', () => {
    // Its layout is byte-identical to the final one; only SEASON = 0 on every
    // row gives it away.
    expect(isDegenerateTeamSeason([team(0), team(0), team(null)])).toBe(true);
  });

  it('leaves a real standing alone', () => {
    expect(isDegenerateTeamSeason([team(11120), team(0)])).toBe(false);
    expect(isDegenerateTeamSeason([])).toBe(false);
  });
});
