/**
 * Migrate a database to the current schema. Runs under Node's native type
 * stripping — `node bin/migrate.ts`, no build step.
 */

import { migrate } from 'drizzle-orm/pglite/migrator';
import { createDb } from '../src/lib/db/index.ts';

const url = process.env.DATABASE_URL ?? './.pglite';
const db = createDb(url);

await migrate(db, { migrationsFolder: './src/lib/db/migrations' });
console.log(`migrated ${url}`);
process.exit(0);
