/**
 * Seeding, both halves.
 *
 * For the first admin, two properties carry the weight: it refuses an address
 * the allowlist does not carry, and running it twice is a no-op.
 *
 * For the club config, four do: it fills all six config tables, it is
 * idempotent, a plate reissued mid-season resolves to the right person on each
 * side of its boundary, and adding a mapping drops a rider out of
 * `v_unmapped_rider` without touching a normalized row.
 */

import { eq } from 'drizzle-orm';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadEnvLocal } from '../../bin/env.ts';
import { ClubConfigError, loadClubConfig, pseudonymFor, type ClubConfig } from './club-config.ts';
import { createTestDb, type TestDatabase } from './db/testing.ts';
import { resolveDatabaseUrl } from './db/url.ts';
import * as schema from './db/schema.ts';
import {
  ClubMismatchError,
  NotAllowlistedError,
  resolveAdminClub,
  seedAdmin,
  seedClubConfig,
  StrandedCoachError,
} from './seed.ts';

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

/**
 * A re-run reports the database, not what the run asked for (#62).
 *
 * The README used to name a club the config did not, so the documented setup
 * produced two club rows — coach on one, roster on the other — and the obvious
 * recovery, re-running with the right name, printed success and changed
 * nothing. Both halves of that are covered here.
 */
describe('seedAdmin on a database that already has the coach', () => {
  const OTHER = 'Descenders';

  it('names the club the coach is on, not the one the run asked for', async () => {
    const first = await seedAdmin(db, { email: 'coach@example.org', clubName: CLUB, env });
    const second = await seedAdmin(db, { email: 'coach@example.org', clubName: OTHER, env });

    // Throwing rather than expect(): it narrows the result union, so the
    // mismatch field below is only reachable on the branch that can carry it.
    if (second.created) throw new Error('expected the existing coach, not a fresh seed');

    expect(second.clubName).toBe(CLUB);
    expect(second.clubId).toBe(first.clubId);
    expect(second.requestedClubName).toBe(OTHER);
  });

  it('creates no second club row for the club it was asked for', async () => {
    await seedAdmin(db, { email: 'coach@example.org', clubName: CLUB, env });
    await seedAdmin(db, { email: 'coach@example.org', clubName: OTHER, env });

    const clubs = await db.select().from(schema.club);
    expect(clubs.map((c) => c.name)).toEqual([CLUB]);
  });

  it('stays a calm no-op when the club agrees', async () => {
    await seedAdmin(db, { email: 'coach@example.org', clubName: CLUB, env });
    const again = await seedAdmin(db, { email: 'coach@example.org', clubName: CLUB, env });

    if (again.created) throw new Error('expected the existing coach, not a fresh seed');

    expect(again.requestedClubName).toBeUndefined();
    expect(await db.select().from(schema.club)).toHaveLength(1);
    expect(await db.select().from(schema.coach)).toHaveLength(1);
  });

  it('reports the display name the coach row carries, not the one passed in', async () => {
    await seedAdmin(db, {
      email: 'coach@example.org',
      clubName: CLUB,
      displayName: 'A Coach',
      env,
    });
    const again = await seedAdmin(db, {
      email: 'coach@example.org',
      clubName: CLUB,
      displayName: 'Someone Else',
      env,
    });

    expect(again.displayName).toBe('A Coach');
  });
});

/**
 * Which club an admin seed lands on. The config file carries the club's
 * identity, so it is the answer, and `--club` is at most an agreement.
 */
describe('resolveAdminClub', () => {
  const config = { club: 'Descenders' } as ClubConfig;

  it('answers with the config’s club when nothing was asked for', () => {
    expect(resolveAdminClub(config)).toBe('Descenders');
    expect(resolveAdminClub(config, '  ')).toBe('Descenders');
  });

  it('accepts a --club that agrees', () => {
    expect(resolveAdminClub(config, ' Descenders ')).toBe('Descenders');
  });

  it('refuses a --club that disagrees, before anything is written', () => {
    // upsertClub matches on the name, so honouring both would put the coach on
    // one club row and the whole roster on another.
    expect(() => resolveAdminClub(config, CLUB)).toThrow(ClubMismatchError);
    expect(() => resolveAdminClub(config, CLUB)).toThrow(/Descenders/);
  });
});

/* ============================================================================
 * The bootstrap environment — what bin/ reads before any of the above runs
 * ========================================================================= */

/**
 * Next loads `.env.local` for the app half and nothing loaded it for the `bin/`
 * half, so the documented bootstrap read an empty allowlist and refused the
 * operator's own address (#41). These cover the loader `bin/` now calls, and
 * the two states a fresh clone can be in.
 *
 * They live here rather than beside `bin/env.ts` because both vitest lanes
 * collect only `src/**` and `scripts/**` — a `bin/env.test.ts` would never run.
 * Widening the include globs is a config change, and this is a seeding failure,
 * so they sit with the seeding they broke.
 */
describe('the bin/ bootstrap environment', () => {
  const keys = ['AUTH_ALLOWED_EMAILS', 'DATABASE_URL'] as const;
  let saved: Record<string, string | undefined>;
  let dir: string;

  beforeEach(() => {
    saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
    for (const key of keys) delete process.env[key];
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bike-env-'));
  });

  afterEach(() => {
    for (const key of keys) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('feeds the seed path an allowlist from .env.local, with nothing on the command line', async () => {
    fs.writeFileSync(path.join(dir, '.env.local'), 'AUTH_ALLOWED_EMAILS="coach@example.org"\n');

    expect(loadEnvLocal(dir)).toBe(path.join(dir, '.env.local'));

    // No `env` option: seedAdmin reads process.env, exactly as bin/seed.ts leaves it.
    const result = await seedAdmin(db, { email: 'coach@example.org', clubName: CLUB });
    expect(result.created).toBe(true);
  });

  it('still refuses an unlisted address once the file is loaded', async () => {
    // The empty-allowlist failure and a real rejection have to stay tellable
    // apart: this ticket must not make a genuine refusal quieter.
    fs.writeFileSync(path.join(dir, '.env.local'), 'AUTH_ALLOWED_EMAILS="coach@example.org"\n');
    loadEnvLocal(dir);

    await expect(seedAdmin(db, { email: 'stranger@example.org', clubName: CLUB })).rejects.toThrow(
      NotAllowlistedError,
    );
  });

  it('treats a missing .env.local as a supported state, so db:migrate still has a database', () => {
    expect(loadEnvLocal(dir)).toBeUndefined();
    expect(resolveDatabaseUrl()).toBe('./.pglite');
  });

  it('lets a variable already in the environment beat the file', () => {
    fs.writeFileSync(path.join(dir, '.env.local'), 'DATABASE_URL="./from-file"\n');
    process.env.DATABASE_URL = './from-shell';

    loadEnvLocal(dir);

    expect(resolveDatabaseUrl()).toBe('./from-shell');
  });

  /**
   * The tests above prove the loader; this one proves every entry point routes
   * through it. Asserted against the source rather than by running the scripts,
   * because running them is the one thing this repo will not do in a test:
   * `bin/migrate.ts` writes to whatever `DATABASE_URL` resolves to, and
   * `bin/fetch.ts` calls a volunteer-run nonprofit's live API.
   */
  it('has every bin/ entry point load the file before it reads the environment', () => {
    const root = path.join(import.meta.dirname, '..', '..', 'bin');

    for (const entry of ['seed.ts', 'migrate.ts', 'normalize.ts', 'fetch.ts']) {
      const source = fs.readFileSync(path.join(root, entry), 'utf8');
      expect(source, entry).toMatch(/^loadEnvLocal\(\);$/m);
      // A direct read would resolve before the file was loaded, which is the bug.
      expect(source, entry).not.toMatch(/process\.env\.DATABASE_URL/);
    }
  });
});

/* ============================================================================
 * Club config — the hand-maintained half
 * ========================================================================= */

const SALEM = 'Salem Composite';
const SOUTH_SALEM = 'South Salem High School Descenders';
const SPRAGUE = 'Sprague High School Descenders';

const plate = (p: string, fromRound: number | null = null, toRound: number | null = null) => ({
  plate: p,
  fromRound,
  toRound,
});

const rider = (key: string, ...plates: ReturnType<typeof plate>[]) => ({
  key,
  displayName: pseudonymFor(key),
  plates,
});

const clubConfig = (overrides: Partial<ClubConfig> = {}): ClubConfig => ({
  club: 'Descenders',
  season: 2025,
  scoringTeams: [SALEM],
  riders: [rider('rider-a', plate('202'))],
  squads: [{ name: 'Descenders', members: ['rider-a'] }],
  ...overrides,
});

/**
 * An archived race, inserted straight into the normalized layer. Normalizing a
 * real payload is a different lane's work (#22/#23); the config half only needs
 * result rows to resolve against, so these are the rows normalize would have
 * written rather than rows it did.
 */
async function archiveRace(
  seasonId: number,
  ordinal: number,
  entries: [plate: string, scoringTeam: string][],
) {
  await db.insert(schema.round).values({ id: ordinal, seasonId, ordinal, name: `Race ${ordinal}` });
  await db.insert(schema.event).values({
    id: ordinal,
    roundId: ordinal,
    sourceEventId: `36349${ordinal}`,
    conference: 'North',
    name: `Race ${ordinal} - North`,
  });
  await db.insert(schema.individualResult).values(
    entries.map(([bib, scoringTeam], index) => ({
      eventId: ordinal,
      plate: bib,
      displayName: `RACER ${bib}`,
      scoringTeam,
      categoryRaw: 'HS1 Boys - North',
      place: String(index + 1),
      status: 'finished',
      timeRaw: '47:09.83',
      timeSeconds: '2829.83',
      laps: 3,
    })),
  );
}

const unmapped = async () =>
  (await db.execute(`select plate, club_name, round_ordinal from v_unmapped_rider order by plate`))
    .rows as Record<string, unknown>[];

describe('seedClubConfig', () => {
  it('populates all six config tables', async () => {
    const result = await seedClubConfig(
      db,
      clubConfig({
        scoringTeams: [SALEM, SOUTH_SALEM, SPRAGUE],
        riders: [rider('rider-a', plate('202')), rider('rider-b', plate('204'), plate('210'))],
        squads: [{ name: 'Descenders', members: ['rider-a', 'rider-b'] }],
      }),
    );

    expect(result.ridersCreated).toBe(2);
    expect(await db.select().from(schema.club)).toHaveLength(1);
    expect(await db.select().from(schema.clubScoringTeam)).toHaveLength(3);
    expect(await db.select().from(schema.rider)).toHaveLength(2);
    expect(await db.select().from(schema.riderPlate)).toHaveLength(3);
    expect(await db.select().from(schema.squad)).toHaveLength(1);
    expect(await db.select().from(schema.squadMember)).toHaveLength(2);
  });

  it('names a rider by the pseudonym when no local names file supplied one', async () => {
    await seedClubConfig(db, clubConfig());
    const riders = await db.select().from(schema.rider);
    expect(riders[0]!.displayName).toBe('«RIDER-A»');
  });

  it('creates the season row rather than waiting on an ingest to supply it', async () => {
    const result = await seedClubConfig(db, clubConfig());
    const seasons = await db.select().from(schema.season);
    expect(seasons).toHaveLength(1);
    expect(seasons[0]!.year).toBe(2025);
    expect(seasons[0]!.id).toBe(result.seasonId);
  });

  it('is idempotent — a second run duplicates nothing and creates no rider', async () => {
    const config = clubConfig({
      scoringTeams: [SALEM, SPRAGUE],
      riders: [rider('rider-a', plate('202')), rider('rider-b', plate('204'))],
      squads: [{ name: 'Descenders', members: ['rider-a', 'rider-b'] }],
    });
    const first = await seedClubConfig(db, config);
    const second = await seedClubConfig(db, config);

    expect(first.ridersCreated).toBe(2);
    expect(second.ridersCreated).toBe(0);
    expect(second.clubId).toBe(first.clubId);
    expect(second.seasonId).toBe(first.seasonId);

    expect(await db.select().from(schema.club)).toHaveLength(1);
    expect(await db.select().from(schema.clubScoringTeam)).toHaveLength(2);
    expect(await db.select().from(schema.rider)).toHaveLength(2);
    expect(await db.select().from(schema.riderPlate)).toHaveLength(2);
    expect(await db.select().from(schema.squad)).toHaveLength(1);
    expect(await db.select().from(schema.squadMember)).toHaveLength(2);
  });

  it('reuses the club seedAdmin already created rather than making a second one', async () => {
    await seedAdmin(db, { email: 'coach@example.org', clubName: 'Descenders', env });
    const result = await seedClubConfig(db, clubConfig());

    const clubs = await db.select().from(schema.club);
    expect(clubs).toHaveLength(1);
    expect(clubs[0]!.id).toBe(result.clubId);
  });

  it('refuses to seed onto a club that strands the coach already in the database', async () => {
    // The other half of #62, reached by editing the config's club rather than
    // by the README: the roster would land on the new name and the coach would
    // keep the old one, which is two club rows and an empty app.
    await seedAdmin(db, { email: 'coach@example.org', clubName: 'Salem Composite', env });

    await expect(seedClubConfig(db, clubConfig({ club: 'Descenders' }))).rejects.toThrow(
      StrandedCoachError,
    );

    const clubs = await db.select().from(schema.club);
    expect(clubs.map((c) => c.name)).toEqual(['Salem Composite']);
  });

  it('drops a scoring team the config no longer lists', async () => {
    await seedClubConfig(db, clubConfig({ scoringTeams: [SALEM, SPRAGUE] }));
    await seedClubConfig(db, clubConfig({ scoringTeams: [SALEM] }));

    const teams = await db.select().from(schema.clubScoringTeam);
    expect(teams.map((t) => t.scoringTeam)).toEqual([SALEM]);
  });

  it('renames a rider in place when a names file arrives, rather than duplicating them', async () => {
    await seedClubConfig(db, clubConfig());
    await seedClubConfig(
      db,
      clubConfig({
        riders: [{ key: 'rider-a', displayName: 'A Real Name', plates: [plate('202')] }],
      }),
    );

    const riders = await db.select().from(schema.rider);
    expect(riders).toHaveLength(1);
    expect(riders[0]!.displayName).toBe('A Real Name');
  });

  it('removes a plate mapping the config dropped, so a stale one cannot resolve', async () => {
    await seedClubConfig(
      db,
      clubConfig({ riders: [rider('rider-a', plate('202'), plate('204'))] }),
    );
    await seedClubConfig(db, clubConfig({ riders: [rider('rider-a', plate('202'))] }));

    const mappings = await db.select().from(schema.riderPlate);
    expect(mappings.map((m) => m.plate)).toEqual(['202']);
  });

  it('seeds the checked-in config end to end', async () => {
    // The committed file, loaded and validated exactly as `pnpm seed` would.
    const config = loadClubConfig({
      riderNamesFile: path.join(os.tmpdir(), 'no-such-rider-names.json'),
    });
    const result = await seedClubConfig(db, config);

    expect(result.scoringTeams).toBe(3);
    expect(result.riders).toBeGreaterThan(0);
    expect(await db.select().from(schema.rider)).toHaveLength(config.riders.length);

    const names = (await db.select().from(schema.rider)).map((r) => r.displayName);
    expect(names.every((n) => /^«RIDER-[A-Z]+»$/.test(n))).toBe(true);
  });
});

/**
 * The sequence the README documents, against a fresh database — the thing that
 * used to end with the coach on one club and the roster on another (#62).
 *
 * Driven through the same functions `bin/seed.ts` calls, rather than by running
 * the commands: `pnpm db:migrate` and `pnpm seed` write to whatever
 * `DATABASE_URL` resolves to, and a test must not.
 */
describe('the README setup sequence', () => {
  it('ends with one club, one coach, and the roster reachable from that coach', async () => {
    const config = loadClubConfig({
      riderNamesFile: path.join(os.tmpdir(), 'no-such-rider-names.json'),
    });

    // `node bin/seed.ts --club-config --email you@example.org`: config first, so
    // the admin lands on the club it created.
    await seedClubConfig(db, config);
    const admin = await seedAdmin(db, {
      email: 'coach@example.org',
      clubName: resolveAdminClub(config),
      env,
    });

    const clubs = await db.select().from(schema.club);
    expect(clubs).toHaveLength(1);
    expect(clubs[0]!.name).toBe(config.club);

    const coaches = await db.select().from(schema.coach);
    expect(coaches).toHaveLength(1);
    expect(coaches[0]!.clubId).toBe(clubs[0]!.id);
    expect(admin.clubId).toBe(clubs[0]!.id);

    // The roster the coach can actually see: squads on their club, with members.
    const squads = await db
      .select()
      .from(schema.squad)
      .where(eq(schema.squad.clubId, coaches[0]!.clubId));
    expect(squads.length).toBeGreaterThan(0);

    const members = await db
      .select()
      .from(schema.squadMember)
      .where(eq(schema.squadMember.squadId, squads[0]!.id));
    expect(members).toHaveLength(config.riders.length);
  });
});

describe('seedClubConfig refuses an unpublished scoring team', () => {
  it('fails loudly rather than seeding a string the league does not publish', async () => {
    // Validating in the loader is not enough: the requirement is that *seeding*
    // refuses, not that every caller remembered to validate first.
    await expect(
      seedClubConfig(db, clubConfig({ scoringTeams: ['Sprague Descenders'] })),
    ).rejects.toThrow(ClubConfigError);

    expect(await db.select().from(schema.club)).toHaveLength(0);
    expect(await db.select().from(schema.rider)).toHaveLength(0);
  });

  it('fails loudly on a season with no published set', async () => {
    await expect(seedClubConfig(db, clubConfig({ season: 2019 }))).rejects.toThrow(ClubConfigError);
  });
});

describe('seedClubConfig cleans up what the config dropped', () => {
  const twoRiders = clubConfig({
    riders: [rider('rider-a', plate('202')), rider('rider-b', plate('204'))],
    squads: [{ name: 'Descenders', members: ['rider-a', 'rider-b'] }],
  });

  it('clears the plate mappings of a rider the config no longer lists', async () => {
    const { seasonId } = await seedClubConfig(db, twoRiders);
    await seedClubConfig(
      db,
      clubConfig({
        riders: [rider('rider-a', plate('202'))],
        squads: [{ name: 'Descenders', members: ['rider-a'] }],
      }),
    );

    // The roster row survives — dropping a rider is not this edit's decision —
    // but the stale mapping must not go on resolving plate 204 to them.
    expect(await db.select().from(schema.rider)).toHaveLength(2);
    const mappings = await db.select().from(schema.riderPlate);
    expect(mappings.map((m) => m.plate)).toEqual(['202']);

    await archiveRace(seasonId, 1, [['204', SALEM]]);
    expect((await unmapped()).map((r) => r.plate)).toEqual(['204']);
  });

  it('removes a squad the config no longer names, members and all', async () => {
    await seedClubConfig(db, twoRiders);
    await seedClubConfig(
      db,
      clubConfig({
        riders: [rider('rider-a', plate('202')), rider('rider-b', plate('204'))],
        squads: [{ name: 'Racers', members: ['rider-a'] }],
      }),
    );

    const squads = await db.select().from(schema.squad);
    expect(squads.map((s) => s.name)).toEqual(['Racers']);
    expect(await db.select().from(schema.squadMember)).toHaveLength(1);
  });
});

/**
 * A config file carries exactly one season, so seeding is a per-season edit.
 * Before squads were season-keyed (#81) the reconcile was scoped by club alone,
 * and seeding the new year reaped the old year's squads as though the coach had
 * deleted them — taking last season's roster grouping with them.
 */
describe('seedClubConfig across seasons', () => {
  const published = new Map([
    [2025, new Set([SALEM])],
    [2026, new Set([SALEM])],
  ]);
  const seed = (year: number, squadName: string, ...members: string[]) =>
    seedClubConfig(
      db,
      clubConfig({
        season: year,
        riders: members.map((key, index) => rider(key, plate(`20${index + 2}`))),
        squads: [{ name: squadName, members }],
      }),
      { publishedScoringTeams: published },
    );

  /**
   * The squads must be named differently per season for this to bite: the
   * reconcile deletes what the config no longer names, so a name carried over
   * would survive a club-scoped delete by accident and prove nothing.
   */
  it('leaves last season’s squads standing when the new season renames them', async () => {
    const first = await seed(2025, 'Descenders', 'rider-a', 'rider-b');
    const second = await seed(2026, 'Racers', 'rider-a');

    const squads = await db.select().from(schema.squad).orderBy(schema.squad.seasonId);
    expect(squads.map((s) => [s.seasonId, s.name])).toEqual([
      [first.seasonId, 'Descenders'],
      [second.seasonId, 'Racers'],
    ]);
  });

  it('keeps each season’s membership on its own squad', async () => {
    const first = await seed(2025, 'Descenders', 'rider-a', 'rider-b');
    const second = await seed(2026, 'Racers', 'rider-a');

    const rows = await db
      .select({ seasonId: schema.squad.seasonId, riderId: schema.squadMember.riderId })
      .from(schema.squadMember)
      .innerJoin(schema.squad, eq(schema.squad.id, schema.squadMember.squadId));

    expect(rows.filter((r) => r.seasonId === first.seasonId)).toHaveLength(2);
    expect(rows.filter((r) => r.seasonId === second.seasonId)).toHaveLength(1);
  });

  it('gives a squad name carried across two seasons a row in each', async () => {
    const first = await seed(2025, 'Descenders', 'rider-a');
    const second = await seed(2026, 'Descenders', 'rider-a');

    const squads = await db.select().from(schema.squad);
    expect(squads).toHaveLength(2);
    expect(squads.map((s) => s.seasonId).sort()).toEqual([first.seasonId, second.seasonId]);
  });

  it('still reconciles within a season, so a re-seed does not accumulate squads', async () => {
    await seed(2025, 'Descenders', 'rider-a');
    await seed(2025, 'Descenders', 'rider-a');
    expect(await db.select().from(schema.squad)).toHaveLength(1);
  });
});

describe('v_unmapped_rider, against config', () => {
  it('names the riders on the club’s scoring teams that no mapping resolves', async () => {
    const { seasonId } = await seedClubConfig(
      db,
      clubConfig({
        scoringTeams: [SALEM, SPRAGUE],
        riders: [rider('rider-a', plate('202'))],
        squads: [],
      }),
    );
    await archiveRace(seasonId, 1, [
      ['202', SPRAGUE],
      ['204', SALEM],
      ['974', 'Ida B. Wells High School'],
    ]);

    const rows = await unmapped();
    // 202 is mapped. 974 is another club's rider and is not this warning's
    // business. 204 is ours and unmapped, which is the whole point.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.plate).toBe('204');
    expect(rows[0]!.club_name).toBe('Descenders');
  });

  it('drops a rider from the warning when the mapping is added, with no re-normalize', async () => {
    const { seasonId } = await seedClubConfig(db, clubConfig({ squads: [] }));
    await archiveRace(seasonId, 1, [
      ['202', SALEM],
      ['204', SALEM],
    ]);

    expect((await unmapped()).map((r) => r.plate)).toEqual(['204']);

    const before = await db.select().from(schema.individualResult);
    await seedClubConfig(
      db,
      clubConfig({
        riders: [rider('rider-a', plate('202')), rider('rider-b', plate('204'))],
        squads: [],
      }),
    );

    expect(await unmapped()).toHaveLength(0);
    // The normalized layer is untouched: config resolves at query time, so a
    // mapping added in March re-labels February without re-ingesting anything.
    expect(await db.select().from(schema.individualResult)).toEqual(before);
  });
});

describe('a reissued plate', () => {
  it('resolves to the right rider on each side of the boundary', async () => {
    const { seasonId } = await seedClubConfig(
      db,
      clubConfig({
        // One plate, two people, disjoint in time — the reissue case.
        riders: [rider('rider-a', plate('204', null, 2)), rider('rider-b', plate('204', 3, null))],
        squads: [],
      }),
    );
    await archiveRace(seasonId, 2, [['204', SALEM]]);
    await archiveRace(seasonId, 3, [['204', SALEM]]);

    const rows = (
      await db.execute(
        `select round_ordinal, rider_name from v_rider_result where plate = '204' order by round_ordinal`,
      )
    ).rows as Record<string, unknown>[];

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ round_ordinal: 2, rider_name: '«RIDER-A»' });
    expect(rows[1]).toMatchObject({ round_ordinal: 3, rider_name: '«RIDER-B»' });
    // And neither round resolves to both people.
    expect(await unmapped()).toHaveLength(0);
  });

  it('keeps the two riders apart across a re-seed', async () => {
    const config = clubConfig({
      riders: [rider('rider-a', plate('204', null, 2)), rider('rider-b', plate('204', 3, null))],
      squads: [],
    });
    await seedClubConfig(db, config);
    const second = await seedClubConfig(db, config);

    expect(second.ridersCreated).toBe(0);
    expect(await db.select().from(schema.rider)).toHaveLength(2);
    expect(await db.select().from(schema.riderPlate)).toHaveLength(2);
  });
});

describe('v_club_result', () => {
  it('rolls a club spanning three scoring teams up to one club', async () => {
    const { seasonId, clubId } = await seedClubConfig(
      db,
      clubConfig({
        scoringTeams: [SALEM, SOUTH_SALEM, SPRAGUE],
        riders: [
          rider('rider-a', plate('202')),
          rider('rider-b', plate('204')),
          rider('rider-c', plate('210')),
        ],
        squads: [],
      }),
    );
    await archiveRace(seasonId, 1, [
      ['202', SPRAGUE],
      ['204', SALEM],
      ['210', SOUTH_SALEM],
      ['974', 'Ida B. Wells High School'],
    ]);

    const rows = (
      await db.execute(
        `select club_id, club_name, scoring_team from v_club_result order by scoring_team`,
      )
    ).rows as Record<string, unknown>[];

    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.club_id))).toEqual(new Set([clubId]));
    expect(rows.map((r) => r.scoring_team)).toEqual([SALEM, SOUTH_SALEM, SPRAGUE]);
  });
});
