/**
 * The three per-race sidecars. Default lane — the shapes are quoted from the
 * corpus, the rows are invented, and the names are the `«RIDER-A»` pseudonym
 * form docs/fixtures.md uses.
 */

import { describe, expect, it } from 'vitest';
import {
  decodeByTeam,
  decodeTeamCounter,
  decodeTeamRace,
  normalizeGrade,
  parseTeamNode,
} from './decode-team.ts';
import { INDIVIDUAL_BY_TEAM, TEAM_RACE_COUNTER, TEAM_RACE_RESULT } from './families.ts';
import { DecodeError, type ListPayload } from './rows.ts';

const TEAM_PLACE = 'choose([Division];[TS1.POSITION];[TS2.POSITION];[TS3.POSITION])';

const payloadOf = (DataFields: string[], data: unknown, footer = ''): ListPayload => ({
  list: { ListFooterText: footer, Fields: [] },
  DataFields,
  data,
});

describe('normalizeGrade', () => {
  it('absorbs the published format drift', () => {
    // "9.0" at Race 1 and Race 2 South, "9" elsewhere. One rider, one grade.
    expect(normalizeGrade('a list', '9.0')).toBe('9');
    expect(normalizeGrade('a list', '9')).toBe('9');
    expect(normalizeGrade('a list', '12.0')).toBe('12');
  });

  it('leaves a blank grade unknown rather than making it a number', () => {
    // Six rows across the season publish nothing. A rider with no published
    // grade has no grade here — inventing one would be the opposite of ingest.
    expect(normalizeGrade('a list', null)).toBeNull();
    expect(normalizeGrade('a list', '   ')).toBeNull();
  });

  it('refuses a grade that is neither a year nor blank', () => {
    expect(() => normalizeGrade('a list', 'Freshman')).toThrow(DecodeError);
    expect(() => normalizeGrade('a list', '9.5')).toThrow(/neither a year nor blank/);
  });
});

describe('parseTeamNode', () => {
  const node = '1.///Portland Metro Composite///3834 Points /// Penalty Points: 0';

  it('splits the real packed string, penalty tail included', () => {
    expect(parseTeamNode('a list', node)).toEqual({
      rank: '1',
      scoringTeam: 'Portland Metro Composite',
      points: 3834,
      penaltyPoints: 0,
    });
  });

  it('reads a nonzero penalty out of the tail', () => {
    const penalised = '4.///Sherwood High School///1807 Points /// Penalty Points: 25';

    expect(parseTeamNode('a list', penalised)).toMatchObject({ points: 1807, penaltyPoints: 25 });
  });

  it('handles a zero-scoring team, which State Champs publishes twenty of', () => {
    expect(
      parseTeamNode('a list', '1.///Corvallis Composite///0 Points /// Penalty Points: 0'),
    ).toMatchObject({ scoringTeam: 'Corvallis Composite', points: 0 });
  });

  it('refuses a node it cannot split, because nothing else names the team', () => {
    expect(() => parseTeamNode('a list', 'Portland Metro Composite')).toThrow(DecodeError);
    expect(() => parseTeamNode('a list', 'a///b///c')).toThrow(/splits into 3 parts/);
    expect(() => parseTeamNode('a list', '1.///Team///lots of points///Penalty Points: 0')).toThrow(
      /does not carry/,
    );
  });
});

describe('decodeByTeam', () => {
  const fields = [
    'BIB',
    'ID',
    TEAM_PLACE,
    'if([TransgenderOption]="Redundancy";[RANK5];[RANK1])',
    'DisplayBib',
    'ucase([DisplayName])',
    'CONTEST.NAME',
    'SexMF',
    'Grade',
    'DisplayPoints',
    'DisplayLapTime(1)',
    'DisplayLapTime(2)',
    'DisplayLapTime(3)',
    'DisplayLapTime(4)',
    'DisplayLapTime(5)',
    'TIME20',
    'TimeOrStatus',
    'iif([TS.SCORED]=1;"B;")',
  ];
  const row = (plate: string, scored: string, grade = '9.0') => [
    plate,
    '7',
    '2',
    '5',
    plate,
    `«RIDER-${plate}»`,
    'HS1 Boys - North',
    'M',
    grade,
    '481',
    '19:27',
    '20:10',
    '-',
    '-',
    '',
    '00:00',
    '41:02.15',
    scored,
  ];
  const payload = (rows: string[][] = [row('101', 'B;'), row('102', '')]) =>
    payloadOf(fields, {
      'High School': { 'Division 2': { 'Sprague High School Descenders': rows } },
    });

  const decode = (p: ListPayload) => decodeByTeam('a list', INDIVIDUAL_BY_TEAM.variants[0]!, p);

  it('reads the scored flag, which is how a counting rider is marked', () => {
    const rows = decode(payload()).rows;

    expect(rows[0]!.scored).toBe(true);
    expect(rows[1]!.scored).toBe(false);
  });

  it('takes the category from the row, never from the team group label', () => {
    // The By-Team group label is the team, and it carries whitespace defects of
    // its own ("Klamath Falls Composite  - D2" at Race 1).
    expect(decode(payload()).rows[0]!.categoryRaw).toBe('HS1 Boys - North');
  });

  it('normalizes the grade and keeps five lap columns', () => {
    const first = decode(payload()).rows[0]!;

    expect(first.grade).toBe('9');
    expect(first.lap1).toBe('19:27');
    expect(first.lap5).toBeNull();
  });

  it('refuses an unrecognized expression, as every family does', () => {
    expect(() =>
      decode(
        payloadOf([...fields, 'SomethingNew'], {
          'High School': { 'Division 2': { Team: [[...row('101', 'B;'), 'x']] } },
        }),
      ),
    ).toThrow(/expression\(s\) unrecognized for individual_by_team/);
  });

  it('refuses rows nested at the wrong depth', () => {
    expect(() => decode(payloadOf(fields, { 'High School': [row('101', 'B;')] }))).toThrow(
      DecodeError,
    );
  });
});

describe('decodeTeamRace', () => {
  const fields = [
    'BIB',
    'ID',
    'switch([TS199.RANK]>0;[TS199.RANK];[TS299.RANK]>0;[TS299.RANK];[TS399.RANK]>0;[TS399.RANK])',
    'CLUB',
    'ifPositive(choose([Division];[TS1.DECIMALTIME2];[TS2.DECIMALTIME2];[TS3.DECIMALTIME2]))',
    'choose([Division];[TS199.TIME1];[TS299.TIME1];[TS399.TIME1])',
  ];
  const payload = payloadOf(fields, {
    'High School': {
      'Division 1': [
        ['0', '0', '1', 'Portland Metro Composite', '', '3834'],
        ['0', '0', '2', 'Camas Composite Panthers', '', '3557'],
      ],
      'Division 2': [['0', '0', '1', 'Sherwood High School', '', '1901']],
    },
  });

  const decoded = () => decodeTeamRace('a list', TEAM_RACE_RESULT.variants[0]!, payload);

  it('keeps the division the row was nested under', () => {
    expect(decoded().rows.map((row) => row.division)).toEqual([
      'Division 1',
      'Division 1',
      'Division 2',
    ]);
  });

  it('stores an unassessed penalty as null, never as zero', () => {
    // The column exists at all 8 events and is empty in every row of 2025.
    expect(decoded().rows[0]!.penaltyPoints).toBeNull();
    expect(decoded().rows[0]!.points).toBe(3834);
  });

  it('is fatal when two rows name the same scoring team', () => {
    const clash = payloadOf(fields, {
      'High School': {
        'Division 1': [
          ['0', '0', '1', 'A', '', '1'],
          ['0', '0', '2', 'A', '', '2'],
        ],
      },
    });

    expect(() => decodeTeamRace('a list', TEAM_RACE_RESULT.variants[0]!, clash)).toThrow(
      /distinct scoring teams/,
    );
  });
});

describe('decodeTeamCounter', () => {
  const fields = [
    'BIB',
    'ID',
    TEAM_PLACE,
    'DisplayBib',
    'ucase([DisplayName])',
    'DisplayPoints',
    'SexMF',
    'CONTEST.TYPE',
    'CONTEST.NAME',
    'switch([CONTEST.TYPE]="Boys";"BG(#a4affe)";[CONTEST.TYPE]="Girls";"BG(#ffb3ee)";[CONTEST.TYPE]="Open";"BG(#fff)")',
  ];
  const row = (plate: string) => [
    plate,
    '7',
    '1',
    plate,
    `«RIDER-${plate}»`,
    '500',
    'M',
    'Boys',
    'HS1 Boys - North',
    'BG(#a4affe)',
  ];
  const payload = payloadOf(fields, {
    'High School': {
      'Division 1': {
        '1.///Portland Metro Composite///3834 Points /// Penalty Points: 0': [row('101')],
      },
    },
    'Middle School': {
      'Division 1': {
        '1.///Camas Composite Panthers///3757 Points /// Penalty Points: 0': [row('201')],
      },
    },
    '': {
      'Division 1': { '1.///Corvallis Composite///0 Points /// Penalty Points: 0': [row('301')] },
    },
  });

  const decoded = () => decodeTeamCounter('a list', TEAM_RACE_COUNTER.variants[0]!, payload).rows;

  it('keeps the middle-school rows, which no other list carries', () => {
    const ms = decoded().find((row) => row.level === 'Middle School')!;

    expect(ms.scoringTeam).toBe('Camas Composite Panthers');
    expect(ms.teamPoints).toBe(3757);
    expect(ms.plate).toBe('201');
  });

  it('reads the team, its score and its penalty out of the packed node', () => {
    const hs = decoded()[0]!;

    expect(hs.scoringTeam).toBe('Portland Metro Composite');
    expect(hs.teamPoints).toBe(3834);
    expect(hs.teamPenaltyPoints).toBe(0);
    expect(hs.division).toBe('Division 1');
  });

  it('keeps the unclassified State Champs group rather than filtering it away', () => {
    // 80 published rows over 20 team nodes, all scoring 0. Dropping them to
    // tidy a group label is a decision for a view, not for ingest.
    const unclassified = decoded().find((row) => row.level === null)!;

    expect(unclassified.plate).toBe('301');
    expect(unclassified.teamPoints).toBe(0);
  });
});
