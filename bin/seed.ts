/**
 * Seed a database with the two hand-maintained things it needs: the first
 * admin, and the club's own config. Runs under Node's native type stripping —
 * `node bin/seed.ts`, no build step.
 *
 *   node bin/seed.ts --email coach@example.org --club Descenders
 *   node bin/seed.ts --email coach@example.org --club Descenders --name "A Coach"
 *   node bin/seed.ts --club-config
 *   node bin/seed.ts --club-config path/to/club-seed.json --names path/to/rider-names.json
 *
 * `--email` seeds the first coach who can sign in. The address must already be
 * on AUTH_ALLOWED_EMAILS or this refuses: seeding does not bypass the gate. See
 * src/lib/seed.ts for why.
 *
 * `--club-config` seeds the club, its scoring teams, the roster, the plate
 * mappings and the squads from config/club-seed.json, or from the file named
 * after the flag. Rider display names come from the key -> name map named by
 * `--names`, else `$NICA_RIDER_NAMES`, else the path outside the working tree
 * that src/lib/club-config.ts documents. With no such file every rider seeds as
 * its own pseudonym, because the committed config carries no identity.
 *
 * Given both, the club config runs first so the admin lands on the club it
 * created. Safe to re-run — a second pass changes nothing.
 */

import { ClubConfigError, loadClubConfig } from '../src/lib/club-config.ts';
import { createDb } from '../src/lib/db/index.ts';
import { NotAllowlistedError, seedAdmin, seedClubConfig } from '../src/lib/seed.ts';

/** The value after `--name`, or undefined when the flag is a bare switch. */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith('--') ? undefined : next;
}

const email = flag('email');
const clubName = flag('club');
const displayName = flag('name');
const seedClub = process.argv.includes('--club-config');

if (!seedClub && (!email || !clubName)) {
  console.error(
    'usage: node bin/seed.ts [--club-config [file]] [--names <file>]\n' +
      '       node bin/seed.ts --email <address> --club <name> [--name <display name>]',
  );
  process.exit(2);
}

const url = process.env.DATABASE_URL ?? './.pglite';
const db = createDb(url);

try {
  if (seedClub) {
    const config = loadClubConfig({
      configFile: flag('club-config'),
      riderNamesFile: flag('names'),
    });
    const result = await seedClubConfig(db, config);
    console.log(
      `seeded ${config.club} for ${config.season} in ${url}: ` +
        `${result.scoringTeams} scoring teams, ${result.riders} riders ` +
        `(${result.ridersCreated} new), ${result.plates} plate mappings, ` +
        `${result.squads} squads, ${result.squadMembers} squad members`,
    );
  }

  if (email && clubName) {
    const result = await seedAdmin(db, { email, clubName, displayName });
    console.log(
      result.created
        ? `seeded ${result.email} as "${result.displayName}" on ${result.clubName} in ${url}`
        : `${result.email} is already seeded on ${result.clubName} in ${url} — nothing to do`,
    );
  }

  process.exit(0);
} catch (error) {
  if (error instanceof NotAllowlistedError || error instanceof ClubConfigError) {
    console.error(`refused: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
