/**
 * The race-detail page against the published corpus.
 *
 * **Local lane.** This reads `fixtures/` — minors' full names, schools, grades,
 * plates and finish times — so it runs on a developer's machine with a human
 * present and never in CI (docs/fixtures.md, issue #29). It also reads the club
 * config, whose display names live outside the tree; with that file absent every
 * rider takes their `«RIDER-A»` pseudonym, which is what runs here.
 *
 * Every assertion below is a count, a null check, or a string the page itself
 * composes. Nothing asserts on, or can print, a rider's name.
 *
 * `query.test.ts` pins the same guards on synthetic rows and runs in CI. This
 * suite exists for what synthetic rows cannot prove: that the guards fire on
 * the published results they were written for, in the numbers those results
 * actually produce. The counts are written down so a change that quietly moves
 * a rider from one guard to another has to say so.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { loadClubConfig } from '../../../lib/club-config.ts';
import { createTestDb, type TestDatabase } from '../../../lib/db/testing.ts';
import { loadCorpus } from '../../../lib/ingest/corpus.ts';
import { normalize } from '../../../lib/ingest/normalize.ts';
import { seedClubConfig } from '../../../lib/seed.ts';
import { listRaces, loadRaceDetail, type RaceDetail } from './query.ts';
import type { PlacedRider } from '../../../components/race-detail.ts';

/** 2025 Race 4 North — where a naive percent-back inverts the HS1 Boys field. */
const RACE_4_NORTH = '363499';
/** 2025 Race 1 — the prologue time trial, which has no percent-back axis at all. */
const PROLOGUE = '357242';
/** The 2026 opener. A 2025 config maps no plates into it, and must not try. */
const OPENER_2026 = '418436';

let db: TestDatabase;
let raceFour: RaceDetail;
let prologue: RaceDetail;

beforeAll(async () => {
  db = await createTestDb();
  await loadCorpus(db);
  await normalize(db);
  await seedClubConfig(db, loadClubConfig());

  raceFour = (await loadRaceDetail(db, RACE_4_NORTH, null))!;
  prologue = (await loadRaceDetail(db, PROLOGUE, null))!;
}, 180_000);

const cards = (detail: RaceDetail): PlacedRider[] => detail.squads.flatMap((squad) => squad.riders);

const tally = <T extends string>(values: readonly T[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const value of values) out[value] = (out[value] ?? 0) + 1;
  return out;
};

const fieldCell = (rider: PlacedRider) =>
  rider.card.stats.find((stat) => stat.label === 'Field')!.value;

describe('the page opens a real archived race', () => {
  it('offers every archived event', async () => {
    expect(await listRaces(db)).toHaveLength(9);
  });

  it('reads the club and its squads out of the checked-in config', () => {
    const config = loadClubConfig();
    expect(raceFour.club?.name).toBe(config.club);
    expect(raceFour.squads.map((squad) => squad.name).sort()).toEqual(
      config.squads.map((squad) => squad.name).sort(),
    );
  });

  it('cards the club riders who started, and only them', () => {
    expect(cards(raceFour)).toHaveLength(21);
    expect(raceFour.starters).toBe(267);
  });

  it('cards nobody in a season the config does not map', async () => {
    // `rider_plate` is season-scoped by decision (issue #1): the same plate is a
    // different person a season later. A 2025 roster must produce no cards at a
    // 2026 event rather than guessing.
    const opener = (await loadRaceDetail(db, OPENER_2026, null))!;
    expect(opener.starters).toBe(604);
    expect(cards(opener)).toHaveLength(0);
  });
});

describe('guard 1 — the lapped riders at Race 4 North', () => {
  it('renders eight of them as a lap deficit, and none as a percentage', () => {
    const lapped = cards(raceFour).filter((rider) => rider.card.headline.kind === 'laps-down');
    expect(lapped).toHaveLength(8);

    for (const rider of lapped) {
      expect(rider.card.headline.value).toMatch(/^−\d+ laps?$/);
      expect(rider.card.mark.pct).toBeNull();
      expect(rider.card.outside?.kind).toBe('lapped');
    }
  });

  it('leaves no rider anywhere in the drawn fields with a negative percentage', () => {
    // The inversion this guards against: at this event five 2-lap HS1 Boys have
    // a FASTER clock time than the 3-lap winner. Placed on the axis they would
    // sit left of zero — ahead of a rider they were a lap behind.
    const placed = cards(raceFour)
      .flatMap((rider) => rider.field)
      .filter((mark) => mark.pct !== null);
    expect(placed.length).toBeGreaterThan(0);
    expect(placed.filter((mark) => (mark.pct as number) < 0)).toEqual([]);
  });
});

describe('guards 2 and 3 — the percentile', () => {
  it('splits the field cell three ways, and each way for its own reason', () => {
    const kinds = cards(raceFour).map((rider) => {
      const cell = fieldCell(rider);
      if (/^\d+ started, too few to rank$/.test(cell)) return 'too-few';
      if (/^top \d+%$/.test(cell)) return 'percentile';
      if (cell === '—') return 'dnf';
      return 'place';
    });
    // Three riders sat in a category under ten — HS2 Girls fielded 7 here.
    expect(tally(kinds)).toEqual({ 'too-few': 3, percentile: 5, place: 10, dnf: 3 });
  });

  it('never prints a percentile below the median or for a field under ten', () => {
    for (const rider of cards(raceFour)) {
      const cell = fieldCell(rider);
      const percentile = /^top (\d+)%$/.exec(cell);
      if (percentile !== null) {
        expect(Number(percentile[1])).toBeLessThanOrEqual(50);
        continue;
      }
      const refused = /^(\d+) started, too few to rank$/.exec(cell);
      if (refused !== null) expect(Number(refused[1])).toBeLessThan(10);
    }
  });
});

describe('guard 4 — a DNF as the source marks it', () => {
  it('imputes no time and no place for the three of them, and keeps the points', () => {
    const dnfs = cards(raceFour).filter((rider) => rider.card.headline.kind === 'dnf');
    expect(dnfs).toHaveLength(3);

    for (const rider of dnfs) {
      const cells = Object.fromEntries(rider.card.stats.map((stat) => [stat.label, stat.value]));
      expect(cells.Place).toBe('—');
      expect(cells.Time).toBe('—');
      expect(cells.Field).toBe('—');
      // Points are published for a DNF and are not ours to blank.
      expect(cells.Points).toMatch(/^\d+$/);
      expect(rider.card.mark.pct).toBeNull();
    }
  });
});

describe('guard 5 — the unmapped-rider warning', () => {
  it('finds nothing to warn about, because every club plate here is mapped', () => {
    // The count that matters is zero *today*: the checked-in config covers every
    // Descenders plate at this event. Drop a mapping and this test says so,
    // which is the regression the warning exists to catch.
    expect(raceFour.unmapped).toEqual([]);
  });

  it('keeps the warning and the cards disjoint', () => {
    const carded = new Set(cards(raceFour).map((rider) => rider.card.plate));
    for (const rider of raceFour.unmapped) expect(carded.has(rider.plate)).toBe(false);
  });
});

describe('lap splits, as the lists actually publish them', () => {
  it('draws bars where there are several and a value where there is one', () => {
    // Fourteen riders have two or more splits; six have exactly one, which
    // renders as the time rather than as a lone full-width bar. One rider's
    // list published no splits at all.
    expect(tally(cards(raceFour).map((rider) => rider.card.laps.kind))).toEqual({
      bars: 14,
      value: 6,
      none: 1,
    });
  });
});

describe('the prologue has no percent-back axis at all', () => {
  it('renders a place for all twenty-five riders and a percentage for none', () => {
    // Issue #48: a time trial publishes no lap columns, so `v_race_result`
    // publishes no percent back. Before that fix, 457 rows here carried one.
    const riders = cards(prologue);
    expect(riders).toHaveLength(25);
    expect(tally(riders.map((rider) => rider.card.headline.kind))).toEqual({ place: 25 });

    for (const rider of riders) {
      expect(rider.card.mark.pct).toBeNull();
      expect(rider.field.every((mark) => mark.pct === null)).toBe(true);
    }
  });

  it('still ranks the field, because a percentile needs places and not laps', () => {
    expect(
      tally(cards(prologue).map((rider) => (/^top /.test(fieldCell(rider)) ? 'top' : 'place'))),
    ).toEqual({ top: 20, place: 5 });
  });

  it('draws no lap chart, because the list published no splits', () => {
    expect(tally(cards(prologue).map((rider) => rider.card.laps.kind))).toEqual({ none: 25 });
  });
});
