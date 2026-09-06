/**
 * Decode archived payloads into the source-mirroring tables.
 *
 * Runs under Node's native type stripping — `node bin/normalize.ts`, no build
 * step.
 *
 *   node bin/normalize.ts --load-fixtures    archive the local corpus into raw
 *   node bin/normalize.ts                    decode the archive into the tables
 *   node bin/normalize.ts --snapshot         print the drift snapshot as JSON
 *
 * `--load-fixtures` is the offline half of `bin/fetch.ts`: it appends every
 * payload in `fixtures/` to `raw_fetch` without touching the network. The whole
 * 2025 season and the 2026 opener are already on disk (docs/fixtures.md), and
 * the crawl that produced them was deliberately slow out of respect for a
 * volunteer-run nonprofit's timing vendor — **do not re-fetch what is already
 * here.** It hangs off this entry point rather than off `bin/fetch.ts` because
 * it is what normalize reads: fill raw first, then decode.
 *
 * Decoding reads `raw_fetch` and nothing else — no network, ever — takes the
 * latest row per `(event_id, list_id)`, and writes one event per transaction.
 * All six published list families decode (issues #23 and #25); a list that is
 * recognized but not written — a duplicate layout, or a season snapshot rather
 * than the season record — is reported with the reason.
 */

import { createDb } from '../src/lib/db/index.ts';
import { loadCorpus } from '../src/lib/ingest/corpus.ts';
import { normalize } from '../src/lib/ingest/normalize.ts';
import { buildSnapshot } from '../src/lib/ingest/snapshot.ts';
import { databaseUrl, loadEnvLocal } from './env.ts';

loadEnvLocal();

const url = databaseUrl();
const db = createDb(url);

if (process.argv.includes('--load-fixtures')) {
  const loaded = await loadCorpus(db);
  console.log(
    `archived ${loaded.rows} payloads into raw_fetch in ${url}: ` +
      `${loaded.configs} configs and ${loaded.lists} lists across ${loaded.events} events`,
  );
  process.exit(0);
}

const result = await normalize(db);

if (process.argv.includes('--snapshot')) {
  console.log(JSON.stringify(buildSnapshot(result.placed), null, 2));
  process.exit(0);
}

const rows = Object.entries(result.rows)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([table, n]) => `${table} ${n}`)
  .join(', ');

console.log(
  `decoded ${result.decodedLists} of ${result.lists} lists across ${result.events} events ` +
    `in ${url} (${result.skipped} recognized and not written): ${rows}`,
);
process.exit(0);
