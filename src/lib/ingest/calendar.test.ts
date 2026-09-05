/**
 * `season -> round -> event`. Default lane — event names name race days, not
 * riders, and the database here is the in-memory one.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import * as schema from '../db/schema.ts';
import { createTestDb, type TestDatabase } from '../db/testing.ts';
import { CalendarError, readEventIdentity, upsertEvent } from './calendar.ts';

describe('readEventIdentity', () => {
  it('reads the round ordinal out of the published name', () => {
    const identity = readEventIdentity(2025, '363499', 'Race 4 - ORLeague Newport Gnarnia - North');

    expect(identity.roundOrdinal).toBe(4);
    expect(identity.conference).toBe('North');
    expect(identity.name).toBe('Race 4 - ORLeague Newport Gnarnia - North');
  });

  it('reads it the same way from the 2026 name, which is shaped differently', () => {
    expect(
      readEventIdentity(2026, '418436', 'NICA Oregon - Race 1 - Old Oak Prologue'),
    ).toMatchObject({ roundOrdinal: 1, conference: null });
  });

  it('leaves conference null where the event carries both', () => {
    // State Champs suffixes nothing; the Prologue is one event for both
    // conferences, carrying them as a category suffix instead.
    expect(
      readEventIdentity(2025, '366186', 'Race 5 - ORLeague Butte, Scoot and Boogie - State Champs')
        .conference,
    ).toBeNull();
    expect(
      readEventIdentity(2025, '357242', 'Race 1 - ORLeague - Old Oak Prologue').conference,
    ).toBeNull();
  });

  it('names a round after its ordinal, so the two events of a round agree', () => {
    // 2025 Race 2 is two RaceResult events whose names differ only by
    // conference. A round named after either one would be wrong for the other.
    const south = readEventIdentity(2025, '359477', 'Race 2 - ORLeague Moore Fun - South');
    const north = readEventIdentity(2025, '359478', 'Race 2 - ORLeague Moore Fun - North');

    expect(south.roundOrdinal).toBe(north.roundOrdinal);
    expect(south.roundName).toBe(north.roundName);
    expect(south.roundName).toBe('Race 2');
  });

  it('refuses an event that does not state its race number', () => {
    // The season standings publish round ordinals, so an event with no round
    // has nothing to join to. Guessing would merge two race days.
    expect(() => readEventIdentity(2025, '999', 'ORLeague - Some Race Day')).toThrow(CalendarError);
  });
});

describe('upsertEvent', () => {
  let db: TestDatabase;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it('creates the season, the round and the event', async () => {
    const id = await upsertEvent(
      db,
      readEventIdentity(2025, '363499', 'Race 4 - ORLeague Newport Gnarnia - North'),
    );

    expect(id).toBeGreaterThan(0);
    expect(await db.select().from(schema.season)).toHaveLength(1);
    expect(await db.select().from(schema.round)).toHaveLength(1);
    const [event] = await db.select().from(schema.event);
    expect(event!.sourceEventId).toBe('363499');
    expect(event!.conference).toBe('North');
  });

  it('puts the two events of one race day on one round', async () => {
    await upsertEvent(db, readEventIdentity(2025, '359477', 'Race 2 - ORLeague Moore Fun - South'));
    await upsertEvent(db, readEventIdentity(2025, '359478', 'Race 2 - ORLeague Moore Fun - North'));

    expect(await db.select().from(schema.round)).toHaveLength(1);
    expect(await db.select().from(schema.event)).toHaveLength(2);
  });

  it('is idempotent', async () => {
    const identity = readEventIdentity(2025, '363499', 'Race 4 - ORLeague Newport Gnarnia - North');
    const first = await upsertEvent(db, identity);
    const second = await upsertEvent(db, identity);

    expect(second).toBe(first);
    expect(await db.select().from(schema.event)).toHaveLength(1);
  });

  it('keeps one season row across two seasons of events', async () => {
    await upsertEvent(
      db,
      readEventIdentity(2025, '357242', 'Race 1 - ORLeague - Old Oak Prologue'),
    );
    await upsertEvent(
      db,
      readEventIdentity(2026, '418436', 'NICA Oregon - Race 1 - Old Oak Prologue'),
    );

    expect(await db.select().from(schema.season)).toHaveLength(2);
    // Same ordinal, different season: two rounds, not one.
    expect(await db.select().from(schema.round)).toHaveLength(2);
  });
});
