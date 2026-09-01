/**
 * Seeding the first admin. Two properties carry the weight: it refuses an
 * address the allowlist does not carry, and running it twice is a no-op.
 */

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDatabase } from './db/testing.ts';
import * as schema from './db/schema.ts';
import { NotAllowlistedError, seedAdmin } from './seed.ts';

const env = { AUTH_ALLOWED_EMAILS: 'coach@example.org' };
const CLUB = 'Salem Composite Descenders';

let db: TestDatabase;

beforeEach(async () => {
  db = await createTestDb();
});

describe('seedAdmin', () => {
  it('creates the club, the user and the coach profile', async () => {
    const result = await seedAdmin(db, { email: 'coach@example.org', clubName: CLUB, env });

    expect(result.created).toBe(true);
    expect(result.email).toBe('coach@example.org');
    expect(result.clubName).toBe(CLUB);

    const clubs = await db.select().from(schema.club);
    expect(clubs).toHaveLength(1);
    expect(clubs[0]!.name).toBe(CLUB);

    const users = await db.select().from(schema.users);
    expect(users).toHaveLength(1);
    expect(users[0]!.email).toBe('coach@example.org');

    const coaches = await db.select().from(schema.coach);
    expect(coaches).toHaveLength(1);
    expect(coaches[0]!.userId).toBe(users[0]!.id);
    expect(coaches[0]!.clubId).toBe(clubs[0]!.id);
  });

  it('refuses an address that is not on the allowlist', async () => {
    // Seeding is not a side door. An unlisted row could not sign in anyway, and
    // one that could would be the bypass the privacy review ruled out (#3).
    await expect(
      seedAdmin(db, { email: 'stranger@example.org', clubName: CLUB, env }),
    ).rejects.toThrow(NotAllowlistedError);

    expect(await db.select().from(schema.users)).toHaveLength(0);
    expect(await db.select().from(schema.coach)).toHaveLength(0);
    expect(await db.select().from(schema.club)).toHaveLength(0);
  });

  it('fails closed when the allowlist is empty', async () => {
    await expect(
      seedAdmin(db, { email: 'coach@example.org', clubName: CLUB, env: {} }),
    ).rejects.toThrow(NotAllowlistedError);
  });

  it('is idempotent — a second run writes nothing', async () => {
    const first = await seedAdmin(db, { email: 'coach@example.org', clubName: CLUB, env });
    const second = await seedAdmin(db, { email: 'coach@example.org', clubName: CLUB, env });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.userId).toBe(first.userId);
    expect(second.clubId).toBe(first.clubId);

    expect(await db.select().from(schema.club)).toHaveLength(1);
    expect(await db.select().from(schema.users)).toHaveLength(1);
    expect(await db.select().from(schema.coach)).toHaveLength(1);
  });

  it('normalizes the address, so a re-run in different case is still a no-op', async () => {
    await seedAdmin(db, { email: 'coach@example.org', clubName: CLUB, env });
    const again = await seedAdmin(db, { email: '  COACH@Example.ORG ', clubName: CLUB, env });

    expect(again.created).toBe(false);
    expect(await db.select().from(schema.users)).toHaveLength(1);
  });

  it('completes a user that exists without a coach profile', async () => {
    // A magic-link sign-in creates the adapter's user row before this ever
    // runs. Finish the profile rather than refusing.
    const [user] = await db
      .insert(schema.users)
      .values({ email: 'coach@example.org', name: 'A Coach' })
      .returning({ id: schema.users.id });

    const result = await seedAdmin(db, { email: 'coach@example.org', clubName: CLUB, env });

    expect(result.created).toBe(true);
    expect(result.userId).toBe(user!.id);
    expect(await db.select().from(schema.users)).toHaveLength(1);

    const coaches = await db.select().from(schema.coach).where(eq(schema.coach.userId, user!.id));
    expect(coaches).toHaveLength(1);
  });

  it('reuses an existing club rather than creating a second one', async () => {
    const [club] = await db.insert(schema.club).values({ name: CLUB }).returning();

    const result = await seedAdmin(db, { email: 'coach@example.org', clubName: CLUB, env });

    expect(result.clubId).toBe(club!.id);
    expect(await db.select().from(schema.club)).toHaveLength(1);
  });

  it('defaults the display name to the local part of the address', async () => {
    const result = await seedAdmin(db, { email: 'coach@example.org', clubName: CLUB, env });
    expect(result.displayName).toBe('coach');
  });
});
