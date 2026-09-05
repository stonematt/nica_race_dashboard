/**
 * The one place this project talks to the network, and the manners it talks with.
 *
 * The source is a volunteer-run nonprofit's timing vendor. Nobody there agreed
 * to serve this app, the whole 2025 season plus the 2026 opener was crawled
 * once and deliberately slowly, and the corpus on disk is what the rest of the
 * codebase reads. So the politeness here is not a nicety layered over a fetch
 * loop — it *is* the fetch loop, and there is no way to issue a request that
 * skips it.
 *
 * Three properties, and each one is a test in `transport.test.ts`:
 *
 *   - **Serial.** Requests queue on one promise chain. A caller that fires
 *     three `get`s without awaiting still gets three requests, one at a time,
 *     in order.
 *   - **Spaced.** At least `REQUEST_SPACING_MS` between the end of one request
 *     and the start of the next. Work the caller does in between — archiving a
 *     payload — counts against the interval rather than adding to it, so the
 *     spacing is a floor on the source's experience, not a tax on ours.
 *   - **Stops on any non-200.** No retry, no next URL, no backoff-and-try-again
 *     loop: the client latches closed and every later `get` throws without
 *     reaching the transport. A source that said no is not asked again in the
 *     same run. Recovery is a human re-running the command later, which is the
 *     right cadence for an ingest that is hand-run by design (issue #26).
 *
 * **The transport is injected.** `Transport` is a function; the real one is
 * built by `createHttpTransport` and is constructed in `bin/fetch.ts` alone.
 * Nothing under `src/` calls it, and the test suite passes a stub, so "no live
 * network call occurs in the test suite" is a property of the wiring rather
 * than a promise. The suites also install a throwing `globalThis.fetch` for the
 * duration, which turns a regression into a failing test.
 */

import { IngestError } from './errors.ts';

/** Seconds between requests, as a floor. Three, out of respect. */
export const REQUEST_SPACING_MS = 3000;

/**
 * Who is asking.
 *
 * A real identifier with a contact address, not a browser string. If this
 * traffic is ever unwelcome, whoever reads the access log can find out what it
 * is and where to say so — which is the only reason a User-Agent is worth
 * anything.
 */
export const USER_AGENT =
  'nica_race_dashboard/0.1 (hand-run ingest; +https://github.com/stonematt/nica_race_dashboard)';

/** One request, as the transport receives it. */
export interface SourceRequest {
  url: string;
  headers: Record<string, string>;
}

/** One response. `body` is parsed JSON, and is only meaningful on a 200. */
export interface SourceResponse {
  url: string;
  status: number;
  body: unknown;
}

/**
 * The seam. A function from request to response, and the only way out of this
 * process.
 */
export type Transport = (request: SourceRequest) => Promise<SourceResponse>;

/** The source answered with something other than 200, or not at all. */
export class SourceUnavailableError extends IngestError {}

export interface PoliteClientOptions {
  /** Floor between requests. Wider is allowed; narrower is not (see `bin/fetch.ts`). */
  spacingMs?: number;
  userAgent?: string;
  /** Injected for tests, so the spacing is asserted rather than waited for. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** A polite, serial, one-shot-per-run reader of the source. */
export interface PoliteClient {
  /** Fetch a URL. Resolves only on a 200; anything else ends the run. */
  get(url: string): Promise<SourceResponse>;
  /** How many requests actually left the process. */
  readonly requestCount: number;
}

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wrap a transport in the manners.
 *
 * The queue is a promise chain rather than a semaphore because order matters as
 * much as concurrency: config first, then its lists, in the order the config
 * published them.
 */
export function createPoliteClient(
  transport: Transport,
  options: PoliteClientOptions = {},
): PoliteClient {
  const spacingMs = options.spacingMs ?? REQUEST_SPACING_MS;
  const userAgent = options.userAgent ?? USER_AGENT;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? wait;

  let queue: Promise<unknown> = Promise.resolve();
  let lastFinishedAt: number | undefined;
  let refusal: string | undefined;
  let requestCount = 0;

  async function run(url: string): Promise<SourceResponse> {
    if (refusal !== undefined) {
      throw new SourceUnavailableError(
        `${url}: not requested. The source already refused this run — ${refusal}. ` +
          'Nothing retries inside one run; re-run the command later.',
      );
    }

    if (lastFinishedAt !== undefined) {
      const owed = spacingMs - (now() - lastFinishedAt);
      if (owed > 0) await sleep(owed);
    }

    let response: SourceResponse;
    try {
      requestCount += 1;
      response = await transport({
        url,
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
      });
    } catch (cause) {
      lastFinishedAt = now();
      refusal = `${url} did not answer (${(cause as Error).message})`;
      throw new SourceUnavailableError(`${url}: request failed — ${(cause as Error).message}`);
    }
    lastFinishedAt = now();

    if (response.status !== 200) {
      refusal = `${url} answered ${response.status}`;
      throw new SourceUnavailableError(
        `${url}: the source answered ${response.status}. Backing off — no retry, no further requests this run.`,
      );
    }
    return response;
  }

  return {
    get(url: string): Promise<SourceResponse> {
      // Chain onto the tail whether or not the tail rejected, so one failure
      // does not leave the queue permanently poisoned with an unhandled
      // rejection; `refusal` is what actually stops later requests.
      const result = queue.then(
        () => run(url),
        () => run(url),
      );
      queue = result.catch(() => undefined);
      return result;
    },
    get requestCount() {
      return requestCount;
    },
  };
}

/**
 * The real transport: `fetch`, JSON, no redirects followed silently.
 *
 * Constructed in `bin/fetch.ts` and nowhere else. A non-200 body is not parsed
 * — the caller stops on the status, and an error page is not JSON.
 */
export function createHttpTransport(): Transport {
  return async ({ url, headers }) => {
    const response = await fetch(url, { headers, redirect: 'follow' });
    if (response.status !== 200) {
      // Drain the body so the socket can be reused, and discard it.
      await response.text().catch(() => undefined);
      return { url, status: response.status, body: undefined };
    }
    return { url, status: response.status, body: await response.json() };
  };
}
