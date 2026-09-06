/**
 * Season-keying the roster and the squads (#81).
 *
 * Two things are worth a test here and neither is exercised by the rest of the
 * suite. The first is the 0003 backfill: every other suite migrates a fresh
 * database, where `squad` is empty and `ADD COLUMN ... SET NOT NULL` cannot
 * fail. The interesting case is the one a developer actually has — a database
 * already carrying seeded squads — so this suite stops at 0002, plants those
 * rows, and then applies 0003 the way a real upgrade would.
 *
 * The second is the shape of the new keys, which encode two decisions: a squad
 * name repeats across seasons (it is a different squad), and a rider may hold
 * membership in two clubs in one season (that is a mid-season transfer).
 */

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { PGlite } from '@electric-sql/pglite';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import * as schema from './schema.ts';
import { createTestDb, migrationsFolder, type TestDatabase } from './testing.ts';

type Journal = { entries: { idx: number; tag: string }[] };

/**
 * A migration folder holding only the first `count` migrations, so a suite can
 * stand a database up at an earlier point in history. Copies rather than
 * mutates: the real folder is what every other suite reads.
 */
function migrationsUpTo(count: number): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
  fs.mkdirSync(path.join(dir, 'meta'));
  const journal = JSON.parse(
    fs.readFileSync(path.join(migrationsFolder, 'meta', '_journal.json'), 'utf8'),
  ) as Journal;
  const kept = journal.entries.slice(0, count);
  for (const entry of kept) {
    fs.copyFileSync(
      path.join(migrationsFolder, `${entry.tag}.sql`),
      path.join(dir, `${entry.tag}.sql`),
    );
  }
  fs.writeFileSync(
    path.join(dir, 'meta', '_journal.json'),
    JSON.stringify({ ...journal, entries: kept }),
  );
  return dir;
}

/** The 0003 statements, applied the way the migrator applies them. */
async function applySeasonKeyedRoster(client: PGlite): Promise<void> {
  const file = fs.readFileSync(path.join(migrationsFolder, '0003_season_keyed_roster.sql'), 'utf8');
  for (const statement of file.split('--> statement-breakpoint')) {
    await client.exec(statement);
  }
}

describe('the 0003 backfill, against a database that already has squads', () => {
  let client: PGlite;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = new PGlite();
    db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: migrationsUpTo(3) });

    // Three clubs, in the three states a real database can be in.
    await db.execute(sql`insert into season (id, year) values (1, 2025), (2, 2026)`);
    await db.execute(sql`
      insert into club (id, name)
      values (1, 'One Season'), (2, 'Two Seasons'), (3, 'No Scoring Teams')`);
    await db.execute(sql`
      insert into club_scoring_team (club_id, season_id, scoring_team) values
        (1, 1, 'Salem Composite'),
        (2, 1, 'Bend Composite'),
        (2, 2, 'Bend Composite')`);

    // Pre-0003 squad rows: club and name only, no season anywhere.
    await db.execute(sql`
      insert into squad (id, club_id, name) values
        (1, 1, 'JV'), (2, 1, 'Varsity'), (3, 2, 'JV'), (4, 3, 'Orphan')`);

    await applySeasonKeyedRoster(client);
  });

  const seasonOf = async (squadId: number) => {
    const rows = await db.execute(sql`select season_id from squad where id = ${squadId}`);
    return Number((rows.rows[0] as { season_id: number }).season_id);
  };

  it('gives a club seeded for one season that season', async () => {
    expect(await seasonOf(1)).toBe(1);
    expect(await seasonOf(2)).toBe(1);
  });

  it('gives a club seeded twice its latest season, which is the config that last wrote them', async () => {
    expect(await seasonOf(3)).toBe(2);
  });

  it('falls back to the latest season on record for a club with no scoring teams', async () => {
    expect(await seasonOf(4)).toBe(2);
  });

  it('leaves the column not-null, so nothing can be written seasonless afterwards', async () => {
    await expect(
      db.execute(sql`insert into squad (club_id, name) values (1, 'Seasonless')`),
    ).rejects.toThrow();
  });
});

describe('the season-keyed shape', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDb();
    await db.insert(schema.season).values([
      { id: 1, year: 2025 },
      { id: 2, year: 2026 },
    ]);
    await db.insert(schema.club).values([
      { id: 1, name: 'Salem Composite Descenders' },
      { id: 2, name: 'Bend Composite' },
    ]);
    await db.insert(schema.rider).values([
      { id: 1, displayName: '«RIDER-A»' },
      { id: 2, displayName: '«RIDER-B»' },
    ]);
  });

  describe('squads', () => {
    it('lets a name repeat across seasons, because that is a different squad', async () => {
      await db.insert(schema.squad).values([
        { id: 10, clubId: 1, seasonId: 1, name: 'JV' },
        { id: 11, clubId: 1, seasonId: 2, name: 'JV' },
      ]);
      const rows = await db.execute(sql`select count(*) as n from squad where name = 'JV'`);
      expect(Number((rows.rows[0] as { n: number }).n)).toBe(2);
    });

    it('refuses the same name twice in one club and season', async () => {
      await db.insert(schema.squad).values({ id: 12, clubId: 2, seasonId: 1, name: 'Varsity' });
      await expect(
        db.insert(schema.squad).values({ id: 13, clubId: 2, seasonId: 1, name: 'Varsity' }),
      ).rejects.toThrow();
    });
  });

  describe('club membership', () => {
    it('records a rider as this club’s for a season, with no squad and no result', async () => {
      await db.insert(schema.clubMember).values({ clubId: 1, seasonId: 1, riderId: 1 });
      const rows = await db.execute(sql`select count(*) as n from club_member where rider_id = 1`);
      expect(Number((rows.rows[0] as { n: number }).n)).toBe(1);
    });

    it('keeps a rider in the seasons they rode after they move on', async () => {
      await db.insert(schema.clubMember).values([
        { clubId: 1, seasonId: 1, riderId: 2 },
        { clubId: 2, seasonId: 2, riderId: 2 },
      ]);

      // The club they left still sees them in 2025 — the read by (club, season).
      const left = await db.execute(
        sql`select rider_id from club_member where club_id = 1 and season_id = 1 order by rider_id`,
      );
      expect(left.rows.map((r) => Number((r as { rider_id: number }).rider_id))).toEqual([1, 2]);

      // The rider carries both — the read by rider.
      const career = await db.execute(
        sql`select club_id, season_id from club_member where rider_id = 2 order by season_id`,
      );
      expect(career.rows).toHaveLength(2);
    });

    it('allows two clubs in one season, which is what a mid-season transfer is', async () => {
      await db.insert(schema.clubMember).values([
        { clubId: 1, seasonId: 2, riderId: 1 },
        { clubId: 2, seasonId: 2, riderId: 1 },
      ]);
      const rows = await db.execute(
        sql`select count(*) as n from club_member where rider_id = 1 and season_id = 2`,
      );
      expect(Number((rows.rows[0] as { n: number }).n)).toBe(2);
    });

    it('refuses the same rider twice in one club and season', async () => {
      await expect(
        db.insert(schema.clubMember).values({ clubId: 1, seasonId: 1, riderId: 1 }),
      ).rejects.toThrow();
    });
  });
});
