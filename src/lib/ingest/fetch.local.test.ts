/**
 * Fetch, driven by the recorded configs of both API shapes.
 *
 * **Local lane.** These tests read `fixtures/` — the lane is chosen by what a
 * test *reads*, not by what it asserts (docs/fixtures.md, issue #29). A config
 * carries no rider, but reading one still needs the corpus on disk, and the
 * default lane must pass on a fresh clone that has none.
 *
 * **Still no network.** Only the config bytes are real; every response is
 * served from disk by a stub reader, and `globalThis.fetch` throws for the
 * duration of the suite. The list payloads are synthetic — what is under test
 * here is the catalog, not the rows.
 */

import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../db/schema.ts';
import { createTestDb, type TestDatabase } from '../db/testing.ts';
import { readCatalog, type SourceShape } from './catalog.ts';
import { discoverCorpus, readEventRecords } from './corpus.ts';
import { fetchEvent, shapeOfArchivedConfig, type SourceReader } from './fetch.ts';
import { corpusPath } from '../fixtures.ts';
import type { SourceResponse } from './transport.ts';

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

const readConfig = (season: string, eventId: string): unknown =>
  JSON.parse(readFileSync(corpusPath(season, `config-${eventId}.json`), 'utf8'));

/** A 2025 event and the 2026 opener: one recorded config of each shape. */
const PROLOGUE_2025 = { season: 2025, eventId: '357242', shape: '2025' } as const;
const OPENER_2026 = { season: 2026, eventId: '418436', shape: '2026' } as const;

/** Serves the recorded config, and a stub payload for every list it advertises. */
function readerFor(season: string, eventId: string): SourceReader {
  const config = readConfig(season, eventId);
  return {
    async get(url: string): Promise<SourceResponse> {
      if (url.includes('config')) return { url, status: 200, body: config };
      const listName = new URL(url).searchParams.get('listname');
      return { url, status: 200, body: { list: { ListName: listName }, data: [] } };
    },
  };
}

describe('both API shapes, read from the recorded configs', () => {
  it.each([
    ['2025', PROLOGUE_2025],
    ['2026', OPENER_2026],
  ])('fetches event %s into the same shape of raw rows', async (season, request) => {
    const result = await fetchEvent(db, readerFor(season, request.eventId), request);

    expect(result.shape).toBe(season as SourceShape);
    expect(result.eventName).toContain('Old Oak');
    expect(result.lists).toBeGreaterThan(0);
    expect(result.rows).toBe(result.lists + 1);

    const rows = await db.select().from(schema.rawFetch).orderBy(schema.rawFetch.id);
    expect(rows[0]!.listId).toBeNull();
    for (const row of rows.slice(1)) {
      // Every list resolves to the config's stable hex ID, in both shapes.
      expect(row.listId, row.listName).toMatch(/^[0-9A-F]{6}$/);
      expect(row.url, row.listName).toContain(`/${request.eventId}/results/list`);
    }
  });

  it('sends the 2026 opener to the moved config endpoint and the 2025 event to the old one', async () => {
    await fetchEvent(db, readerFor('2026', OPENER_2026.eventId), OPENER_2026);
    const [opener] = await db.select().from(schema.rawFetch);

    expect(shapeOfArchivedConfig(opener!)).toEqual({
      configPath: 'results/config',
      requestedShape: '2026',
      payloadShape: '2026',
      catalogKey: 'Tab.Config.Lists',
    });
  });

  it('files a fetched row exactly as the offline corpus loader files the same event', async () => {
    // #22 archives the corpus; this archives a fetch. A row that arrives by the
    // two routes has to be the same row, or the corpus is not a stand-in for a
    // season and every offline test is testing something else.
    await fetchEvent(db, readerFor('2025', PROLOGUE_2025.eventId), PROLOGUE_2025);

    const event = discoverCorpus().find(
      (candidate) => candidate.eventId === PROLOGUE_2025.eventId,
    )!;
    const offline = readEventRecords(event);
    const rows = await db.select().from(schema.rawFetch).orderBy(schema.rawFetch.id);

    expect(rows[0]!.url).toBe(offline[0]!.url);
    expect(rows[0]!.listName).toBe(offline[0]!.listName);
    // The corpus only holds the lists that were actually crawled, so the fetch
    // is a superset: every crawled list appears, under the same identity.
    const fetched = new Map(rows.slice(1).map((row) => [row.listId, row.listName]));
    for (const record of offline.slice(1)) {
      expect(fetched.get(record.listId), record.listName).toBe(record.listName);
    }
  });

  it('carries the `Online|` prefix through 2026 without touching 2025 names', () => {
    const catalog2026 = readCatalog(OPENER_2026.eventId, readConfig('2026', OPENER_2026.eventId));
    const catalog2025 = readCatalog(
      PROLOGUE_2025.eventId,
      readConfig('2025', PROLOGUE_2025.eventId),
    );

    expect(catalog2026.lists.every((list) => list.name.startsWith('Online|'))).toBe(true);
    expect(catalog2025.lists.some((list) => list.name.startsWith('Online|'))).toBe(false);
    // Both still carry the pipe: in 2025 it separates the menu group from the
    // list, in 2026 it follows the prefix. Neither is ever reconstructed.
    expect(catalog2025.lists.every((list) => list.name.includes('|'))).toBe(true);
  });

  it('is why the trap exists: the 2026 config has no top-level `lists` key at all', () => {
    const config = readConfig('2026', OPENER_2026.eventId) as Record<string, unknown>;

    expect('lists' in config).toBe(false);
    expect('Tab' in config).toBe(true);
    // Read with the 2025 assumption this is an event with no lists, not an
    // error — which is exactly what `readCatalog` refuses to return.
    expect(((config as { lists?: unknown[] }).lists ?? []).length).toBe(0);
  });

  it('reads every recorded config in the corpus without a single one coming back empty', () => {
    for (const event of discoverCorpus()) {
      const catalog = readCatalog(
        event.eventId,
        JSON.parse(readFileSync(event.configPath, 'utf8')),
      );

      expect(catalog.lists.length, `${event.eventId} catalog`).toBeGreaterThan(0);
      expect(catalog.key, `${event.eventId} key`).not.toBe('');
    }
  });
});
