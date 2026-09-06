/*
 * The guards at the render boundary — the half `category-view.test.ts`
 * cannot reach. The ticket's central constraints are claims about markup:
 * her row is marked and carries the anchor id, squad-mates are tinted, the
 * three states render inline, and none of the three is told apart by colour
 * alone. All four are only really held by looking at the output.
 *
 * `renderToStaticMarkup`, matching `RosterWall.test.tsx`: a server component
 * with no state and no events has nothing to drive.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CategoryField, CategoryFieldRow } from '../lib/category.ts';
import { CategoryView } from './CategoryView.tsx';

function row(over: Partial<CategoryFieldRow>): CategoryFieldRow {
  return {
    plate: '10',
    displayName: '«RIDER»',
    scoringTeam: 'Some Team',
    place: '3',
    status: 'finished',
    isLapped: false,
    pctBack: 5.2,
    riderId: null,
    isSquadMate: false,
    ...over,
  };
}

function render(field: CategoryField, riderId: number): string {
  return renderToStaticMarkup(<CategoryView field={field} riderId={riderId} />);
}

const smallField: CategoryField = {
  categoryName: 'Varsity Girls - South',
  scope: 'conference',
  conference: 'South',
  fieldSize: 2,
  rows: [
    row({ plate: '1', place: '1', displayName: '«RIVAL»', riderId: 9 }),
    row({ plate: '2', place: '2', displayName: '«RIDER-A»', riderId: 1, isSquadMate: true }),
  ],
};

const largeField: CategoryField = {
  categoryName: 'HS1 Boys - North',
  scope: 'conference',
  conference: 'North',
  fieldSize: 80,
  rows: [
    ...Array.from({ length: 78 }, (_, i) =>
      row({ plate: String(i), place: String(i + 1), displayName: `rider-${i}`, riderId: null }),
    ),
    row({ plate: '998', place: '79', displayName: '«RIDER-B»', riderId: 2, isSquadMate: true }),
    row({ plate: '999', place: '80', displayName: '«RIDER-A»', riderId: 1, isSquadMate: true }),
  ],
};

const withDnfAndLapped: CategoryField = {
  categoryName: 'HS2 Girls',
  scope: 'league',
  conference: null,
  fieldSize: 3,
  rows: [
    row({ plate: '1', place: '1', displayName: '«RIDER-A»', riderId: 1 }),
    row({
      plate: '2',
      place: '65',
      status: 'finished',
      isLapped: true,
      pctBack: null,
      displayName: '«LAPPED-RIDER»',
      riderId: null,
    }),
    row({
      plate: '3',
      place: '*',
      status: 'dnf',
      pctBack: null,
      displayName: '«DNF-RIDER»',
      riderId: null,
    }),
  ],
};

describe('her row', () => {
  it('is marked with a text badge, not colour alone, and carries the anchor id', () => {
    const markup = render(smallField, 1);
    expect(markup).toContain('id="her"');
    expect(markup).toContain('Her result');
    expect(markup).toContain('«RIDER-A»');
  });

  it('states her headline as an ordinal against the field size', () => {
    const markup = render(smallField, 1);
    expect(markup).toContain('2nd of 2');
  });
});

describe('squad-mates', () => {
  it('are tinted and carry their own text badge, distinct from her own', () => {
    const markup = render(largeField, 1);
    expect(markup).toContain('Squad');
    // Her own row says "Her result", not "Squad", even though she is also a
    // squad-mate — the two badges never collide on one row.
    const herRowMatch = markup.match(/<li id="her"[^]*?<\/li>/);
    expect(herRowMatch).not.toBeNull();
    expect(herRowMatch![0]).toContain('Her result');
    expect(herRowMatch![0]).not.toContain('>Squad<');
  });

  it('reads correctly at the small end of the corpus: a two-rider Category', () => {
    const markup = render(smallField, 1);
    expect(markup).toContain('«RIVAL»');
    expect(markup).toContain('«RIDER-A»');
    expect(markup).toContain('2nd of 2');
  });

  it('reads correctly at the large end of the corpus: an eighty-rider Category', () => {
    const markup = render(largeField, 1);
    expect(markup).toContain('id="her"');
    expect(markup).toContain('80th of 80');
    expect((markup.match(/<li/g) ?? []).length).toBe(80);
  });
});

describe('who is included', () => {
  it('names the Category and the Conference it is scoped to', () => {
    const markup = render(smallField, 1);
    expect(markup).toContain('Varsity Girls - South');
    expect(markup).toContain('South Conference');
  });

  it('says league-wide instead of naming a Conference, at State Champs', () => {
    const markup = render(withDnfAndLapped, 1);
    expect(markup).toContain('every starter across the league');
  });
});

describe('the three states render inline', () => {
  it('draws a DNF as a row with no position, not a missing row', () => {
    const markup = render(withDnfAndLapped, 1);
    expect(markup).toContain('«DNF-RIDER»');
    expect(markup).toContain('>DNF<');
    expect((markup.match(/<li/g) ?? []).length).toBe(3);
  });

  it('draws a lapped rider as a row with no position, not her published rank', () => {
    const markup = render(withDnfAndLapped, 1);
    expect(markup).toContain('«LAPPED-RIDER»');
    expect(markup).toContain('>Lapped<');
    expect(markup).not.toContain('>65<');
  });

  it('never renders a null percent back as zero or as blank silence', () => {
    const markup = render(withDnfAndLapped, 1);
    expect(markup).toContain('no gap published');
    expect(markup).not.toMatch(/>0%</);
  });

  it('gives DNF and lapped their own chip class, matching the wall’s tones', () => {
    const markup = render(withDnfAndLapped, 1);
    expect(markup).toMatch(/bg-fg[^"]*"[^>]*>DNF/);
    expect(markup).toMatch(/bg-navy[^"]*"[^>]*>Lapped/);
  });
});

describe('no chart, no histogram', () => {
  it('draws no bar, sparkline, or any length-encoded mark', () => {
    const markup = render(largeField, 1);
    expect(markup).not.toContain('<svg');
    expect(markup).not.toMatch(/style="[^"]*(width|height):/);
  });
});
