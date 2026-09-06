/**
 * The Category view's presentational model, held on synthetic data — no
 * database, no corpus (issue #92).
 */

import { describe, expect, it } from 'vitest';
import type { CategoryField, CategoryFieldRow } from '../lib/category.ts';
import {
  HER_ROW_ID,
  anchorHeadline,
  crossingHeading,
  listDescription,
  ordinal,
  rowMark,
  scopeStatement,
} from './category-view.ts';

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

const conferenceField: CategoryField = {
  categoryName: 'HS2 Girls - North',
  scope: 'conference',
  conference: 'North',
  fieldSize: 30,
  rows: [],
};

const leagueField: CategoryField = {
  categoryName: 'HS2 Girls',
  scope: 'league',
  conference: null,
  fieldSize: 14,
  rows: [],
};

describe('ordinal', () => {
  it('spells the common suffixes', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
  });

  it('gives every teen a "th", including 11, 12 and 13', () => {
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
  });

  it('resumes 1st/2nd/3rd after the teens', () => {
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(23)).toBe('23rd');
    expect(ordinal(80)).toBe('80th');
  });
});

describe('anchorHeadline', () => {
  it('states her place as an ordinal against the field size — "3rd of 30"', () => {
    expect(anchorHeadline(row({ place: '3' }), 30)).toBe('3rd of 30');
  });

  it('works at the small end of the corpus: a two-rider Category', () => {
    expect(anchorHeadline(row({ place: '2' }), 2)).toBe('2nd of 2');
  });

  it('works at the large end of the corpus: an eighty-rider Category', () => {
    expect(anchorHeadline(row({ place: '80' }), 80)).toBe('80th of 80');
  });

  it('never invents an ordinal for a DNF — names the state, still gives the field size', () => {
    const text = anchorHeadline(row({ place: '*', status: 'dnf', pctBack: null }), 30);
    expect(text).toBe('DNF, field of 30');
    expect(text).not.toMatch(/\d+(st|nd|rd|th)/);
  });

  it('never invents an ordinal for a lapped rider even though she has a numeric place', () => {
    const text = anchorHeadline(
      row({ place: '65', status: 'finished', isLapped: true, pctBack: null }),
      70,
    );
    expect(text).toBe('Lapped, field of 70');
  });
});

describe('rowMark', () => {
  it('shows the published place verbatim for a finished, unlapped rider', () => {
    expect(rowMark(row({ place: '3' }))).toBe('3');
    // Never parsed, never re-derived.
    expect(rowMark(row({ place: '10' }))).toBe('10');
  });

  it('names DNF and lapped instead of printing whatever place string arrived', () => {
    expect(rowMark(row({ status: 'dnf', place: '*' }))).toBe('DNF');
    expect(rowMark(row({ status: 'finished', isLapped: true, place: '65' }))).toBe('Lapped');
  });
});

describe('scopeStatement', () => {
  it('names the Conference when the Category is Conference-scoped', () => {
    expect(scopeStatement(conferenceField)).toBe(
      'HS2 Girls - North — every starter in the North Conference.',
    );
  });

  it('says league-wide when the Category has merged, at State Champs', () => {
    expect(scopeStatement(leagueField)).toBe('HS2 Girls — every starter across the league.');
  });
});

describe('crossingHeading', () => {
  it('pairs the Category with the Round it was raced at', () => {
    expect(crossingHeading(conferenceField, 'Race 3')).toBe('HS2 Girls - North, Race 3');
  });
});

describe('listDescription', () => {
  it('states the field size and points at her row when she has one', () => {
    const her = row({ displayName: '«RIDER-A»' });
    const text = listDescription(conferenceField, her);
    expect(text).toContain('30 starters');
    expect(text).toContain('«RIDER-A»');
    expect(text).toContain('Squad-mates');
  });

  it('still states the field size when there is no row to point at', () => {
    expect(listDescription(conferenceField, undefined)).toContain('30 starters');
  });

  it('uses the singular for a one-rider field', () => {
    const one: CategoryField = { ...conferenceField, fieldSize: 1 };
    expect(listDescription(one, undefined)).toContain('1 starter in');
    expect(listDescription(one, undefined)).not.toContain('1 starters');
  });
});

describe('HER_ROW_ID', () => {
  it('is the same anchor the wall’s crossing link points at', () => {
    expect(HER_ROW_ID).toBe('her');
  });
});
