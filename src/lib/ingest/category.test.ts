/**
 * Category normalization. Default lane — category strings name contests, not
 * people, and every string here is quoted from the published group keys.
 */

import { describe, expect, it } from 'vitest';
import { CategoryError, normalizeCategory } from './category.ts';
import { stripGroupOrdinal } from './rows.ts';

describe('stripGroupOrdinal', () => {
  it('drops the presentation ordinal the source prefixes', () => {
    expect(stripGroupOrdinal('#18_HS2 Girl - South')).toBe('HS2 Girl - South');
    expect(stripGroupOrdinal('#1_Varsity Girls')).toBe('Varsity Girls');
  });

  it('leaves a key that carries no ordinal alone', () => {
    expect(stripGroupOrdinal('HS1 Boys - North')).toBe('HS1 Boys - North');
  });
});

describe('normalizeCategory', () => {
  it('splits a conference-suffixed category', () => {
    expect(normalizeCategory('#3_HS2 Boys - North')).toEqual({
      raw: 'HS2 Boys - North',
      canonical: 'HS2 Boys',
      gradeBand: 'HS2',
      gender: 'Boys',
      conference: 'North',
    });
  });

  it('leaves State Champs unsuffixed, with a null conference', () => {
    const category = normalizeCategory('#2_Varsity Boys');

    expect(category.canonical).toBe('Varsity Boys');
    expect(category.conference).toBeNull();
  });

  it('absorbs the missing space before the dash, and keeps the raw string', () => {
    // "HS2 Boys- South" is published at all four South-carrying 2025 events.
    const category = normalizeCategory('#21_HS2 Boys- South');

    expect(category.raw).toBe('HS2 Boys- South');
    expect(category.canonical).toBe('HS2 Boys');
    expect(category.conference).toBe('South');
  });

  it('repairs the singular Girl, and keeps the raw string', () => {
    const category = normalizeCategory('#18_HS2 Girl - South');

    expect(category.raw).toBe('HS2 Girl - South');
    expect(category.canonical).toBe('HS2 Girls');
    expect(category.gender).toBe('Girls');
  });

  it('lands both South defects on the same peer group as their North siblings', () => {
    // Seven of eight apparent league-wide upgrades in 2025 were this drift.
    expect(normalizeCategory('#21_HS2 Boys- South').canonical).toBe(
      normalizeCategory('#7_HS2 Boys - North').canonical,
    );
    expect(normalizeCategory('#18_HS2 Girl - South').canonical).toBe(
      normalizeCategory('#3_HS2 Girls - North').canonical,
    );
  });

  it('normalizes all fourteen published categories', () => {
    const canonical = new Set(
      ['MS1', 'MS2', 'MS3', 'HS1', 'HS2', 'HS3', 'Varsity'].flatMap((band) =>
        ['Boys', 'Girls'].map((gender) => normalizeCategory(`${band} ${gender} - South`).canonical),
      ),
    );

    expect(canonical.size).toBe(14);
  });

  it('refuses a category it does not recognize rather than guessing', () => {
    // A new spelling defect has to be added deliberately. Absorbing it would
    // silently split or merge a peer group.
    expect(() => normalizeCategory('#1_HS4 Boys')).toThrow(CategoryError);
    expect(() => normalizeCategory('#1_HS2 Girlz - South')).toThrow(CategoryError);
    expect(() => normalizeCategory('#1_HS2')).toThrow(/does not resolve/);
    expect(() => normalizeCategory('#1_HS2 Boys Extra')).toThrow(/does not resolve/);
  });

  it('does not read a conference out of the middle of a string', () => {
    expect(() => normalizeCategory('#1_North HS2 Boys')).toThrow(CategoryError);
  });
});
