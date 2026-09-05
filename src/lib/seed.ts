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

import { and, eq, inArray, notInArray } from 'drizzle-orm';
import type { PgliteDatabase } from 'drizzle-orm/pglite';
import { isAllowed, type AllowlistEnv } from './allowlist.ts';
import {
  ClubConfigError,
  loadPublishedScoringTeams,
  plateWindowsOverlap,
  type ClubConfig,
  type PlateBinding,
} from './club-config.ts';
import * as schema from './db/schema.ts';

type Db = PgliteDatabase<typeof schema>;
/**
 * The handle drizzle hands a `db.transaction` callback. Named by unwrapping the
 * method's own signature rather than importing it, so a drizzle upgrade that
 * reshapes the transaction type cannot leave this quietly wrong.
 */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Either handle. The club lookup is shared between a transaction and a plain db. */
type Executor = Db | Tx;

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

  // Club first: the coach row references it. Shared with seedClubConfig, so
  // seeding an admin and seeding the config land on the same club row.
  const clubId = await upsertClub(db, clubName);

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

export interface SeedClubOptions {
  /**
   * The scoring-team strings the league published, by season. Defaults to the
   * checked-in registry.
   */
  publishedScoringTeams?: Map<number, Set<string>>;
}

/**
 * Write a club config into the database.
 *
 * **It re-checks the scoring teams itself.** `parseClubConfig` already does,
 * and this is deliberately redundant: the requirement is that *seeding* refuses
 * a string the league does not publish, and a guarantee that holds only because
 * every caller remembered to validate first is not that guarantee.
 *
 * The config file is the source of truth, so the three tables that are pure
 * projections of it — `club_scoring_team`, `rider_plate` and `squad_member` —
 * are reconciled, not merged into. A mapping the coach deleted has to actually
 * disappear, or the unmapped-rider warning goes on quietly resolving a plate to
 * the wrong person. `club` and `rider` rows are only ever created or renamed:
 * dropping a rider cascades away squad membership and is a decision a config
 * edit should not make on its own. A squad the config no longer names *is*
 * removed, since a squad is nothing but its name and its members.
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
 * **What "this club's riders" means, and its one gap.** Nothing in the schema
 * ties a rider to a club, so the riders a dropped mapping can be cleaned up for
 * are the ones reachable through the club's squads plus the ones this config
 * seeds. A rider who was in no squad *and* has been deleted from the config
 * keeps their old plate mappings; there is no row anywhere that says they were
 * ever ours. A `rider.club_id` would close it.
 *
 * The season row is created if missing. It carries a year and nothing else —
 * making config wait on an ingest to supply one would couple the two halves in
 * exactly the way keeping them apart is meant to prevent.
 */
export async function seedClubConfig(
  db: Db,
  config: ClubConfig,
  options: SeedClubOptions = {},
): Promise<SeedClubResult> {
  assertScoringTeamsPublished(config, options.publishedScoringTeams ?? loadPublishedScoringTeams());

  return db.transaction(async (tx) => {
    const seasonId = await upsertSeason(tx, config.season);
    const clubId = await upsertClub(tx, config.club);

    // Read the club's current roster reach before rewriting anything: after the
    // squads are reconciled, a rider dropped from the config is unreachable.
    const priorRiderIds = await ridersInClubSquads(tx, clubId);

    await replaceScoringTeams(tx, clubId, seasonId, config);
    const { riderIds, ridersCreated, plates } = await replaceRiders(tx, seasonId, config);
    const squadMembers = await replaceSquads(tx, clubId, config, riderIds);

    const dropped = [...priorRiderIds].filter((id) => ![...riderIds.values()].includes(id));
    if (dropped.length > 0) {
      await tx
        .delete(schema.riderPlate)
        .where(
          and(
            eq(schema.riderPlate.seasonId, seasonId),
            inArray(schema.riderPlate.riderId, dropped),
          ),
        );
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

function assertScoringTeamsPublished(
  config: ClubConfig,
  publishedScoringTeams: Map<number, Set<string>>,
): void {
  const published = publishedScoringTeams.get(config.season);
  if (!published) {
    throw new ClubConfigError(`the config for ${config.club}`, [
      `no published scoring teams are recorded for season ${config.season}`,
    ]);
  }
  const unpublished = config.scoringTeams.filter((team) => !published.has(team));
  if (unpublished.length > 0) {
    throw new ClubConfigError(
      `the config for ${config.club}`,
      unpublished.map(
        (team) =>
          `scoring team "${team}" is not one the league published in ${config.season}; seeding it ` +
          `would drop the team out of the club rollup in silence`,
      ),
    );
  }
}

async function replaceScoringTeams(
  tx: Tx,
  clubId: number,
  seasonId: number,
  config: ClubConfig,
): Promise<void> {
  await tx
    .delete(schema.clubScoringTeam)
    .where(
      and(eq(schema.clubScoringTeam.clubId, clubId), eq(schema.clubScoringTeam.seasonId, seasonId)),
    );
  if (config.scoringTeams.length === 0) return;
  await tx
    .insert(schema.clubScoringTeam)
    .values(config.scoringTeams.map((scoringTeam) => ({ clubId, seasonId, scoringTeam })));
}

async function replaceRiders(
  tx: Tx,
  seasonId: number,
  config: ClubConfig,
): Promise<{ riderIds: Map<string, number>; ridersCreated: number; plates: number }> {
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
      .where(and(eq(schema.riderPlate.riderId, riderId), eq(schema.riderPlate.seasonId, seasonId)));
    if (rider.plates.length > 0) {
      await tx.insert(schema.riderPlate).values(
        rider.plates.map((binding) => ({
          riderId,
          seasonId,
          plate: binding.plate,
          fromRoundOrdinal: binding.fromRound,
          toRoundOrdinal: binding.toRound,
        })),
      );
    }
    plates += rider.plates.length;
  }

  return { riderIds, ridersCreated, plates };
}

async function replaceSquads(
  tx: Tx,
  clubId: number,
  config: ClubConfig,
  riderIds: Map<string, number>,
): Promise<number> {
  const names = config.squads.map((squad) => squad.name);
  await tx
    .delete(schema.squad)
    .where(
      names.length === 0
        ? eq(schema.squad.clubId, clubId)
        : and(eq(schema.squad.clubId, clubId), notInArray(schema.squad.name, names)),
    );

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
  return squadMembers;
}

/** The riders this club can currently reach, which is through its squads. */
async function ridersInClubSquads(tx: Tx, clubId: number): Promise<Set<number>> {
  const rows = await tx
    .select({ riderId: schema.squadMember.riderId })
    .from(schema.squadMember)
    .innerJoin(schema.squad, eq(schema.squad.id, schema.squadMember.squadId))
    .where(eq(schema.squad.clubId, clubId));
  return new Set(rows.map((row) => row.riderId));
}

async function upsertSeason(tx: Tx, year: number): Promise<number> {
  const existing = await tx.select().from(schema.season).where(eq(schema.season.year, year));
  if (existing[0]) return existing[0].id;
  const [row] = await tx.insert(schema.season).values({ year }).returning({ id: schema.season.id });
  return row!.id;
}

/**
 * Look up before inserting rather than upserting, so a second run reuses the
 * existing id instead of burning one from the serial sequence.
 */
async function upsertClub(executor: Executor, name: string): Promise<number> {
  const existing = await executor.select().from(schema.club).where(eq(schema.club.name, name));
  if (existing[0]) return existing[0].id;
  const [row] = await executor
    .insert(schema.club)
    .values({ name })
    .returning({ id: schema.club.id });
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
  plates: PlateBinding[],
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
      (binding) =>
        binding.plate === row.plate &&
        plateWindowsOverlap(binding, {
          fromRound: row.fromRoundOrdinal,
          toRound: row.toRoundOrdinal,
        }),
    ),
  );

  if (matches.length === 0) return null;
  // A merge — one config rider over what used to be two — resolves to the lower
  // id, and the row it leaves behind keeps its roster entry and loses its plates.
  return Math.min(...matches.map((row) => row.riderId));
}
