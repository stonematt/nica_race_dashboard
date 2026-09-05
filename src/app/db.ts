/**
 * The app's database handle.
 *
 * `createDb()` opens a PGlite instance, which is a real resource — one per
 * request would be both slow and, against a directory on disk, contended. Next
 * keeps a module's state for the lifetime of the server process, so one handle
 * is created lazily and reused.
 *
 * Lazily rather than at import: a module-level `createDb()` runs during page
 * data collection at build time, when `DATABASE_URL` may not be set and there
 * is nothing to query.
 */

import { createDb, type Database } from '@/lib/db/index.ts';

let handle: Database | undefined;

export function appDb(): Database {
  handle ??= createDb();
  return handle;
}
