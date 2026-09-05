/**
 * Seed the first admin: a club, a next-auth user, and the coach profile that
 * ties them together.
 *
 * The bootstrap problem this solves: every route is behind auth and the
 * allowlist has no self-service path, so a fresh database has nobody who can
 * sign in and no way to make one from inside the app. This is that way, and it
 * runs from the terminal where the operator already has the database.
 *
 * Two rules it will not bend:
 *
 *   - **It refuses an address that is not on AUTH_ALLOWED_EMAILS.** The
 *     allowlist stays the single gate (issue #3). Seeding is not a side door:
 *     a seeded row that cannot sign in is useless, and one that could sign in
 *     without being listed would be exactly the bypass the privacy review ruled
 *     out. So this checks the same allowlist the app does, and fails loudly.
 *   - **It is idempotent.** Running it twice on the same database changes
 *     nothing the second time — the same requirement ingest carries in issue
 *     #7, for the same reason: the operator should be able to re-run it without
 *     thinking about what it did last time.
 *
 * It grants no privilege. There is one role in this app; "admin" here means the
 * first coach who can get in, not a permission level.
 */

import { eq } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { isAllowed, type AllowlistEnv } from './allowlist.ts';
import * as schema from './db/schema.ts';

type Db = PgliteDatabase<typeof schema>;

export interface SeedAdminOptions {
  email: string;
  /** Shown in the UI. Defaults to the local part of the address. */
  displayName?: string;
  /** The organisation this coach runs. Created if it does not exist. */
  clubName: string;
  env?: AllowlistEnv;
}

export interface SeedAdminResult {
  userId: string;
  clubId: number;
  email: string;
  displayName: string;
  clubName: string;
  /** False when the admin already existed and nothing was written. */
  created: boolean;
}

export class NotAllowlistedError extends Error {
  constructor(email: string) {
    super(
      `${email} is not on AUTH_ALLOWED_EMAILS, so seeding it would create an account that cannot sign in. ` +
        `Add the address to AUTH_ALLOWED_EMAILS first — the allowlist is the single gate, and seeding does not bypass it.`,
    );
    this.name = 'NotAllowlistedError';
  }
}

export async function seedAdmin(db: Db, options: SeedAdminOptions): Promise<SeedAdminResult> {
  const email = options.email.trim().toLowerCase();
  const env = options.env ?? process.env;

  if (!isAllowed(email, env)) throw new NotAllowlistedError(email);

  const displayName = options.displayName?.trim() || (email.split('@')[0] ?? email);
  const clubName = options.clubName.trim();

  // Club first: the coach row references it. Look up before inserting rather
  // than upserting, so a second run reuses the existing id instead of burning
  // one from the serial sequence.
  const existingClub = await db.select().from(schema.club).where(eq(schema.club.name, clubName));
  const clubId =
    existingClub[0]?.id ??
    (await db.insert(schema.club).values({ name: clubName }).returning())[0]!.id;

  // `user` is adapter-owned and carries no unique index on email, so identity
  // is resolved by query, not by an ON CONFLICT target. Do not add one — the
  // adapter owns that table's shape (see src/lib/db/schema.ts).
  const existingUser = await db.select().from(schema.users).where(eq(schema.users.email, email));
  if (existingUser[0]) {
    const userId = existingUser[0].id;
    const existingCoach = await db
      .select()
      .from(schema.coach)
      .where(eq(schema.coach.userId, userId));
    if (existingCoach[0]) {
      return { userId, clubId, email, displayName, clubName, created: false };
    }
    // A user with no coach profile: half-seeded, or created by a magic-link
    // sign-in before this ever ran. Finish the job rather than refusing.
    await db.insert(schema.coach).values({ userId, clubId, displayName });
    return { userId, clubId, email, displayName, clubName, created: true };
  }

  const [user] = await db
    .insert(schema.users)
    .values({ email, name: displayName })
    .returning({ id: schema.users.id });

  await db.insert(schema.coach).values({ userId: user!.id, clubId, displayName });

  return { userId: user!.id, clubId, email, displayName, clubName, created: true };
}
