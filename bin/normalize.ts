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
 * The flat individual list is decoded here (issue #23); the rest of the catalog
 * is recognized, reported as skipped, and decoded by issue #25.
 */

import { createDb } from '../src/lib/db/index.ts';
import { loadCorpus } from '../src/lib/ingest/corpus.ts';
import { normalize } from '../src/lib/ingest/normalize.ts';
import { buildSnapshot } from '../src/lib/ingest/snapshot.ts';

const url = process.env.DATABASE_URL ?? './.pglite';
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

console.log(
  `decoded ${result.individualRows} individual results across ${result.events} events in ${url}; ` +
    `${result.lists - result.skipped} of ${result.lists} lists decoded, ` +
    `${result.skipped} recognized and left for issue #25`,
);
process.exit(0);
