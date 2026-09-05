/**
 * Politeness, proved without exercising it.
 *
 * **Default lane.** Nothing here reads a payload; every response is a stub. The
 * clock and the sleep are injected, so the 3-second spacing is asserted as a
 * number rather than waited for, and the suite installs a `globalThis.fetch`
 * that throws — a live request would fail the test rather than reach a
 * volunteer-run nonprofit's timing vendor.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createPoliteClient,
  REQUEST_SPACING_MS,
  SourceUnavailableError,
  USER_AGENT,
  type SourceRequest,
  type SourceResponse,
  type Transport,
} from './transport.ts';

const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = (() => {
    throw new Error('the test suite made a live network request');
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A fake clock the injected sleep advances, so spacing is arithmetic. */
function fakeClock() {
  let millis = 0;
  const slept: number[] = [];
  return {
    now: () => millis,
    sleep: async (ms: number) => {
      slept.push(ms);
      millis += ms;
    },
    advance: (ms: number) => {
      millis += ms;
    },
    slept,
  };
}

interface StubTransport {
  transport: Transport;
  requests: SourceRequest[];
  /** How many requests were in flight at the busiest moment. */
  peakConcurrency: number;
}

/**
 * A transport that answers from a script and records what it was asked.
 *
 * It advances the clock while "in flight" so that a spacing measured from the
 * end of the previous request is distinguishable from one measured from its
 * start.
 */
function stubTransport(
  clock: ReturnType<typeof fakeClock>,
  script: (request: SourceRequest) => Partial<SourceResponse>,
  durationMs = 10,
): StubTransport {
  const requests: SourceRequest[] = [];
  let inFlight = 0;
  const stub: StubTransport = {
    requests,
    peakConcurrency: 0,
    transport: async (request) => {
      requests.push(request);
      inFlight += 1;
      stub.peakConcurrency = Math.max(stub.peakConcurrency, inFlight);
      // Yield to the event loop: a client that did not serialize would let a
      // second request in right here.
      await Promise.resolve();
      clock.advance(durationMs);
      inFlight -= 1;
      return { url: request.url, status: 200, body: {}, ...script(request) };
    },
  };
  return stub;
}

describe('createPoliteClient', () => {
  it('identifies itself with a real User-Agent on every request', async () => {
    const clock = fakeClock();
    const stub = stubTransport(clock, () => ({}));
    const client = createPoliteClient(stub.transport, { ...clock });

    await client.get('https://my.raceresult.com/1/results/config');
    await client.get('https://my.raceresult.com/1/results/list');

    expect(stub.requests.map((request) => request.headers['User-Agent'])).toEqual([
      USER_AGENT,
      USER_AGENT,
    ]);
    // A UA that says who this is and where to complain, not a browser lie.
    expect(USER_AGENT).toContain('nica_race_dashboard');
    expect(USER_AGENT).toContain('https://github.com/stonematt/nica_race_dashboard');
  });

  it('runs requests one at a time, even when the caller does not wait', async () => {
    const clock = fakeClock();
    const stub = stubTransport(clock, () => ({}));
    const client = createPoliteClient(stub.transport, { ...clock });

    await Promise.all([
      client.get('https://x/1'),
      client.get('https://x/2'),
      client.get('https://x/3'),
    ]);

    expect(stub.peakConcurrency).toBe(1);
    expect(stub.requests.map((request) => request.url)).toEqual([
      'https://x/1',
      'https://x/2',
      'https://x/3',
    ]);
  });

  it('leaves the source alone for the spacing interval between requests', async () => {
    const clock = fakeClock();
    const stub = stubTransport(clock, () => ({}));
    const client = createPoliteClient(stub.transport, { ...clock });

    await client.get('https://x/1');
    await client.get('https://x/2');

    // Nothing is owed before the first request; the second waits the full
    // interval measured from the moment the first one finished.
    expect(clock.slept).toEqual([REQUEST_SPACING_MS]);
    expect(REQUEST_SPACING_MS).toBe(3000);
  });

  it("counts the caller's own work against the interval rather than adding to it", async () => {
    const clock = fakeClock();
    const stub = stubTransport(clock, () => ({}));
    const client = createPoliteClient(stub.transport, { ...clock });

    await client.get('https://x/1');
    clock.advance(500); // archiving the payload took half a second
    await client.get('https://x/2');

    expect(clock.slept).toEqual([REQUEST_SPACING_MS - 500]);
  });

  it('honours a spacing wider than the default', async () => {
    const clock = fakeClock();
    const stub = stubTransport(clock, () => ({}));
    const client = createPoliteClient(stub.transport, { ...clock, spacingMs: 9000 });

    await client.get('https://x/1');
    await client.get('https://x/2');

    expect(clock.slept).toEqual([9000]);
  });

  it('backs off the moment the source answers with anything but 200', async () => {
    const clock = fakeClock();
    const stub = stubTransport(clock, (request) =>
      request.url.endsWith('/2') ? { status: 429, body: undefined } : {},
    );
    const client = createPoliteClient(stub.transport, { ...clock });

    await client.get('https://x/1');
    await expect(client.get('https://x/2')).rejects.toBeInstanceOf(SourceUnavailableError);
    await expect(client.get('https://x/2')).rejects.toThrow(/429/);

    // Two requests: the good one and the refused one. The retry never left the
    // process — a source that said no is not asked again in the same run.
    expect(stub.requests).toHaveLength(2);
  });

  it('stops the whole run rather than moving on to the next url', async () => {
    const clock = fakeClock();
    const stub = stubTransport(clock, () => ({ status: 503, body: undefined }));
    const client = createPoliteClient(stub.transport, { ...clock });

    await expect(client.get('https://x/1')).rejects.toThrow(/503/);
    await expect(client.get('https://x/2')).rejects.toThrow(/already refused/);

    expect(stub.requests).toHaveLength(1);
  });
});
