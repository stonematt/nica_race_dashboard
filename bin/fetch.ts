/**
 * Fetch live RaceResult payloads into the append-only raw archive.
 *
 * Runs under Node's native type stripping — `node bin/fetch.ts`, no build step.
 *
 *   FETCH_EVENT_IDS=418437 FETCH_SEASON=2026 pnpm fetch
 *
 * **This is the only thing in the repository that touches the network on
 * purpose**, and the source is a volunteer-run nonprofit's timing vendor. Read
 * `docs/fixtures.md` before running it. The whole 2025 season and the 2026
 * opener are already on disk at `fixtures/`; archive those offline with
 * `pnpm normalize --load-fixtures` and do not re-fetch them. Asking for an
 * event the corpus already holds is refused here rather than merely
 * discouraged.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NEVER SCHEDULE THIS. No GitHub Actions `schedule:`, no cron, while this
 * repository is public: these payloads carry minors' full names, schools,
 * grades, plates and finish times. Decided in #6, reaffirmed in #29, and
 * restated in `.github/workflows/ci.yml` — reopening it needs a fresh decision,
 * not a pull request. Ingest is hand-run, by a human, on a laptop.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Everything below the environment read is in `src/lib/ingest/`:
 * `transport.ts` holds the manners (serial, 3s apart, stop on any non-200) and
 * `fetch.ts` holds the run (archive unconditionally, one assertion: an empty
 * catalog is a hard error). This file is wiring, so that the scheduling option
 * reopens by rewiring alone if the repository ever stops being public.
 *
 * Environment:
 *
 *   FETCH_EVENT_IDS       required. Comma-separated event ids. Fetch never crawls.
 *   FETCH_SEASON          required. Four-digit year, stamped onto every row.
 *   FETCH_CONFIG_SHAPE    2025 | 2026 (default 2026). Which config path to ask.
 *   FETCH_SPACING_MS      default 3000. A floor; it only widens.
 *   FETCH_USER_AGENT      default identifies this project and links to it.
 *   FETCH_ALLOW_REFETCH   1 to ask again for an event already in the corpus.
 *   DATABASE_URL          default ./.pglite, the same default normalize uses.
 */

import { createDb } from '../src/lib/db/index.ts';
import { hasCorpus } from '../src/lib/fixtures.ts';
import { discoverCorpus } from '../src/lib/ingest/corpus.ts';
import { fetchEvent, readFetchConfig, refuseCorpusRefetch } from '../src/lib/ingest/fetch.ts';
import { createHttpTransport, createPoliteClient } from '../src/lib/ingest/transport.ts';

const config = readFetchConfig(process.env);

// A fresh clone has no corpus, and then there is nothing to protect from a
// re-fetch. On a machine that has one, every event in it is off limits.
const corpusEventIds = hasCorpus() ? discoverCorpus().map((event) => event.eventId) : [];
const eventIds = refuseCorpusRefetch(config.eventIds, corpusEventIds, config.allowRefetch);

const db = createDb(config.databaseUrl);
const client = createPoliteClient(createHttpTransport(), {
  spacingMs: config.spacingMs,
  userAgent: config.userAgent,
});

console.log(
  `fetching ${eventIds.length} event(s) from the ${config.shape} config path, ` +
    `${config.spacingMs}ms apart, into ${config.databaseUrl}`,
);

for (const eventId of eventIds) {
  const result = await fetchEvent(db, client, {
    season: config.season,
    eventId,
    shape: config.shape,
  });
  console.log(
    `event ${result.eventId} "${result.eventName}": archived ${result.rows} payloads ` +
      `(1 config + ${result.lists} lists) via ${result.configPath} / ${result.catalogKey}`,
  );
}

console.log(`done — ${client.requestCount} request(s) made`);
process.exit(0);
