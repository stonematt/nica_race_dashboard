/**
 * `[season]/round/[ordinal]`'s own read: which Round a URL names, and which
 * Events it was published as (issue #35).
 *
 * Synthetic rows only, no corpus — the CI lane. Shaped after the load-bearing
 * fact in `CONTEXT.md`: a Round is published as one Event per Conference, or
 * a single Event when the whole league rides together. This suite seeds one
 * of each — a split Round (two Events, one per conference) and a combined
 * one (the Prologue shape) — plus a Round nothing has been ingested for yet,
 * and an ordinal with no Round at all.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../../../lib/db/schema.ts';
import { createTestDb, type TestDatabase } from '../../../../lib/db/testing.ts';
import { listRoundEvents, resolveRound } from './query.ts';

let db: TestDatabase;

beforeAll(async () => {
  db = await createTestDb();

  await db.insert(schema.season).values({ id: 1, year: 2025 });

  // Round 1: the Prologue shape — one combined Event, no conference.
  await db.insert(schema.round).values({ id: 1, seasonId: 1, ordinal: 1, name: 'Race 1' });
  await db.insert(schema.event).values({
    id: 1,
    roundId: 1,
    sourceEventId: '111111',
    conference: null,
    name: 'Race 1 - ORLeague - Old Oak Prologue',
  });

  // Round 4: the split shape — two Events, one per conference.
  await db.insert(schema.round).values({ id: 2, seasonId: 1, ordinal: 4, name: 'Race 4' });
  await db.insert(schema.event).values([
    {
      id: 2,
      roundId: 2,
      sourceEventId: '444222',
      conference: 'North',
      name: 'Race 4 - Newport Gnarnia - North',
    },
    {
      id: 3,
      roundId: 2,
      sourceEventId: '444111',
      conference: 'South',
      name: 'Race 4 - Newport Gnarnia - South',
    },
  ]);

  // Round 5 exists in the calendar but nothing has been ingested for it yet.
  await db.insert(schema.round).values({ id: 3, seasonId: 1, ordinal: 5, name: 'Race 5' });
});

describe('resolving a URL segment to a Round', () => {
  it('finds the Round named by a real ordinal in this Season', async () => {
    expect(await resolveRound(db, 1, '4')).toEqual({
      id: 2,
      seasonId: 1,
      ordinal: 4,
      name: 'Race 4',
    });
  });

  it('is null for an ordinal that names no Round in this Season', async () => {
    expect(await resolveRound(db, 1, '99')).toBeNull();
  });

  it('is null for an ordinal that exists only in a different Season', async () => {
    await db.insert(schema.season).values({ id: 2, year: 2026 });
    expect(await resolveRound(db, 2, '1')).toBeNull();
  });

  it('is null for a segment that is not a plain integer', async () => {
    expect(await resolveRound(db, 1, '4abc')).toBeNull();
    expect(await resolveRound(db, 1, 'four')).toBeNull();
    expect(await resolveRound(db, 1, '-4')).toBeNull();
    expect(await resolveRound(db, 1, '')).toBeNull();
  });
});

describe('a Round is not an Event', () => {
  it('resolves a combined Round to its one Event, conference null', async () => {
    const events = await listRoundEvents(db, 1);
    expect(events).toEqual([
      {
        sourceEventId: '111111',
        name: 'Race 1 - ORLeague - Old Oak Prologue',
        conference: null,
      },
    ]);
  });

  it('resolves a split Round to both its Events, each carrying its own conference', async () => {
    const events = await listRoundEvents(db, 2);
    expect(events.map((e) => e.conference).sort()).toEqual(['North', 'South']);
    expect(events).toHaveLength(2);
  });

  it('orders Events stably by source event id, regardless of insertion order', async () => {
    const events = await listRoundEvents(db, 2);
    expect(events.map((e) => e.sourceEventId)).toEqual(['444111', '444222']);
  });

  it('is empty for a Round nothing has been ingested for yet', async () => {
    expect(await listRoundEvents(db, 3)).toEqual([]);
  });
});
