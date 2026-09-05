/**
 * Fetching an event, proved against a stubbed transport.
 *
 * **Default lane.** The configs here are hand-written miniatures of the two API
 * shapes — the same convention `catalog.test.ts` uses — and the list payloads
 * are two-row stubs with no rider in them. Nothing reads `fixtures/`; the
 * fidelity assertions against the recorded configs live in
 * `fetch.local.test.ts`.
 *
 * The suite installs a throwing `globalThis.fetch`, so "no live network call
 * occurs in the test suite" fails loudly instead of quietly.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../db/schema.ts';
import { createTestDb, type TestDatabase } from '../db/testing.ts';
import { SourceCatalogError } from './catalog.ts';
import {
  fetchEvent,
  readFetchConfig,
  refuseCorpusRefetch,
  shapeOfArchivedConfig,
  SourceFetchError,
} from './fetch.ts';
import { CONFIG_LIST_NAME } from './raw.ts';
import {
  REQUEST_SPACING_MS,
  SourceUnavailableError,
  USER_AGENT,
  type SourceResponse,
} from './transport.ts';

const realFetch = globalThis.fetch;

let db: TestDatabase;

beforeEach(async () => {
  globalThis.fetch = (() => {
    throw new Error('the test suite made a live network request');
  }) as typeof fetch;
  db = await createTestDb();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** The 2025 shape: a top-level `lists` array, unprefixed names. */
const config2025 = {
  key: 'dc364c6c45dec11a1e1dd1b477c621bb',
  eventname: 'Race 1 - ORLeague - Old Oak Prologue',
  lists: [
    { ID: '2A48B4', Name: '03 - Season Overall Results|Individual Results - Overall', Mode: '' },
    { ID: '4F491D', Name: '10 - Prologue Results Lists|Prologue/TT Results ALL', Mode: 'hidden' },
  ],
};

/** The 2026 shape: `Tab.Config.Lists`, and every name gained `Online|`. */
const config2026 = {
  key: '9f1c0b2ad4e6485a91f0c3d5e7b28a41',
  eventname: 'Race 1 - ORLeague - Old Oak Prologue',
  Tab: { Config: { Lists: [{ ID: 'F1A053', Name: 'Online|Individual Results', Mode: '' }] } },
};

const listPayload = (name: string) => ({ list: { ListName: name }, data: [] });

interface Stub {
  get(url: string): Promise<SourceResponse>;
  urls: string[];
}

/** A reader that answers from a table of URL substrings, and records the order. */
function stubReader(answers: [match: string, response: Partial<SourceResponse> | Error][]): Stub {
  const urls: string[] = [];
  return {
    urls,
    async get(url) {
      urls.push(url);
      const answer = answers.find(([match]) => url.includes(match))?.[1];
      if (answer === undefined) throw new SourceUnavailableError(`${url}: nothing stubbed`);
      if (answer instanceof Error) throw answer;
      return { url, status: 200, body: {}, ...answer };
    },
  };
}

const rowsOf = (database: TestDatabase) =>
  database.select().from(schema.rawFetch).orderBy(schema.rawFetch.id);

describe('fetchEvent', () => {
  it('fetches the config, then every published list, in the order the config published them', async () => {
    const reader = stubReader([
      ['/RRPublish/data/config', { body: config2025 }],
      [
        'Individual+Results+-+Overall',
        { body: listPayload('03 - Season Overall Results|Individual Results - Overall') },
      ],
      ['Prologue', { body: listPayload('10 - Prologue Results Lists|Prologue/TT Results ALL') }],
    ]);

    const result = await fetchEvent(db, reader, { season: 2025, eventId: '357242', shape: '2025' });

    expect(result).toMatchObject({
      eventId: '357242',
      season: 2025,
      shape: '2025',
      configPath: 'RRPublish/data/config',
      catalogKey: 'lists',
      lists: 2,
      rows: 3,
    });

    const rows = await rowsOf(db);
    expect(rows.map((row) => row.listName)).toEqual([
      CONFIG_LIST_NAME,
      '03 - Season Overall Results|Individual Results - Overall',
      '10 - Prologue Results Lists|Prologue/TT Results ALL',
    ]);
    expect(rows.map((row) => row.listId)).toEqual([null, '2A48B4', '4F491D']);
    expect(rows.every((row) => row.season === 2025 && row.httpStatus === 200)).toBe(true);
    expect(reader.urls[0]).toContain('/357242/RRPublish/data/config');
    expect(reader.urls.slice(1).every((url) => url.includes('/357242/results/list'))).toBe(true);
  });

  it('reads the 2026 shape through the moved endpoint, prefix and all', async () => {
    const reader = stubReader([
      ['/results/config', { body: config2026 }],
      ['/results/list', { body: listPayload('Online|Individual Results') }],
    ]);

    const result = await fetchEvent(db, reader, { season: 2026, eventId: '418436', shape: '2026' });

    expect(result).toMatchObject({
      configPath: 'results/config',
      catalogKey: 'Tab.Config.Lists',
      lists: 1,
    });

    const rows = await rowsOf(db);
    // The `Online|` prefix is part of the name and part of the query string —
    // it is read from the config and sent back verbatim, never reconstructed.
    expect(rows[1]!.listName).toBe('Online|Individual Results');
    expect(rows[1]!.url).toContain('listname=Online%7CIndividual+Results');
    expect(rows[0]!.url).toContain('/418436/results/config');
  });

  it('stores the payload verbatim, one row per request, and never updates one', async () => {
    const reader = stubReader([
      ['/results/config', { body: config2026 }],
      ['/results/list', { body: listPayload('Online|Individual Results') }],
    ]);
    const request = { season: 2026, eventId: '418436', shape: '2026' } as const;

    await fetchEvent(db, reader, request);
    await fetchEvent(db, reader, request);

    const rows = await rowsOf(db);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.payload).toEqual(config2026);
    // Same bytes twice is not a correction, and is still two rows.
    expect(rows[0]!.contentHash).toBe(rows[2]!.contentHash);
  });

  describe('the empty catalog is a hard error, never an empty result', () => {
    it('throws when a 2026 event is read at the 2025 path and answers with an empty `lists`', async () => {
      const reader = stubReader([
        ['/RRPublish/data/config', { body: { key: 'k', eventname: 'Race 1', lists: [] } }],
      ]);

      await expect(
        fetchEvent(db, reader, { season: 2026, eventId: '418436', shape: '2025' }),
      ).rejects.toBeInstanceOf(SourceCatalogError);

      // The evidence survives: the config is archived before anything is
      // asserted about it, and no list was ever requested.
      const rows = await rowsOf(db);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.listName).toBe(CONFIG_LIST_NAME);
      expect(rows[0]!.payload).toEqual({ key: 'k', eventname: 'Race 1', lists: [] });
      expect(reader.urls).toHaveLength(1);
    });

    it('throws in the other direction too: an empty `Tab.Config.Lists`', async () => {
      const reader = stubReader([
        [
          '/results/config',
          { body: { key: 'k', eventname: 'Race 1', Tab: { Config: { Lists: [] } } } },
        ],
      ]);

      await expect(
        fetchEvent(db, reader, { season: 2026, eventId: '418436', shape: '2026' }),
      ).rejects.toBeInstanceOf(SourceCatalogError);
      expect(await rowsOf(db)).toHaveLength(1);
    });

    it('throws when the catalog key is missing altogether, and says which path was asked', async () => {
      const reader = stubReader([
        ['/RRPublish/data/config', { body: { key: 'k', eventname: 'Race 1' } }],
      ]);

      await expect(
        fetchEvent(db, reader, { season: 2026, eventId: '418436', shape: '2025' }),
      ).rejects.toThrow(/RRPublish\/data\/config[\s\S]*FETCH_CONFIG_SHAPE=2026/);
    });
  });

  it('keeps every payload it already has when the source stops answering mid-event', async () => {
    const reader = stubReader([
      ['/RRPublish/data/config', { body: config2025 }],
      [
        'Individual+Results+-+Overall',
        { body: listPayload('03 - Season Overall Results|Individual Results - Overall') },
      ],
      ['Prologue', new SourceUnavailableError('https://x: the source answered 503')],
    ]);

    await expect(
      fetchEvent(db, reader, { season: 2025, eventId: '357242', shape: '2025' }),
    ).rejects.toBeInstanceOf(SourceUnavailableError);

    // Config and the list that did arrive are on disk, so a re-run costs the
    // source one config request and one list, not the whole event again.
    const rows = await rowsOf(db);
    expect(rows.map((row) => row.listId)).toEqual([null, '2A48B4']);
  });
});

describe('shapeOfArchivedConfig', () => {
  it('recovers the config path and the catalog key from an archived row alone', async () => {
    const reader = stubReader([
      ['/results/config', { body: config2026 }],
      ['/results/list', { body: listPayload('Online|Individual Results') }],
    ]);
    await fetchEvent(db, reader, { season: 2026, eventId: '418436', shape: '2026' });

    const [config] = await rowsOf(db);

    expect(shapeOfArchivedConfig(config!)).toEqual({
      configPath: 'results/config',
      requestedShape: '2026',
      payloadShape: '2026',
      catalogKey: 'Tab.Config.Lists',
    });
  });

  it('reports the drift when the path asked and the payload answered disagree', () => {
    expect(
      shapeOfArchivedConfig({
        eventId: '418436',
        url: 'https://my.raceresult.com/418436/RRPublish/data/config?page=results&noVisitor=1',
        payload: config2026,
      }),
    ).toEqual({
      configPath: 'RRPublish/data/config',
      requestedShape: '2025',
      payloadShape: '2026',
      catalogKey: 'Tab.Config.Lists',
    });
  });
});

describe('readFetchConfig', () => {
  const minimal = { FETCH_EVENT_IDS: '418437', FETCH_SEASON: '2026' };

  it('reads a run out of the environment, and defaults the rest', () => {
    expect(readFetchConfig(minimal)).toEqual({
      eventIds: ['418437'],
      season: 2026,
      shape: '2026',
      spacingMs: REQUEST_SPACING_MS,
      userAgent: USER_AGENT,
      databaseUrl: './.pglite',
      allowRefetch: false,
    });
  });

  it('takes several event ids, and keeps the order they were named in', () => {
    expect(readFetchConfig({ ...minimal, FETCH_EVENT_IDS: '418437, 418438' }).eventIds).toEqual([
      '418437',
      '418438',
    ]);
  });

  it('refuses a run with no event id, because fetch never crawls', () => {
    expect(() => readFetchConfig({ FETCH_SEASON: '2026' })).toThrow(SourceFetchError);
    expect(() => readFetchConfig({ ...minimal, FETCH_EVENT_IDS: '  ' })).toThrow(/FETCH_EVENT_IDS/);
  });

  it('refuses a season it cannot trust, because the raw row is stamped with it', () => {
    expect(() => readFetchConfig({ FETCH_EVENT_IDS: '418437' })).toThrow(/FETCH_SEASON/);
    expect(() => readFetchConfig({ ...minimal, FETCH_SEASON: 'this year' })).toThrow(
      /FETCH_SEASON/,
    );
  });

  it('refuses a spacing narrower than the floor, and allows a wider one', () => {
    expect(() => readFetchConfig({ ...minimal, FETCH_SPACING_MS: '250' })).toThrow(/3000/);
    expect(readFetchConfig({ ...minimal, FETCH_SPACING_MS: '9000' }).spacingMs).toBe(9000);
  });

  it('refuses a config shape that is neither of the two that exist', () => {
    expect(() => readFetchConfig({ ...minimal, FETCH_CONFIG_SHAPE: '2027' })).toThrow(/2025.*2026/);
    expect(readFetchConfig({ ...minimal, FETCH_CONFIG_SHAPE: '2025' }).shape).toBe('2025');
  });
});

describe('refuseCorpusRefetch', () => {
  const corpus = ['357242', '418436'];

  it('passes an event that is not already on disk', () => {
    expect(refuseCorpusRefetch(['418437'], corpus, false)).toEqual(['418437']);
  });

  it('refuses to re-fetch what the corpus already holds', () => {
    expect(() => refuseCorpusRefetch(['418437', '418436'], corpus, false)).toThrow(
      /418436[\s\S]*docs\/fixtures\.md/,
    );
  });

  it('lets a deliberate correction through, because a re-fetch is how one arrives', () => {
    expect(refuseCorpusRefetch(['418436'], corpus, true)).toEqual(['418436']);
  });
});
