/**
 * Decode archived payloads into the source-mirroring tables.
 *
 * Runs under Node's native type stripping — `node bin/normalize.ts`, no build
 * step.
 *
 *   node bin/normalize.ts --load-fixtures    archive the local corpus into raw
 *
 * `--load-fixtures` is the offline half of `bin/fetch.ts`: it appends every
 * payload in `fixtures/` to `raw_fetch` without touching the network. The whole
 * 2025 season and the 2026 opener are already on disk (docs/fixtures.md), and
 * the crawl that produced them was deliberately slow out of respect for a
 * volunteer-run nonprofit's timing vendor — **do not re-fetch what is already
 * here.** It hangs off this entry point rather than off `bin/fetch.ts` because
 * it is what normalize reads: fill raw first, then decode.
 *
 * The decode half is issue #23 (the flat individual spine) and issue #25 (the
 * rest of the catalog). When it lands, these hold:
 *
 *   1. Reads `raw_fetch` only. No network. Latest row per (event_id, list_id):
 *      `distinct on (event_id, list_id) order by fetched_at desc`.
 *   2. Decoding is positional, per event, per list, via
 *      `DataFields.indexOf(field.Expression)` taken from `list.Fields[]`.
 *      Never zip Fields to DataFields — different lengths. Never cache a column
 *      index across events; the layout drifts five ways within one season.
 *   3. Idempotent: upsert on the natural key, so running twice is a no-op.
 *   4. Fidelity, not calculation. NICA is the scoring authority — places,
 *      points, ranks and season totals land unaltered. Nothing is computed,
 *      corrected or merged on the way in.
 */

import { createDb } from '../src/lib/db/index.ts';
import { loadCorpus } from '../src/lib/ingest/corpus.ts';

if (!process.argv.includes('--load-fixtures')) {
  console.error(
    'usage: node bin/normalize.ts --load-fixtures\n' +
      '  Run `pnpm db:migrate` first — this writes into an existing raw_fetch.\n' +
      '  Decoding is not implemented yet — see issues #23 and #25.',
  );
  process.exit(2);
}

const url = process.env.DATABASE_URL ?? './.pglite';
const db = createDb(url);

const result = await loadCorpus(db);
console.log(
  `archived ${result.rows} payloads into raw_fetch in ${url}: ` +
    `${result.configs} configs and ${result.lists} lists across ${result.events} events`,
);
process.exit(0);
