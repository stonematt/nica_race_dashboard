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
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadClubConfig, pseudonymFor, type ClubConfig } from './club-config.ts';
import { createTestDb, type TestDatabase } from './db/testing.ts';
import * as schema from './db/schema.ts';
import { NotAllowlistedError, seedAdmin, seedClubConfig } from './seed.ts';

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
