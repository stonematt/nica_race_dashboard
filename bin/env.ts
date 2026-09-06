/**
 * The environment the `bin/` entry points run in.
 *
 * Next loads `.env.local` for the app half. Nothing loaded it for a script run
 * as `node bin/seed.ts`, and that gap is issue #41: the bootstrap the README
 * documents read an empty `AUTH_ALLOWED_EMAILS` and refused the operator's own
 * address with `NotAllowlistedError` — a failure that names the wrong cause.
 *
 * **Why this is a module and not `node --env-file-if-exists=.env.local` in the
 * package.json scripts.** These files are meant to be run directly; their own
 * headers document `node bin/seed.ts`, and so does the README. A fix that only
 * takes effect through the pnpm wrapper leaves the identical trap set for the
 * identical person, and leaves the two invocations of one script disagreeing
 * about what environment they see. The loader is still Node's own — this takes
 * no dependency.
 *
 * Two properties of `process.loadEnvFile` the callers rely on:
 *
 *   - a variable already set in the real environment wins, so
 *     `DATABASE_URL=... pnpm seed` still overrides the file; and
 *   - it throws `ENOENT` on a missing file, which is what the existence check
 *     below is for. Having no `.env.local` is a supported state — `db:migrate`
 *     has to keep working on a fresh clone, from the default in
 *     `src/lib/db/url.ts`.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/** The repo root, resolved from this file rather than the working directory. */
export const repoRoot = path.join(import.meta.dirname, '..');

/**
 * Fill unset variables from `<root>/.env.local`, and return the file that was
 * read — or `undefined` when there was none. Absence is not an error.
 *
 * Call it first thing in an entry point, before anything reads `process.env`.
 */
export function loadEnvLocal(root: string = repoRoot): string | undefined {
  const file = path.join(root, '.env.local');
  if (!fs.existsSync(file)) return undefined;
  process.loadEnvFile(file);
  return file;
}
