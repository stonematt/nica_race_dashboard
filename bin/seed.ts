/**
 * Seed the first admin into a database. Runs under Node's native type
 * stripping — `node bin/seed.ts`, no build step.
 *
 *   node bin/seed.ts --email coach@example.org --club "Salem Composite Descenders"
 *   node bin/seed.ts --email coach@example.org --club "..." --name "A Coach"
 *
 * The address must already be on AUTH_ALLOWED_EMAILS or this refuses: seeding
 * does not bypass the gate. See src/lib/seed.ts for why.
 *
 * Safe to re-run — a second pass on the same database writes nothing.
 */

import { createDb } from '../src/lib/db/index.ts';
import { NotAllowlistedError, seedAdmin } from '../src/lib/seed.ts';

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const email = flag('email');
const clubName = flag('club');
const displayName = flag('name');

if (!email || !clubName) {
  console.error('usage: node bin/seed.ts --email <address> --club <name> [--name <display name>]');
  process.exit(2);
}

const url = process.env.DATABASE_URL ?? './.pglite';
const db = createDb(url);

try {
  const result = await seedAdmin(db, { email, clubName, displayName });
  console.log(
    result.created
      ? `seeded ${result.email} as "${result.displayName}" on ${result.clubName} in ${url}`
      : `${result.email} is already seeded on ${result.clubName} in ${url} — nothing to do`,
  );
  process.exit(0);
} catch (error) {
  if (error instanceof NotAllowlistedError) {
    console.error(`refused: ${error.message}`);
    process.exit(1);
  }
  throw error;
}
