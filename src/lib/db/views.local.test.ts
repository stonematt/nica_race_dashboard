/**
 * The domain views, against the real corpus.
 *
 * **Local lane.** This reads `fixtures/` — minors' full names, schools, grades,
 * plates and finish times — so it runs on a developer's machine with a human
 * present and never in CI (docs/fixtures.md, issue #29). Every assertion here
 * is a count or a null check; nothing asserts on, or can print, a rider.
 *
 * `views-lap-count.test.ts` pins the lap-count rule on synthetic rows and runs
 * in CI. This suite exists for the half of #48 that synthetic rows cannot
 * reach: the fix is regression-sensitive across eight other published events,
 * and only the published events can show that they came through unchanged.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { loadCorpus } from '../ingest/corpus.ts';
import { normalize } from '../ingest/normalize.ts';
import { createTestDb, type TestDatabase } from './testing.ts';

let db: TestDatabase;

/** The 2025 prologue: a time trial, and the only list publishing no lap columns. */
const PROLOGUE = '357242';

/**
 * Rows carrying a non-null `pct_back`, per event, recorded at `60d3a0e` — the
 * commit before the fix.
 *
 * The prologue's entry is the defect: 457 finishers on a percent-back axis, the
 * slowest of them 172.1% back from a winner they never raced against. It must
 * go to zero. Every other number must not move, which is the whole reason they
 * are written down.
 */
const PCT_BACK_ROWS_AT_60D3A0E: Record<string, number> = {
  '357242': 457, // the prologue — the only expected change, to 0
  '359477': 131,
  '359478': 130,
  '362112': 184,
  '362122': 166,
  '363499': 216,
  '363500': 216,
  '366186': 377, // State Champs
  '418436': 594, // the 2026 opener
};

/** Riders the view calls lapped, per event, at `60d3a0e`. Also unchanged. */
const LAPPED_ROWS_AT_60D3A0E: Record<string, number> = {
  '357242': 0,
  '359477': 122,
  '359478': 81,
  '362112': 76,
  '362122': 71,
  '363499': 47,
  '363500': 41,
  '366186': 40,
  '418436': 0,
};

type EventCounts = {
  source_event_id: string;
  rows: number;
  with_pct: number;
  with_laps: number;
  lapped: number;
};

let counts: EventCounts[];

beforeAll(async () => {
  db = await createTestDb();
  await loadCorpus(db);
  await normalize(db);

  counts = (
    await db.execute(`
      select source_event_id,
             count(*)::int                          as rows,
             count(pct_back)::int                   as with_pct,
             count(laps)::int                       as with_laps,
             count(*) filter (where is_lapped)::int as lapped
        from v_race_result
       group by source_event_id
       order by source_event_id`)
  ).rows as unknown as EventCounts[];
}, 180_000);

const forEvent = (sourceEventId: string) =>
  counts.find((c) => c.source_event_id === sourceEventId)!;

describe('v_race_result against the published corpus', () => {
  it('covers all nine archived events', () => {
    expect(counts.map((c) => c.source_event_id)).toEqual(
      Object.keys(PCT_BACK_ROWS_AT_60D3A0E).sort(),
    );
  });

  it('publishes no percent-back at all for the prologue time trial', () => {
    // Before the fix: 457 of these, topping out at 172.1%.
    expect(forEvent(PROLOGUE).with_pct).toBe(0);
  });

  it('leaves every prologue lap count null rather than zero', () => {
    const prologue = forEvent(PROLOGUE);
    expect(prologue.with_laps).toBe(0);
    expect(prologue.rows).toBe(535);
  });

  it('leaves the other eight events percent-back counts exactly as they were', () => {
    // Regression-sensitive by construction: these eight publish a lap count, so
    // the fallback this fix changes never fires for them, and the numbers are
    // written down so that stops being an argument and starts being a test.
    for (const [sourceEventId, expected] of Object.entries(PCT_BACK_ROWS_AT_60D3A0E)) {
      if (sourceEventId === PROLOGUE) continue;
      expect({ sourceEventId, withPct: forEvent(sourceEventId).with_pct }).toEqual({
        sourceEventId,
        withPct: expected,
      });
    }
  });

  it('calls exactly the same riders lapped as before', () => {
    for (const [sourceEventId, expected] of Object.entries(LAPPED_ROWS_AT_60D3A0E)) {
      expect({ sourceEventId, lapped: forEvent(sourceEventId).lapped }).toEqual({
        sourceEventId,
        lapped: expected,
      });
    }
  });

  it('never puts a lapped rider on the percent-back axis', async () => {
    const offenders = (
      await db.execute(
        `select count(*)::int n from v_race_result where is_lapped and pct_back is not null`,
      )
    ).rows[0] as { n: number };
    expect(offenders.n).toBe(0);
  });

  it('never reports a percent-back where the lap count is unknown', async () => {
    const offenders = (
      await db.execute(
        `select count(*)::int n from v_race_result where laps is null and pct_back is not null`,
      )
    ).rows[0] as { n: number };
    expect(offenders.n).toBe(0);
  });
});
