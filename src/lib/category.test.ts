/**
 * `buildCategoryField` on synthetic objects — no database.
 *
 * The behavior worth pinning is the ranking guard and the scope statement,
 * not arithmetic: this module never computes a place, a percent back or a
 * field size, it only ranks and packages what the query layer already
 * resolved.
 */

import { describe, expect, it } from 'vitest';
import { buildCategoryField, type CategoryFieldRow } from './category.ts';

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

describe('ranking', () => {
  it('sorts numerically, not lexically — 10 comes after 2', () => {
    const field = buildCategoryField('HS2 Girls - North', 'North', 3, [
      row({ place: '10', displayName: 'C' }),
      row({ place: '2', displayName: 'B' }),
      row({ place: '1', displayName: 'A' }),
    ]);
    expect(field.rows.map((r) => r.place)).toEqual(['1', '2', '10']);
  });

  it('sorts a DNF and any other non-numeric place after every placed rider', () => {
    const field = buildCategoryField('HS2 Girls - North', 'North', 3, [
      row({ place: '*', status: 'dnf', pctBack: null, displayName: 'DNF RIDER' }),
      row({ place: '2', displayName: 'B' }),
      row({ place: '1', displayName: 'A' }),
    ]);
    expect(field.rows.map((r) => r.place)).toEqual(['1', '2', '*']);
  });

  it('keeps every starter in the list — a DNF is a row, not a missing one', () => {
    const field = buildCategoryField('HS2 Girls - North', 'North', 2, [
      row({ place: '1', status: 'finished' }),
      row({ place: '*', status: 'dnf', pctBack: null }),
    ]);
    expect(field.rows).toHaveLength(2);
    expect(field.rows.map((r) => r.status)).toEqual(['finished', 'dnf']);
  });

  it('keeps the query layer’s own order among ties (stable sort)', () => {
    const field = buildCategoryField('HS2 Girls - North', 'North', 2, [
      row({ place: '', displayName: 'first-in' }),
      row({ place: '', displayName: 'second-in' }),
    ]);
    expect(field.rows.map((r) => r.displayName)).toEqual(['first-in', 'second-in']);
  });

  it('works at the small end of the corpus: a two-rider Category', () => {
    const field = buildCategoryField('Varsity Girls - South', 'South', 2, [
      row({ place: '2', displayName: 'B' }),
      row({ place: '1', displayName: 'A' }),
    ]);
    expect(field.rows.map((r) => r.place)).toEqual(['1', '2']);
    expect(field.fieldSize).toBe(2);
  });

  it('works at the large end of the corpus: an eighty-rider Category', () => {
    const rows = Array.from({ length: 80 }, (_, i) =>
      row({ place: String(80 - i), displayName: `rider-${i}` }),
    );
    const field = buildCategoryField('HS1 Boys - North', 'North', 80, rows);
    expect(field.rows).toHaveLength(80);
    expect(field.rows.map((r) => r.place)[0]).toBe('1');
    expect(field.rows.map((r) => r.place)[79]).toBe('80');
  });
});

describe('who is included', () => {
  it('states the Category is Conference-scoped when a Conference is given', () => {
    const field = buildCategoryField('HS2 Girls - North', 'North', 1, [row({})]);
    expect(field.scope).toBe('conference');
    expect(field.conference).toBe('North');
    expect(field.categoryName).toBe('HS2 Girls - North');
  });

  it('states the Category is league-wide at State Champs, when no Conference is given', () => {
    const field = buildCategoryField('HS2 Girls', null, 1, [row({})]);
    expect(field.scope).toBe('league');
    expect(field.conference).toBeNull();
    expect(field.categoryName).toBe('HS2 Girls');
  });

  it('carries field size as given, never counted from the rows', () => {
    // A caller that only handed over a subset still gets the source's own
    // field size back, unmassaged — this module never recomputes it.
    const field = buildCategoryField('HS2 Girls - North', 'North', 47, [row({})]);
    expect(field.fieldSize).toBe(47);
  });
});

describe('squad-mates', () => {
  it('passes the flag through untouched — this module does no membership lookup of its own', () => {
    const field = buildCategoryField('HS2 Girls - North', 'North', 3, [
      row({ place: '1', riderId: 9, isSquadMate: true }),
      row({ place: '2', riderId: null, isSquadMate: false }),
    ]);
    expect(field.rows.find((r) => r.place === '1')?.isSquadMate).toBe(true);
    expect(field.rows.find((r) => r.place === '2')?.isSquadMate).toBe(false);
  });
});

describe('description, never adjudication', () => {
  it('carries a DNF’s pctBack as null, exactly as given — never derived from a time', () => {
    const field = buildCategoryField('HS2 Girls - North', 'North', 1, [
      row({ status: 'dnf', place: '*', pctBack: null }),
    ]);
    expect(field.rows[0]!.pctBack).toBeNull();
  });

  it('carries a lapped rider’s pctBack as null even though she has a numeric place', () => {
    // NICA still prints a rank for a rider it pulled at the line. Null pctBack
    // here is exactly what the source view published — never recomputed.
    const field = buildCategoryField('HS2 Girls - North', 'North', 1, [
      row({ status: 'finished', isLapped: true, place: '65', pctBack: null }),
    ]);
    expect(field.rows[0]!.isLapped).toBe(true);
    expect(field.rows[0]!.pctBack).toBeNull();
  });
});
