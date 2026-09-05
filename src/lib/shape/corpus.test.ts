/**
 * The committed shape corpus: what it covers, and that it carries nobody.
 *
 * Default lane. It reads `shape-corpus/`, which is committed, and never
 * `fixtures/`, which is not — so it passes on a fresh clone and in CI on a
 * public repository. That property is asserted in `no-real-corpus.test.ts`
 * rather than assumed here.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { countRows, dataDepth } from '../ingest/rows.ts';
import {
  hydrate,
  readShapeCorpus,
  SHAPE_SEASONS,
  shapeCorpusRoot,
  type ShapeListFile,
} from './corpus.ts';
import { familyOf } from './place.ts';

const events = readShapeCorpus();
const lists = events.flatMap((event) => event.lists);

/** Every JSON file in the committed corpus, parsed. */
function everyFile(): { path: string; parsed: unknown }[] {
  return SHAPE_SEASONS.flatMap((season) => {
    const dir = join(shapeCorpusRoot(), season);
    return readdirSync(dir).map((name) => ({
      path: `${season}/${name}`,
      parsed: JSON.parse(readFileSync(join(dir, name), 'utf8')) as unknown,
    }));
  });
}

/** Every array anywhere in a document, with the path it sits at. */
function* arraysIn(value: unknown, path = ''): Generator<{ path: string; array: unknown[] }> {
  if (Array.isArray(value)) {
    yield { path, array: value };
    for (const [index, item] of value.entries()) yield* arraysIn(item, `${path}[${index}]`);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    yield* arraysIn(item, `${path}.${key}`);
  }
}

const listById = (eventId: string, listId: string): ShapeListFile => {
  const found = lists.find(
    (file) => file.shape.eventId === eventId && file.shape.listId === listId,
  );
  if (found === undefined) throw new Error(`no shape list ${eventId}/${listId} in the corpus`);
  return found;
};

describe('what the shape corpus covers', () => {
  it('carries every 2025 event and the 2026 opener', () => {
    expect(events.map((event) => `${event.season}/${event.eventId}`)).toEqual([
      '2025/357242',
      '2025/359477',
      '2025/359478',
      '2025/362112',
      '2025/362122',
      '2025/363499',
      '2025/363500',
      '2025/366186',
      '2026/418436',
    ]);
  });

  it('carries every published list of every event', () => {
    // 50 lists across the eight 2025 events, plus the opener's one.
    expect(lists).toHaveLength(51);
    expect(events.at(-1)!.lists).toHaveLength(1);
  });

  it('places every list into exactly one family', () => {
    // assignFamily throws on zero matches and on two, so getting an answer for
    // all 51 is the assertion.
    for (const file of lists) expect(familyOf(file).family.name).toBeTruthy();
  });
});

describe('the layout outliers', () => {
  it('keeps the time-trial-shaped Race 1', () => {
    // Race 1 is the prologue, so its flat individual list is the TT re-render
    // rather than the mass-start layout every other event publishes.
    expect(familyOf(listById('357242', '4F491D'))).toMatchObject({
      family: { name: 'individual_flat' },
      variant: { name: 'time-trial-2025' },
    });
  });

  it('keeps the State Champs list that drops DisplayPoints', () => {
    const stateChamps = listById('366186', '4C8C1F');
    expect(stateChamps.DataFields).not.toContain('DisplayPoints');
    expect(stateChamps.DataFields).toHaveLength(12);

    // The same family at the next event over still carries it, which is what
    // makes the omission a layout outlier rather than a season-wide change.
    expect(listById('363499', '51B416').DataFields).toContain('DisplayPoints');
  });

  it('keeps the season-overall widths that run 12/31/31/31/31/18/16/19', () => {
    const widths = events
      .filter((event) => event.season === 2025)
      .map((event) => {
        const overall = event.lists.find(
          (file) => familyOf(file).family.name === 'season_individual',
        );
        return overall!.DataFields.length;
      });

    expect(widths).toEqual([12, 31, 31, 31, 31, 18, 16, 19]);
  });
});

describe('the shape corpus carries no row values', () => {
  it('leaves `data` empty in every list file', () => {
    for (const file of lists) expect(file.data).toEqual({});
  });

  it('holds nothing but counts where the rows were', () => {
    const leaves = (node: unknown): unknown[] =>
      typeof node === 'object' && node !== null
        ? Object.values(node as Record<string, unknown>).flatMap(leaves)
        : [node];

    for (const file of lists) {
      for (const leaf of leaves(file.shape.groups)) {
        expect(Number.isInteger(leaf)).toBe(true);
        expect(leaf as number).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('publishes no positional row anywhere in any file', () => {
    // An array of arrays is how RaceResult publishes people. There is not one
    // in the corpus — not in `data`, not in the group tree, not in a catalog.
    for (const { path, parsed } of everyFile()) {
      for (const { path: at, array } of arraysIn(parsed)) {
        const rows = array.filter(Array.isArray);
        expect(`${path}${at}: ${rows.length} nested array(s)`).toBe(
          `${path}${at}: 0 nested array(s)`,
        );
      }
    }
  });

  it('replaced every group label with a synthetic one', () => {
    // The real labels are race categories, divisions and packed team strings
    // ("1.///Portland Metro Composite///3834 Points"). None survived.
    const labels = (node: unknown): string[] =>
      typeof node === 'object' && node !== null
        ? Object.entries(node as Record<string, unknown>).flatMap(([label, child]) => [
            label,
            ...labels(child),
          ])
        : [];

    for (const file of lists) {
      for (const label of labels(file.shape.groups)) {
        expect(label).toMatch(/^#\d+_group-\d+-\d+$/);
      }
    }
  });

  it('redacted the config request token', () => {
    for (const event of events) expect(event.config.key).toBe('«KEY»');
  });
});

describe('hydrating a shape file', () => {
  it('rebuilds the nesting depth the source published', () => {
    // Depth is part of a family's identity — 1 for the flat lists, 3 for the
    // By-Team sidecar — so a corpus that flattened it would place lists wrongly.
    expect(dataDepth(hydrate(listById('359478', '4C8C1F')).data)).toBe(1);
    expect(dataDepth(hydrate(listById('359478', 'E07F7C')).data)).toBe(3);
    expect(dataDepth(hydrate(listById('359478', '674D5B')).data)).toBe(2);
  });

  it('rebuilds exactly the row count that was recorded', () => {
    const total = (node: unknown): number =>
      typeof node === 'number'
        ? node
        : Object.values(node as Record<string, unknown>).reduce<number>(
            (sum, child) => sum + total(child),
            0,
          );

    for (const file of lists) {
      expect(countRows(hydrate(file).data)).toBe(total(file.shape.groups));
    }
  });

  it('fabricates every cell, at the declared column width', () => {
    const payload = hydrate(listById('359478', '4C8C1F'));
    const width = (payload.DataFields as string[]).length;
    const first = (Object.values(payload.data as Record<string, unknown[][]>)[0] ?? [])[0]!;

    expect(first).toHaveLength(width);
    expect(new Set(first)).toEqual(new Set(['«CELL»']));
  });
});
