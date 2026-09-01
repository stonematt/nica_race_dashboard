/**
 * The test database seam.
 *
 * Every suite that needs real Postgres gets a fresh in-memory PGlite, migrated
 * to the current schema — tables and views both. In-memory means no cleanup, no
 * shared state between suites, and no fixture files on disk, which matters here
 * because the fixture corpus is minors' race results and stays out of the tree
 * (see docs/fixtures.md).
 *
 * Migrations resolve relative to this file rather than the working directory,
 * so a suite runs the same from the repo root, from an editor, or from CI.
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as path from 'node:path';
import * as schema from './schema.ts';

export type TestDatabase = ReturnType<typeof drizzle<typeof schema>>;

export const migrationsFolder = path.join(import.meta.dirname, 'migrations');

/** A fresh, fully migrated, in-memory database. Nothing to tear down. */
export async function createTestDb(): Promise<TestDatabase> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder });
  return db;
}
