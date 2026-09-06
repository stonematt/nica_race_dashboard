/**
 * Seed a database with the two hand-maintained things it needs: the first
 * admin, and the club's own config. Runs under Node's native type stripping —
 * `node bin/seed.ts`, no build step.
 *
 *   node bin/seed.ts --club-config --email coach@example.org
 *   node bin/seed.ts --club-config --email coach@example.org --name "A Coach"
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
 * `--names`, else from the path outside the working tree that
 * src/lib/club-config.ts documents. With no such file every rider seeds as its
 * own pseudonym, because the committed config carries no identity.
 *
 * **There is no `--club` to type.** The club's name is whatever the config
 * declares, for the coach and the roster alike — nothing else can put them on
 * two different club rows (#62). `--club` still exists as an assertion: give it
 * a name that disagrees with the config and this refuses rather than seeds.
 *
 * Given both, the club config runs first so the admin lands on the club it
 * created. Safe to re-run — a second pass changes nothing and says so.
 */

import { ClubConfigError, loadClubConfig } from '../src/lib/club-config.ts';
import { createDb } from '../src/lib/db/index.ts';
import {
  ClubMismatchError,
  NotAllowlistedError,
  resolveAdminClub,
  seedAdmin,
  seedClubConfig,
  StrandedCoachError,
} from '../src/lib/seed.ts';
import { databaseUrl, loadEnvLocal } from './env.ts';

loadEnvLocal();

/** The value following `--<name>`, or undefined when the flag is a bare switch. */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const next = process.argv[i + 1];
  return next === undefined || next.startsWith('--') ? undefined : next;
}

const email = flag('email');
const requestedClub = flag('club');
const displayName = flag('name');
const seedClub = process.argv.includes('--club-config');

if (!seedClub && !email) {
  console.error(
    'usage: node bin/seed.ts [--club-config [file]] [--names <file>]\n' +
      '       node bin/seed.ts --email <address> [--name <display name>] [--club <name>]',
  );
  process.exit(2);
}

const url = databaseUrl();
const db = createDb(url);

try {
  // Read even for an admin-only run: the config is where the club's name lives,
  // and an admin seeded onto any other name is a coach with an empty app.
  const config = loadClubConfig({
    configFile: flag('club-config'),
    riderNamesFile: flag('names'),
  });

  if (seedClub) {
    const result = await seedClubConfig(db, config);
    console.log(
      `seeded ${config.club} for ${config.season} in ${url}: ` +
        `${result.scoringTeams} scoring teams, ${result.riders} riders ` +
        `(${result.ridersCreated} new), ${result.plates} plate mappings, ` +
        `${result.squads} squads, ${result.squadMembers} squad members`,
    );
  }

  if (email) {
    const clubName = resolveAdminClub(config, requestedClub);
    const result = await seedAdmin(db, { email, clubName, displayName });

    if (result.created) {
      console.log(
        `seeded ${result.email} as "${result.displayName}" on ${result.clubName} in ${url}`,
      );
    } else if (result.requestedClubName) {
      // The bug this replaced printed "nothing to do" naming the club it had
      // just upserted, so the recovery re-run reported a success that had not
      // happened. Say what the database holds, and that it is wrong.
      console.error(
        `refused: ${result.email} is already seeded, and the coach is on ${result.clubName} — ` +
          `not ${result.requestedClubName}, which is what this run asked for. Nothing was changed.\n` +
          `  The roster seeds onto ${config.club}, so a coach on any other club sees an empty app. ` +
          `Move the coach row onto ${result.requestedClubName}, or seed a fresh database.`,
      );
      process.exit(1);
    } else {
      console.log(
        `${result.email} is already seeded on ${result.clubName} in ${url} — nothing to do`,
      );
    }
  }

  process.exit(0);
} catch (error) {
  // Everything the operator can put right themselves: say what is wrong and
  // stop, rather than showing them a stack trace for their own typo.
  const refusals = [NotAllowlistedError, ClubConfigError, ClubMismatchError, StrandedCoachError];
  if (refusals.some((refusal) => error instanceof refusal)) {
    console.error(`refused: ${(error as Error).message}`);
    process.exit(1);
  }
  throw error;
}
