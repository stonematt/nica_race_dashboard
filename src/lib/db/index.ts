/**
 * The one database module. All three entry points import this — bin/fetch.ts,
 * bin/normalize.ts, and the Next app — so there is one schema, one migration
 * history, and no workspace tooling.
 *
 * PGlite locally, Neon when hosted. Both are Postgres, so the schema file, the
 * SQL and the migrations are the same ones either way; moving to hosted is a
 * driver and connection-string change, not a rewrite. See issue #6.
 */

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema.ts';

export type Database = ReturnType<typeof createDb>;

/** A `postgres://` URL means hosted; anything else is a local PGlite directory. */
export function isHostedUrl(url: string): boolean {
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

export function createDb(url = process.env.DATABASE_URL ?? './.pglite') {
  if (isHostedUrl(url)) {
    // Deliberately not wired yet: nothing is hosted, and an untested Neon path
    // that silently half-works is worse than one that says so. The swap is
    // drizzle-orm/neon-serverless with the same `schema` object.
    throw new Error(
      `DATABASE_URL points at a hosted Postgres (${url.split('@').pop()}), which is not wired up yet. ` +
        `Hosting is a separate map — see issue #1. Use a local PGlite path for now.`,
    );
  }
  const client = new PGlite(url);
  return drizzle(client, { schema });
}

export { schema };
