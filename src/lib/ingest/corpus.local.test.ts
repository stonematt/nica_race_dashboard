/**
 * The real corpus lands in the raw layer.
 *
 * **Local lane.** These tests read `fixtures/` — minors' full names, schools,
 * grades, plates and finish times — so they run on a developer's machine with a
 * human present, and never in CI (docs/fixtures.md, issue #29). Nothing here
 * asserts on a rider; the assertions are counts, hashes and identities. The
 * lane is chosen by what the test *reads*, not by what it prints.
 */

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDatabase } from '../db/testing.ts';
import * as schema from '../db/schema.ts';
import { discoverCorpus, loadCorpus, readEventRecords } from './corpus.ts';
import { contentHash } from './raw.ts';

/** 8 events in 2025 plus the 2026 opener. */
const EVENTS = 9;
/** One config per event. */
const CONFIGS = 9;
/** 50 fetched lists across 2025, plus the one fetched at the 2026 opener. */
const LISTS = 51;

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDb();
});

describe('discoverCorpus', () => {
  it('finds every event in both seasons', () => {
    const events = discoverCorpus();

    expect(events).toHaveLength(EVENTS);
    expect(events.filter((event) => event.season === 2025)).toHaveLength(8);
    expect(events.filter((event) => event.season === 2026)).toHaveLength(1);
    expect(events.at(-1)!.eventId).toBe('418436');
  });

  it('pairs every fetched list with a config', () => {
    const lists = discoverCorpus().reduce((total, event) => total + event.listPaths.length, 0);

    expect(lists).toBe(LISTS);
  });
});

describe('readEventRecords', () => {
  it('resolves every published list to a hex ID, in both API shapes', () => {
    for (const event of discoverCorpus()) {
      const records = readEventRecords(event);

      expect(records[0]!.listId, `${event.eventId} config`).toBeNull();
      for (const record of records.slice(1)) {
        expect(record.listId, `${event.eventId} ${record.listName}`).toMatch(/^[0-9A-F]{6}$/);
      }
    }
  });

  it('sends the 2026 opener config to the moved endpoint and 2025 to the old one', () => {
    const events = discoverCorpus();
    const opener = events.find((event) => event.eventId === '418436')!;
    const prologue = events.find((event) => event.eventId === '357242')!;

    expect(readEventRecords(opener)[0]!.url).toContain('/418436/results/config');
    expect(readEventRecords(prologue)[0]!.url).toContain('/357242/RRPublish/data/config');
  });
});

describe('loadCorpus', () => {
  it('loads the whole 2025 season plus the 2026 opener without error', async () => {
    const result = await loadCorpus(db);

    expect(result).toEqual({ events: EVENTS, configs: CONFIGS, lists: LISTS, rows: 60 });
    expect(await db.select().from(schema.rawFetch)).toHaveLength(60);
  });

  it('stores every payload verbatim', async () => {
    await loadCorpus(db);

    const event = discoverCorpus().find((candidate) => candidate.eventId === '418436')!;
    const onDisk = JSON.parse(readFileSync(event.listPaths[0]!, 'utf8'));

    const rows = await db.select().from(schema.rawFetch);
    const stored = rows.find((row) => row.eventId === '418436' && row.listId !== null)!;

    expect(stored.payload).toEqual(onDisk);
    expect(stored.contentHash).toBe(contentHash(onDisk));
  });

  it('appends on a second load: every hash repeats, nothing is updated', async () => {
    await loadCorpus(db);
    await loadCorpus(db);

    const rows = await db.select().from(schema.rawFetch);
    expect(rows).toHaveLength(120);

    const byKey = new Map<string, Set<string>>();
    for (const row of rows) {
      const key = `${row.eventId}/${row.listId ?? 'config'}`;
      const hashes = byKey.get(key) ?? new Set<string>();
      hashes.add(row.contentHash);
      byKey.set(key, hashes);
    }

    expect(byKey.size).toBe(60);
    // One distinct hash per key across both passes: the source did not change,
    // so there is no correction — but there are still two rows.
    for (const [key, hashes] of byKey) {
      expect(hashes.size, `${key} hashed two ways across identical loads`).toBe(1);
    }
  });

  it('keys on list_id, which stays unique where the list name does not', async () => {
    await loadCorpus(db);

    const rows = await db.select().from(schema.rawFetch);
    for (const eventId of new Set(rows.map((row) => row.eventId))) {
      const lists = rows.filter((row) => row.eventId === eventId && row.listId !== null);
      expect(new Set(lists.map((row) => row.listId)).size, `${eventId} list_id`).toBe(lists.length);
    }
  });

  it('records the season and a 200 for every archived payload', async () => {
    await loadCorpus(db);

    const rows = await db.select().from(schema.rawFetch);
    expect(new Set(rows.map((row) => row.season))).toEqual(new Set([2025, 2026]));
    expect(rows.every((row) => row.httpStatus === 200)).toBe(true);
    expect(rows.every((row) => row.url.startsWith('https://my.raceresult.com/'))).toBe(true);
  });
});
