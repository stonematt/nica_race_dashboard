/**
 * The orchestrator: what it refuses, and what it leaves behind when it does.
 *
 * Default lane. The archive here is built from synthetic payloads — the shapes
 * are the corpus's, the rows are invented. The real corpus decoding is
 * `normalize.local.test.ts`.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../db/schema.ts';
import { createTestDb, type TestDatabase } from '../db/testing.ts';
import { CONFIG_LIST_NAME, archive } from './raw.ts';
import { countRows } from './decode.ts';
import { normalize, NormalizeError } from './normalize.ts';
import { buildSnapshot } from './snapshot.ts';

const PLACE_2025 =
  'if(if([TransgenderOption]="Redundancy";[RANK5];[RANK1])>0;if([STATUS]<2;if([TransgenderOption]="Redundancy";[RANK5];[RANK1]);[TimeOrStatus]);"*")';
const NAME_2025 = 'ucase([DisplayName]) & iif([RANK2]=1 AND [ShowPoints]=1;" (PTS LEADER)";"")';

const FLAT_FIELDS = [
  'BIB',
  'ID',
  PLACE_2025,
  NAME_2025,
  'CLUB',
  'DisplayPoints',
  'DisplayLapTime(1)',
  'TimeOrStatus',
];
const row = (plate: string, place: string) => [
  plate,
  '1',
  place,
  `«RIDER-${plate}»`,
  'Salem Composite',
  '500',
  '19:27',
  '39:37.12',
];

const TT_FIELDS = [
  'BIB',
  'ID',
  'RankOrStatusTT',
  'FIRSTNAME',
  'LASTNAME',
  'CLUB',
  'Start.TOD',
  'End.TOD',
  'TIME',
];
const ttRow = (plate: string) => [
  plate,
  '1',
  '1',
  'RIDER',
  plate,
  'Salem Composite',
  '',
  '',
  '40:00.00',
];

const BY_TEAM_FIELDS = ['BIB', 'SexMF', 'Grade', 'iif([TS.SCORED]=1;"B;")', 'TimeOrStatus'];

function config(eventId: string, lists: { ID: string; Name: string; Mode?: string }[]) {
  return {
    key: 'k',
    eventname: `Race 2 - ORLeague Moore Fun - North`,
    lists: lists.map((list) => ({ Mode: '', ...list })),
  };
}

function listPayload(dataFields: string[], data: unknown, footer = '') {
  return {
    list: { ListName: 'x', ListFooterText: footer, Fields: [] },
    DataFields: dataFields,
    data,
  };
}

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDb();
});

async function seed(records: Parameters<typeof archive>[1]) {
  await archive(db, records);
}

const configRecord = (eventId: string, payload: unknown) => ({
  season: 2025,
  eventId,
  listId: null,
  listName: CONFIG_LIST_NAME,
  url: 'https://example.invalid/config',
  httpStatus: 200,
  payload,
});

const listRecord = (eventId: string, listId: string, payload: unknown) => ({
  season: 2025,
  eventId,
  listId,
  listName: `list ${listId}`,
  url: 'https://example.invalid/list',
  httpStatus: 200,
  payload,
});

describe('countRows', () => {
  it('counts rows at any nesting depth', () => {
    expect(countRows({ a: [[1], [2]], b: [[3]] })).toBe(3);
    expect(countRows({ a: { b: { c: [[1], [2]] } } })).toBe(2);
    expect(countRows({})).toBe(0);
  });
});

describe('normalize', () => {
  it('decodes an event, building its place in the calendar', async () => {
    await seed([
      configRecord('359478', config('359478', [{ ID: 'AAA111', Name: 'flat' }])),
      listRecord(
        '359478',
        'AAA111',
        listPayload(FLAT_FIELDS, { '#1_HS1 Boys - North': [row('101', '1'), row('102', '2')] }),
      ),
    ]);

    const result = await normalize(db);

    expect(result).toMatchObject({
      events: 1,
      lists: 1,
      decodedLists: 1,
      skipped: 0,
      individualRows: 2,
    });
    expect(await db.select().from(schema.event)).toHaveLength(1);
    expect(await db.select().from(schema.individualResult)).toHaveLength(2);
  });

  it('changes no rows on a second run', async () => {
    await seed([
      configRecord('359478', config('359478', [{ ID: 'AAA111', Name: 'flat' }])),
      listRecord(
        '359478',
        'AAA111',
        listPayload(FLAT_FIELDS, { '#1_HS1 Boys - North': [row('101', '1')] }),
      ),
    ]);

    await normalize(db);
    const first = await db.select().from(schema.individualResult);
    await normalize(db);
    const second = await db.select().from(schema.individualResult);

    expect(second).toEqual(first);
    expect(second).toHaveLength(1);
  });

  it('decodes the latest archived payload, which is how a correction lands', async () => {
    await seed([
      configRecord('359478', config('359478', [{ ID: 'AAA111', Name: 'flat' }])),
      listRecord(
        '359478',
        'AAA111',
        listPayload(FLAT_FIELDS, { '#1_HS1 Boys - North': [row('101', '1')] }),
      ),
    ]);
    await seed([
      listRecord(
        '359478',
        'AAA111',
        listPayload(FLAT_FIELDS, { '#1_HS1 Boys - North': [row('101', '2')] }),
      ),
    ]);

    await normalize(db);

    const [result] = await db.select().from(schema.individualResult);
    expect(result!.place).toBe('2');
    // Both payloads are still archived — raw only ever appends.
    expect(await db.select().from(schema.rawFetch)).toHaveLength(3);
  });

  it('recognizes a list it does not decode, and counts it as skipped', async () => {
    await seed([
      configRecord(
        '359478',
        config('359478', [
          { ID: 'AAA111', Name: 'flat' },
          { ID: 'BBB222', Name: 'by team' },
        ]),
      ),
      listRecord(
        '359478',
        'AAA111',
        listPayload(FLAT_FIELDS, { '#1_HS1 Boys - North': [row('101', '1')] }),
      ),
      listRecord(
        '359478',
        'BBB222',
        listPayload(BY_TEAM_FIELDS, {
          hs: { d1: { team: [['101', 'M', '9', 'B;', '39:37.12']] } },
        }),
      ),
    ]);

    const result = await normalize(db);

    expect(result).toMatchObject({ lists: 2, decodedLists: 1, skipped: 1, individualRows: 1 });
  });

  it('takes the published list when the time trial is hidden beside it', async () => {
    // 2025 Race 2 North and State Champs each carry a mass-start list and a
    // time-trial re-render of the same field. The league hid the latter.
    await seed([
      configRecord(
        '359478',
        config('359478', [
          { ID: 'AAA111', Name: 'flat' },
          { ID: 'TTT333', Name: 'prologue', Mode: 'hidden' },
        ]),
      ),
      listRecord(
        '359478',
        'AAA111',
        listPayload(FLAT_FIELDS, { '#1_HS1 Boys - North': [row('101', '1')] }),
      ),
      listRecord(
        '359478',
        'TTT333',
        listPayload(TT_FIELDS, { '#1_HS1 Boys - North': [ttRow('101'), ttRow('102')] }),
      ),
    ]);

    const result = await normalize(db);

    expect(result.individualRows).toBe(1);
    // The hidden list is still recognized and reported, just not decoded.
    expect(result).toMatchObject({ lists: 2, decodedLists: 1, skipped: 1 });
    const [stored] = await db.select().from(schema.individualResult);
    expect(stored!.timeRaw).toBe('39:37.12');
  });

  it('takes the time trial where it is the published list, as at Race 1', async () => {
    await seed([
      configRecord('357242', config('357242', [{ ID: 'TTT333', Name: 'prologue' }])),
      listRecord(
        '357242',
        'TTT333',
        listPayload(TT_FIELDS, { '#1_HS1 Boys - North': [ttRow('101')] }),
      ),
    ]);

    expect((await normalize(db)).individualRows).toBe(1);
  });

  it('classifies the expressions of a list it drops, not only the one it decodes', async () => {
    // The Mode tie-break drops a list; it must not drop it out of strict
    // unknown-expression fatality too. Otherwise the corpus is only partly
    // classified and the next layout change hides behind a hidden list.
    await seed([
      configRecord(
        '359478',
        config('359478', [
          { ID: 'AAA111', Name: 'flat' },
          { ID: 'TTT333', Name: 'prologue', Mode: 'hidden' },
        ]),
      ),
      listRecord(
        '359478',
        'AAA111',
        listPayload(FLAT_FIELDS, { '#1_HS1 Boys - North': [row('101', '1')] }),
      ),
      listRecord(
        '359478',
        'TTT333',
        listPayload([...TT_FIELDS, 'SomethingNew'], {
          '#1_HS1 Boys - North': [[...ttRow('101'), 'x']],
        }),
      ),
    ]);

    await expect(normalize(db)).rejects.toThrow(/unrecognized expression\(s\): SomethingNew/);
  });

  it('does not classify the expressions of a family it has no decoder for', async () => {
    // #25's families are recognized by signature only. Halting on their
    // unclassified columns would make this ticket unlandable.
    await seed([
      configRecord(
        '359478',
        config('359478', [
          { ID: 'AAA111', Name: 'flat' },
          { ID: 'BBB222', Name: 'by team' },
        ]),
      ),
      listRecord(
        '359478',
        'AAA111',
        listPayload(FLAT_FIELDS, { '#1_HS1 Boys - North': [row('101', '1')] }),
      ),
      listRecord(
        '359478',
        'BBB222',
        listPayload([...BY_TEAM_FIELDS, 'DisplayPoints'], {
          hs: { d1: { team: [['101', 'M', '9', 'B;', '39:37.12', '500']] } },
        }),
      ),
    ]);

    expect((await normalize(db)).skipped).toBe(1);
  });

  it('is fatal when two published lists claim the same family', async () => {
    await seed([
      configRecord(
        '359478',
        config('359478', [
          { ID: 'AAA111', Name: 'flat' },
          { ID: 'TTT333', Name: 'prologue' },
        ]),
      ),
      listRecord(
        '359478',
        'AAA111',
        listPayload(FLAT_FIELDS, { '#1_HS1 Boys - North': [row('101', '1')] }),
      ),
      listRecord(
        '359478',
        'TTT333',
        listPayload(TT_FIELDS, { '#1_HS1 Boys - North': [ttRow('101')] }),
      ),
    ]);

    await expect(normalize(db)).rejects.toThrow(/Exactly one must be/);
  });

  it('is fatal when an event has no archived config', async () => {
    await seed([
      listRecord(
        '359478',
        'AAA111',
        listPayload(FLAT_FIELDS, { '#1_HS1 Boys - North': [row('101', '1')] }),
      ),
    ]);

    await expect(normalize(db)).rejects.toThrow(NormalizeError);
    await expect(normalize(db)).rejects.toThrow(/no archived config/);
  });

  it('is fatal when an event publishes no flat individual list', async () => {
    await seed([
      configRecord('359478', config('359478', [{ ID: 'BBB222', Name: 'by team' }])),
      listRecord(
        '359478',
        'BBB222',
        listPayload(BY_TEAM_FIELDS, {
          hs: { d1: { team: [['101', 'M', '9', 'B;', '39:37.12']] } },
        }),
      ),
    ]);

    await expect(normalize(db)).rejects.toThrow(/no flat individual list/);
  });

  it('writes nothing at all for an event it cannot decode', async () => {
    // Whole-event halt: no partial ingest, no nulls, and no calendar row left
    // pointing at a race day that has no results.
    await seed([
      configRecord('359478', config('359478', [{ ID: 'AAA111', Name: 'flat' }])),
      listRecord(
        '359478',
        'AAA111',
        listPayload([...FLAT_FIELDS, 'SomethingNew'], {
          '#1_HS1 Boys - North': [[...row('101', '1'), 'x']],
        }),
      ),
    ]);

    await expect(normalize(db)).rejects.toThrow(/unrecognized expression/);
    expect(await db.select().from(schema.event)).toHaveLength(0);
    expect(await db.select().from(schema.individualResult)).toHaveLength(0);
    expect(await db.select().from(schema.season)).toHaveLength(0);
  });

  it('leaves an already-decoded event alone when a later one fails', async () => {
    await seed([
      configRecord('359477', config('359477', [{ ID: 'AAA111', Name: 'flat' }])),
      listRecord(
        '359477',
        'AAA111',
        listPayload(FLAT_FIELDS, { '#1_HS1 Boys - North': [row('101', '1')] }),
      ),
      configRecord('359478', config('359478', [{ ID: 'BBB222', Name: 'flat' }])),
      listRecord(
        '359478',
        'BBB222',
        listPayload([...FLAT_FIELDS, 'SomethingNew'], {
          '#1_HS1 Boys - North': [[...row('201', '1'), 'x']],
        }),
      ),
    ]);

    await expect(normalize(db)).rejects.toThrow(/unrecognized expression/);

    // The good event is complete; the bad one is entirely absent.
    expect(await db.select().from(schema.event)).toHaveLength(1);
    const results = await db.select().from(schema.individualResult);
    expect(results.map((r) => r.plate)).toEqual(['101']);
  });

  it('is fatal on a list that matches no declared family', async () => {
    await seed([
      configRecord(
        '359478',
        config('359478', [
          { ID: 'AAA111', Name: 'flat' },
          { ID: 'ZZZ999', Name: 'mystery' },
        ]),
      ),
      listRecord(
        '359478',
        'AAA111',
        listPayload(FLAT_FIELDS, { '#1_HS1 Boys - North': [row('101', '1')] }),
      ),
      listRecord('359478', 'ZZZ999', listPayload(['BIB', 'Something'], { g: [['1', 'x']] })),
    ]);

    await expect(normalize(db)).rejects.toThrow(/matches no declared family/);
  });
});

describe('the snapshot a run produces', () => {
  it('records the family assignment, the expressions and the row counts', async () => {
    await seed([
      configRecord(
        '359478',
        config('359478', [
          { ID: 'AAA111', Name: 'flat' },
          { ID: 'BBB222', Name: 'by team' },
        ]),
      ),
      listRecord(
        '359478',
        'AAA111',
        listPayload(FLAT_FIELDS, { '#1_HS1 Boys - North': [row('101', '1')] }),
      ),
      listRecord(
        '359478',
        'BBB222',
        listPayload(BY_TEAM_FIELDS, {
          hs: { d1: { team: [['101', 'M', '9', 'B;', '39:37.12']] } },
        }),
      ),
    ]);

    const snapshot = buildSnapshot((await normalize(db)).placed);

    expect(snapshot.version).toBe(1);
    const flat = snapshot.families.find((family) => family.name === 'individual_flat')!;
    expect(flat.hasDecoder).toBe(true);
    expect(flat.lists).toHaveLength(1);
    expect(flat.lists[0]).toMatchObject({
      eventId: '359478',
      listId: 'AAA111',
      rows: 1,
      decoded: true,
    });
    expect(flat.expressions).toEqual([...FLAT_FIELDS].sort());

    const byTeam = snapshot.families.find((family) => family.name === 'individual_by_team')!;
    expect(byTeam.hasDecoder).toBe(false);
    expect(byTeam.lists[0]!.decoded).toBe(false);
  });

  it('carries no rider data — only expressions, ids and counts', async () => {
    await seed([
      configRecord('359478', config('359478', [{ ID: 'AAA111', Name: 'flat' }])),
      listRecord(
        '359478',
        'AAA111',
        listPayload(FLAT_FIELDS, { '#1_HS1 Boys - North': [row('101', '1')] }),
      ),
    ]);

    const serialized = JSON.stringify(buildSnapshot((await normalize(db)).placed));

    // The synthetic name and the plate are both in the payload; neither may
    // reach an artifact that gets committed and diffed in CI.
    expect(serialized).not.toContain('«RIDER-101»');
    expect(serialized).not.toContain('39:37.12');
    expect(serialized).not.toContain('Salem Composite');
  });
});
