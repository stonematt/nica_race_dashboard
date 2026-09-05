/**
 * Every fatal assertion ingest makes, exercised against the shape corpus.
 *
 * Drift detection is the part of ingest with no human in the loop, which is
 * what makes it the part most worth a regression suite — and every one of its
 * refusals reads `DataFields`, `Fields`, the `data` nesting or `ListFooterText`,
 * never a cell. So the whole of it can be checked in CI with no minor's name
 * anywhere on the machine.
 *
 * The mutations are minimal and start from a real layout: one column added, one
 * removed, one count off by one. A hand-built payload would prove the assertion
 * fires; starting from the corpus proves it fires on the thing it will actually
 * be shown.
 *
 * Default lane.
 */

import { describe, expect, it } from 'vitest';
import { readCatalog, SourceCatalogError } from '../ingest/catalog.ts';
import { ColumnError } from '../ingest/columns.ts';
import {
  assignFamily,
  FamilyError,
  INDIVIDUAL_FLAT,
  repeatOrdinals,
  SEASON_INDIVIDUAL,
} from '../ingest/families.ts';
import {
  checkExpressionsRecognized,
  checkRowCount,
  countRows,
  DecodeError,
  publishedRowCount,
  resolveFamilyFields,
} from '../ingest/rows.ts';
import { hydrate, readShapeCorpus, whereOf, type ShapeListFile } from './corpus.ts';
import { layoutFrom, layoutOf } from './place.ts';

const events = readShapeCorpus();
const lists = events.flatMap((event) => event.lists);

const listById = (eventId: string, listId: string): ShapeListFile => {
  const found = lists.find(
    (file) => file.shape.eventId === eventId && file.shape.listId === listId,
  );
  if (found === undefined) throw new Error(`no shape list ${eventId}/${listId} in the corpus`);
  return found;
};

/** The nesting depth a shape file records, measured the way ingest measures it. */
function depthOf(file: ShapeListFile): number {
  let depth = 0;
  let node: unknown = file.shape.groups;
  while (typeof node === 'object' && node !== null) {
    depth += 1;
    node = Object.values(node as Record<string, unknown>)[0];
  }
  return depth;
}

/** Race 2 South's flat individual list: the ordinary 2025 mass-start layout. */
const SPINE = listById('359478', '4C8C1F');
const WHERE = whereOf(SPINE);

describe('a list is identified by its columns, never by its name', () => {
  it('refuses a list that matches no declared family', () => {
    // One signature column gone. An unrecognized list is fatal because quietly
    // skipping it is how a season goes missing.
    const columns = SPINE.DataFields.filter((expression) => expression !== 'DisplayLapTime(1)');

    expect(() => assignFamily(WHERE, layoutFrom(WHERE, columns), 1)).toThrow(FamilyError);
    expect(() => assignFamily(WHERE, layoutFrom(WHERE, columns), 1)).toThrow(
      /matches no declared family/,
    );
  });

  it('refuses a list that matches two declared layouts', () => {
    // The mass-start layout plus the time trial's three columns satisfies both
    // variants at once. Choosing one would be a guess.
    const columns = [...SPINE.DataFields, 'RankOrStatusTT', 'Start.TOD', 'End.TOD'];

    expect(() => assignFamily(WHERE, layoutFrom(WHERE, columns), 1)).toThrow(FamilyError);
    expect(() => assignFamily(WHERE, layoutFrom(WHERE, columns), 1)).toThrow(
      /matches 2 declared layouts/,
    );
  });

  it('accepts the corpus as published', () => {
    expect(assignFamily(WHERE, layoutOf(SPINE), 1).variant.name).toBe('mass-start-2025');
  });
});

describe('two aliases for one canonical field', () => {
  it('is fatal', () => {
    // The 2025 spine transports the raw time as `TimeOrStatus`. `TIME` is the
    // other spelling the same field has been published under; both at once
    // means the alias table has stopped describing the source.
    const layout = layoutFrom(WHERE, [...SPINE.DataFields, 'TIME']);

    expect(() => resolveFamilyFields(WHERE, layout, INDIVIDUAL_FLAT)).toThrow(ColumnError);
    expect(() => resolveFamilyFields(WHERE, layout, INDIVIDUAL_FLAT)).toThrow(
      /2 aliases for timeRaw/,
    );
  });

  it('is not confused with a layout that carries one of them', () => {
    expect(resolveFamilyFields(WHERE, layoutOf(SPINE), INDIVIDUAL_FLAT).timeRaw).toBe(
      SPINE.DataFields.indexOf('TimeOrStatus'),
    );
  });
});

describe('strict unknown-expression fatality', () => {
  it('halts on an expression nobody has classified', () => {
    const layout = layoutFrom(WHERE, [...SPINE.DataFields, 'SomethingNobodyHasSeen']);

    expect(() => checkExpressionsRecognized(WHERE, layout, INDIVIDUAL_FLAT)).toThrow(DecodeError);
    expect(() => checkExpressionsRecognized(WHERE, layout, INDIVIDUAL_FLAT)).toThrow(
      /1 expression\(s\) unrecognized/,
    );
  });

  it('does not halt on an expression that is recognized and deliberately unmapped', () => {
    // `Start.TOD` is on the flat list's ignored list: a time-trial column that
    // is empty in every row of the corpus and has no column to live in.
    const layout = layoutFrom(WHERE, [...SPINE.DataFields, 'Start.TOD']);

    expect(() => checkExpressionsRecognized(WHERE, layout, INDIVIDUAL_FLAT)).not.toThrow();
  });

  it('accounts for every column of every list in the corpus', () => {
    for (const file of lists) {
      const layout = layoutOf(file);
      const { family } = assignFamily(whereOf(file), layout, depthOf(file));
      expect(() => checkExpressionsRecognized(whereOf(file), layout, family)).not.toThrow();
    }
  });
});

describe('required fields', () => {
  it('refuses a layout where a required field resolves to no column', () => {
    // `CLUB` is the NICA-reported scoring team. Without it a row cannot be
    // attributed to a team at all, so it is required rather than nullable.
    const columns = SPINE.DataFields.filter((expression) => expression !== 'CLUB');
    const layout = layoutFrom(WHERE, columns);

    expect(() => resolveFamilyFields(WHERE, layout, INDIVIDUAL_FLAT)).toThrow(DecodeError);
    expect(() => resolveFamilyFields(WHERE, layout, INDIVIDUAL_FLAT)).toThrow(
      /required field\(s\) scoringTeam/,
    );
  });

  it('resolves every required field of every list in the corpus', () => {
    for (const file of lists) {
      const layout = layoutOf(file);
      const { family } = assignFamily(whereOf(file), layout, depthOf(file));
      expect(() => resolveFamilyFields(whereOf(file), layout, family)).not.toThrow();
    }
  });
});

describe('the published row count in ListFooterText', () => {
  const withFooter = lists.filter((file) => publishedRowCount(file.list.ListFooterText) !== null);
  const withoutFooter = lists.filter(
    (file) => publishedRowCount(file.list.ListFooterText) === null,
  );

  it('is published across 2025 and empty at the 2026 opener', () => {
    // Both halves have to be represented or the "skipped where absent" rule is
    // untested against anything real.
    expect(withFooter.length).toBeGreaterThan(0);
    expect(withoutFooter.length).toBeGreaterThan(0);
    expect(publishedRowCount(listById('418436', 'F1A053').list.ListFooterText)).toBeNull();
  });

  it('agrees with the rows every list actually carries', () => {
    for (const file of withFooter) {
      const rows = countRows(hydrate(file).data);
      expect(checkRowCount(whereOf(file), file.list.ListFooterText, rows)).toBe(rows);
    }
  });

  it('is fatal when the decoded count disagrees', () => {
    const file = withFooter[0]!;
    const rows = countRows(hydrate(file).data);

    expect(() => checkRowCount(whereOf(file), file.list.ListFooterText, rows + 1)).toThrow(
      DecodeError,
    );
    expect(() => checkRowCount(whereOf(file), file.list.ListFooterText, rows - 1)).toThrow(
      /rows were lost or duplicated/,
    );
  });

  it('is skipped where the source published no footer', () => {
    for (const file of withoutFooter) {
      const rows = countRows(hydrate(file).data);
      expect(checkRowCount(whereOf(file), file.list.ListFooterText, rows + 7)).toBeNull();
    }
  });
});

describe('repeat groups', () => {
  const racePoints = SEASON_INDIVIDUAL.repeats![0]!;

  it('reads the block width off the payload rather than requiring a fixed set', () => {
    // The mid-season snapshot publishes RACE1..RACE10 for a season Oregon never
    // ran; Race 4's final copy publishes RACE1..RACE4. An unseen ordinal has to
    // widen the block, not halt the event.
    expect(repeatOrdinals(layoutOf(listById('359478', '2A48B4')), racePoints)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(repeatOrdinals(layoutOf(listById('363499', '2A48B4')), racePoints)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(repeatOrdinals(layoutOf(listById('357242', '2A48B4')), racePoints)).toEqual([1]);
  });

  it('reports an empty block where the family publishes none', () => {
    expect(repeatOrdinals(layoutOf(SPINE), racePoints)).toEqual([]);
  });
});

describe('the config shape trap', () => {
  const config2026 = events.at(-1)!.config;
  const config2025 = events[0]!.config;

  it('finds nothing under the 2025 catalog key in a 2026 config', () => {
    // This is the trap itself: a reader that does `payload.lists ?? []` gets an
    // empty catalog, archives nothing, and loses a whole event in silence.
    expect((config2026 as { lists?: unknown }).lists).toBeUndefined();
    expect(config2026.Tab!.Config.Lists).toHaveLength(3);
  });

  it('raises rather than yielding an empty catalog', () => {
    const readWith2025Assumptions = { ...config2026, Tab: undefined, lists: [] };

    expect(() => readCatalog('418436', readWith2025Assumptions)).toThrow(SourceCatalogError);
    expect(() => readCatalog('418436', readWith2025Assumptions)).toThrow(/catalog is empty/);
  });

  it('raises when neither catalog key is there at all', () => {
    expect(() => readCatalog('418436', { key: 'k', eventname: 'e' })).toThrow(
      /neither a top-level `lists` array/,
    );
  });

  it('reads the 2026 catalog from where 2026 publishes it', () => {
    const catalog = readCatalog('418436', config2026);

    expect(catalog.shape).toBe('2026');
    expect(catalog.lists.map((list) => list.id)).toEqual(['F1A053', 'C6D0BA', 'D4B9DB']);
    expect(catalog.lists[0]!.name).toBe('Online|Individual Results');
  });

  it('still reads the 2025 catalog from the top-level key', () => {
    const catalog = readCatalog('357242', config2025);

    expect(catalog.shape).toBe('2025');
    expect(catalog.lists.length).toBeGreaterThan(0);
  });

  it('keeps one list where a config publishes the same hex ID twice', () => {
    // Event 357242 advertises 2A48B4 once visible and once hidden. The corpus
    // keeps both entries so the reader's rule stays exercised.
    const raw = config2025.lists!.filter((entry) => entry.ID === '2A48B4');
    expect(raw.length).toBeGreaterThan(1);

    const catalog = readCatalog('357242', config2025);
    expect(catalog.lists.filter((list) => list.id === '2A48B4')).toHaveLength(1);
  });

  it('reads every config in the corpus', () => {
    for (const event of events) {
      expect(readCatalog(event.eventId, event.config).lists.length).toBeGreaterThan(0);
    }
  });
});
