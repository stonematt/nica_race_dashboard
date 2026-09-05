/**
 * The raw layer's two load-bearing properties: it only ever appends, and its
 * hash notices a changed value.
 *
 * Default lane — every payload here is synthetic. The properties are structural,
 * so proving them needs no real rows; `corpus.local.test.ts` proves the corpus
 * itself lands.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDatabase } from '../db/testing.ts';
import * as schema from '../db/schema.ts';
import {
  archive,
  canonicalJson,
  CONFIG_LIST_NAME,
  contentHash,
  type RawFetchRecord,
} from './raw.ts';

const payload = {
  list: { ListName: 'A|Individual Results', ListFooterText: 'Number of records: 2' },
  DataFields: ['BIB', 'CLUB', 'TIME'],
  data: { '#1_HS1 Boys': [['101', 'Salem Composite', '41:02.15']] },
};

const record: RawFetchRecord = {
  season: 2025,
  eventId: '357242',
  listId: '4F491D',
  listName: 'A|Individual Results',
  url: 'https://my.raceresult.com/357242/results/list?key=k&listname=A%7CIndividual+Results',
  httpStatus: 200,
  payload,
};

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDb();
});

describe('archive', () => {
  it('writes one row per payload, with a sha256 of the canonical payload', async () => {
    const written = await archive(db, [record]);
    expect(written).toBe(1);

    const rows = await db.select().from(schema.rawFetch);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.eventId).toBe('357242');
    expect(rows[0]!.listId).toBe('4F491D');
    expect(rows[0]!.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.contentHash).toBe(contentHash(payload));
  });

  it('stores the payload verbatim', async () => {
    await archive(db, [record]);

    const rows = await db.select().from(schema.rawFetch);
    expect(rows[0]!.payload).toEqual(payload);
  });

  it('appends: a second load writes a second row with an identical hash', async () => {
    // This is the whole point of the layer. "We checked and nothing had moved"
    // is a fact, so the second pass must not dedupe, skip, or update.
    await archive(db, [record]);
    await archive(db, [record]);

    const rows = await db.select().from(schema.rawFetch);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.contentHash).toBe(rows[1]!.contentHash);
    expect(rows[0]!.id).not.toBe(rows[1]!.id);
  });

  it('records a config fetch with a null list_id, and keeps its name and URL', async () => {
    await archive(db, [
      {
        ...record,
        listId: null,
        listName: CONFIG_LIST_NAME,
        url: 'https://my.raceresult.com/357242/RRPublish/data/config?page=results&noVisitor=1',
      },
    ]);

    const rows = await db.select().from(schema.rawFetch);
    expect(rows[0]!.listId).toBeNull();
    expect(rows[0]!.listName).toBe('config');
    expect(rows[0]!.url).toContain('RRPublish/data/config');
  });

  it('writes nothing, and issues no statement, for an empty batch', async () => {
    expect(await archive(db, [])).toBe(0);
    expect(await db.select().from(schema.rawFetch)).toHaveLength(0);
  });
});

describe('contentHash', () => {
  it('changes when a single character of a value changes', () => {
    // The entire correction-diff mechanism: one digit of one finish time.
    const corrected = structuredClone(payload);
    corrected.data['#1_HS1 Boys']![0]![2] = '41:02.16';

    expect(contentHash(corrected)).not.toBe(contentHash(payload));
  });

  it('is stable across key order and whitespace', () => {
    // Not a weakness: `payload` is jsonb, and Postgres preserves neither key
    // order nor formatting. A hash sensitive to either could not be recomputed
    // from the stored row, which would make a correction unverifiable later.
    const reordered = JSON.parse(
      JSON.stringify({ data: payload.data, DataFields: payload.DataFields, list: payload.list }),
    );

    expect(contentHash(reordered)).toBe(contentHash(payload));
  });

  it('distinguishes a value from its string form', () => {
    expect(contentHash({ points: 500 })).not.toBe(contentHash({ points: '500' }));
  });

  it('treats array order as data', () => {
    expect(canonicalJson({ a: [1, 2] })).toBe('{"a":[1,2]}');
    expect(contentHash({ a: [1, 2] })).not.toBe(contentHash({ a: [2, 1] }));
  });

  it('sorts object keys', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe('the ingest modules', () => {
  it('contain no update or delete against raw_fetch', () => {
    // A grep, deliberately. The append-only property is a property of the
    // codebase, not of one function: the moment anything under src/lib/ingest/
    // can rewrite an archived row, the correction diff stops being evidence.
    const mutations = [
      // Drizzle, by table: `db.update(schema.rawFetch)`, `.delete(rawFetch)`.
      /\.(update|delete)\s*\(\s*(schema\.)?rawFetch\b/,
      // Raw SQL, however it is spelled.
      /\b(update|delete\s+from)\s+raw_fetch\b/i,
    ];

    const dir = join(import.meta.dirname);
    const sources = readdirSync(dir).filter(
      (name) => name.endsWith('.ts') && !name.includes('.test.'),
    );
    expect(sources.length).toBeGreaterThan(0);

    for (const name of sources) {
      const code = readFileSync(join(dir, name), 'utf8')
        .split('\n')
        .map((line, index) => [index + 1, line.trimStart()] as const)
        // Comments are allowed to say the words; statements are not.
        .filter(
          ([, line]) => !line.startsWith('*') && !line.startsWith('//') && !line.startsWith('/*'),
        );

      expect(
        code.filter(([, line]) => mutations.some((pattern) => pattern.test(line))),
        `${name} issues an update or delete against raw_fetch`,
      ).toEqual([]);

      // An upsert is an update wearing a hat. Scoped to the insert statement
      // rather than banned outright, because the decode slices upsert into the
      // normalized tables on purpose — it is only raw that may never be rewritten.
      const text = code.map(([, line]) => line).join('\n');
      for (const insert of text.split(/\.insert\s*\(\s*(?:schema\.)?rawFetch\b/).slice(1)) {
        expect(insert.split(';')[0], `${name} upserts into raw_fetch`).not.toMatch(/\bonConflict/);
      }
    }
  });
});
