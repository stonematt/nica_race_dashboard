/**
 * Seeding: the two hand-maintained things a fresh database needs.
 *
 * `seedAdmin` bootstraps the first coach who can sign in. `seedClubConfig`
 * writes the club's own facts — club, scoring teams, roster, plate mappings and
 * squads — from the checked-in config file that `src/lib/club-config.ts` reads
 * and validates. Both are idempotent and neither is ever run by ingest.
 *
 * ---
 *
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

import { and, eq, inArray } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { isAllowed, type AllowlistEnv } from './allowlist.ts';
import type { ClubConfig } from './club-config.ts';
import * as schema from './db/schema.ts';

type Db = PgliteDatabase<typeof schema>;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

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

/* ============================================================================
 * Club config — the hand-maintained half
 * ========================================================================= */

export interface SeedClubResult {
  clubId: number;
  seasonId: number;
  scoringTeams: number;
  riders: number;
  /** Rider rows this run had to create, so the CLI can say what changed. */
  ridersCreated: number;
  plates: number;
  squads: number;
  squadMembers: number;
}

/**
 * Write a validated club config into the database.
 *
 * The config file is the source of truth, so the three tables that are pure
 * projections of it — `club_scoring_team`, `rider_plate` and `squad_member` —
 * are replaced within their scope rather than merged into. A mapping the coach
 * deleted has to actually disappear, or the unmapped-rider warning goes on
 * quietly resolving a plate to the wrong person. The identity rows themselves —
 * `club`, `rider`, `squad` — are only ever created or renamed, never deleted:
 * dropping a rider row cascades their squad membership away, and that is a
 * decision a config edit should not make on its own.
 *
 * **How a rider is recognised on a second run.** The schema gives `rider` no
 * external key — only an id, a display name and free-text notes — so identity
 * has to be anchored on something the config also carries. That is the plate
 * mapping: a config rider is the existing rider holding any of the same plates
 * over an overlapping window in that season. Bounds are part of the match on
 * purpose, so a reissued plate splitting across two people does not collapse
 * them into one rider. A rider whose every plate changed at once is
 * indistinguishable from a new rider and seeds as one; the old roster row is
 * left standing rather than guessed at.
 *
 * The season row is created if missing. It carries a year and nothing else —
 * making config wait on an ingest to supply one would couple the two halves in
 * exactly the way keeping them apart is meant to prevent.
 */
export async function seedClubConfig(db: Db, config: ClubConfig): Promise<SeedClubResult> {
  return db.transaction(async (tx) => {
    const seasonId = await upsertSeason(tx, config.season);
    const clubId = await upsertClub(tx, config.club);

    await tx
      .delete(schema.clubScoringTeam)
      .where(
        and(
          eq(schema.clubScoringTeam.clubId, clubId),
          eq(schema.clubScoringTeam.seasonId, seasonId),
        ),
      );
    if (config.scoringTeams.length > 0) {
      await tx
        .insert(schema.clubScoringTeam)
        .values(config.scoringTeams.map((scoringTeam) => ({ clubId, seasonId, scoringTeam })));
    }

    const riderIds = new Map<string, number>();
    let ridersCreated = 0;
    let plates = 0;

    for (const rider of config.riders) {
      const existingId = await findRiderByPlates(tx, seasonId, rider.plates);
      let riderId: number;
      if (existingId === null) {
        const [row] = await tx
          .insert(schema.rider)
          .values({ displayName: rider.displayName })
          .returning({ id: schema.rider.id });
        riderId = row!.id;
        ridersCreated += 1;
      } else {
        riderId = existingId;
        await tx
          .update(schema.rider)
          .set({ displayName: rider.displayName })
          .where(eq(schema.rider.id, riderId));
      }
      riderIds.set(rider.key, riderId);

      await tx
        .delete(schema.riderPlate)
        .where(
          and(eq(schema.riderPlate.riderId, riderId), eq(schema.riderPlate.seasonId, seasonId)),
        );
      await tx.insert(schema.riderPlate).values(
        rider.plates.map((binding) => ({
          riderId,
          seasonId,
          plate: binding.plate,
          fromRoundOrdinal: binding.fromRound,
          toRoundOrdinal: binding.toRound,
        })),
      );
      plates += rider.plates.length;
    }

    let squadMembers = 0;
    for (const squad of config.squads) {
      const squadId = await upsertSquad(tx, clubId, squad.name);
      await tx.delete(schema.squadMember).where(eq(schema.squadMember.squadId, squadId));
      if (squad.members.length > 0) {
        await tx
          .insert(schema.squadMember)
          .values(squad.members.map((key) => ({ squadId, riderId: riderIds.get(key)! })));
      }
      squadMembers += squad.members.length;
    }

    return {
      clubId,
      seasonId,
      scoringTeams: config.scoringTeams.length,
      riders: config.riders.length,
      ridersCreated,
      plates,
      squads: config.squads.length,
      squadMembers,
    };
  });
}

async function upsertSeason(tx: Tx, year: number): Promise<number> {
  const existing = await tx.select().from(schema.season).where(eq(schema.season.year, year));
  if (existing[0]) return existing[0].id;
  const [row] = await tx.insert(schema.season).values({ year }).returning({ id: schema.season.id });
  return row!.id;
}

async function upsertClub(tx: Tx, name: string): Promise<number> {
  const existing = await tx.select().from(schema.club).where(eq(schema.club.name, name));
  if (existing[0]) return existing[0].id;
  const [row] = await tx.insert(schema.club).values({ name }).returning({ id: schema.club.id });
  return row!.id;
}

async function upsertSquad(tx: Tx, clubId: number, name: string): Promise<number> {
  const existing = await tx
    .select()
    .from(schema.squad)
    .where(and(eq(schema.squad.clubId, clubId), eq(schema.squad.name, name)));
  if (existing[0]) return existing[0].id;
  const [row] = await tx
    .insert(schema.squad)
    .values({ clubId, name })
    .returning({ id: schema.squad.id });
  return row!.id;
}

/**
 * The rider already holding one of these plates over an overlapping window.
 * Null when there is none. Windows have to overlap, not merely share a plate:
 * a plate reissued mid-season is two riders and must stay two riders.
 */
async function findRiderByPlates(
  tx: Tx,
  seasonId: number,
  plates: { plate: string; fromRound: number | null; toRound: number | null }[],
): Promise<number | null> {
  if (plates.length === 0) return null;
  const rows = await tx
    .select()
    .from(schema.riderPlate)
    .where(
      and(
        eq(schema.riderPlate.seasonId, seasonId),
        inArray(
          schema.riderPlate.plate,
          plates.map((p) => p.plate),
        ),
      ),
    );

  const matches = rows.filter((row) =>
    plates.some(
      (p) =>
        p.plate === row.plate &&
        (p.fromRound ?? Number.NEGATIVE_INFINITY) <=
          (row.toRoundOrdinal ?? Number.POSITIVE_INFINITY) &&
        (row.fromRoundOrdinal ?? Number.NEGATIVE_INFINITY) <=
          (p.toRound ?? Number.POSITIVE_INFINITY),
    ),
  );

  if (matches.length === 0) return null;
  // A merge — one config rider over what used to be two — resolves to the lower
  // id, and the row it leaves behind keeps its roster entry and loses its plates.
  return Math.min(...matches.map((row) => row.riderId));
}
