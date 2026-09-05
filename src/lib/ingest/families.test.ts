/**
 * Family assignment. Default lane — signatures are shape, and shape is all this
 * reads.
 */

import { describe, expect, it } from 'vitest';
import { readColumnLayout } from './columns.ts';
import {
  assignFamily,
  FAMILIES,
  FamilyError,
  INDIVIDUAL_FLAT,
  recognizedExpressions,
  repeatOrdinals,
  SEASON_INDIVIDUAL,
  SEASON_TEAM,
} from './families.ts';

const INDIVIDUAL_FLAT_ALIASES = INDIVIDUAL_FLAT.aliases;
const INDIVIDUAL_FLAT_REQUIRED = INDIVIDUAL_FLAT.required;
const INDIVIDUAL_FLAT_IGNORED = INDIVIDUAL_FLAT.ignored;

const layoutOf = (expressions: string[]) => readColumnLayout('a list', expressions, []);

const MASS_START_2025 = [
  'BIB',
  'if(if([TransgenderOption]="Redundancy";[RANK5];[RANK1])>0;if([STATUS]<2;if([TransgenderOption]="Redundancy";[RANK5];[RANK1]);[TimeOrStatus]);"*")',
  'CLUB',
  'DisplayLapTime(1)',
  'TimeOrStatus',
];
const TIME_TRIAL_2025 = [
  'BIB',
  'RankOrStatusTT',
  'FIRSTNAME',
  'CLUB',
  'Start.TOD',
  'End.TOD',
  'TIME',
];
const MASS_START_2026 = [
  'BIB',
  'if([STATUS]=3;"*";[CategoryRank])',
  'CLUB',
  'PointsMatrix',
  'WithStatus([TotalTime])',
];
const TEAM_PLACE = 'choose([Division];[TS1.POSITION];[TS2.POSITION];[TS3.POSITION])';
const BY_TEAM = ['BIB', TEAM_PLACE, 'SexMF', 'Grade', 'iif([TS.SCORED]=1;"B;")', 'TimeOrStatus'];
const TEAM_DETAILED = ['BIB', TEAM_PLACE, 'CONTEST.TYPE', 'CONTEST.NAME', 'DisplayPoints'];

describe('assignFamily', () => {
  it('places all three published layouts of the flat individual list in one family', () => {
    for (const expressions of [MASS_START_2025, TIME_TRIAL_2025, MASS_START_2026]) {
      expect(assignFamily('a list', layoutOf(expressions), 1).family).toBe(INDIVIDUAL_FLAT);
    }
  });

  it('names which layout matched', () => {
    expect(assignFamily('a list', layoutOf(TIME_TRIAL_2025), 1).variant.name).toBe(
      'time-trial-2025',
    );
    expect(assignFamily('a list', layoutOf(MASS_START_2026), 1).variant.name).toBe(
      'mass-start-2026',
    );
  });

  it('uses nesting depth to separate families that share expressions', () => {
    // By-Team and Team Results - Detailed both nest three deep and both carry
    // `choose([Division];[TS1.POSITION];…)`; the flat list is depth 1. A decoder
    // that walks the wrong number of levels finds groups where it wants rows.
    expect(assignFamily('a list', layoutOf(BY_TEAM), 3).family.name).toBe('individual_by_team');
    expect(assignFamily('a list', layoutOf(TEAM_DETAILED), 3).family.name).toBe(
      'team_race_counter',
    );
    expect(() => assignFamily('a list', layoutOf(BY_TEAM), 1)).toThrow(FamilyError);
  });

  it('is fatal on zero matches, and says what the columns were', () => {
    // Skipping an unrecognized list is how a season goes missing.
    expect(() => assignFamily('a list', layoutOf(['BIB', 'CLUB']), 1)).toThrow(FamilyError);
    expect(() => assignFamily('a list', layoutOf(['BIB', 'CLUB']), 1)).toThrow(
      /matches no declared family/,
    );
  });

  it('is fatal on two matches rather than picking one', () => {
    const overlapping = [
      { ...INDIVIDUAL_FLAT, name: 'one' },
      { ...INDIVIDUAL_FLAT, name: 'two' },
    ];

    expect(() => assignFamily('a list', layoutOf(MASS_START_2025), 1, overlapping)).toThrow(
      /matches 2 declared layouts/,
    );
  });

  it('declares one family per source list, each with its own table', () => {
    expect(FAMILIES.map((family) => family.name)).toEqual([
      'individual_flat',
      'individual_by_team',
      'team_race_result',
      'team_race_counter',
      'season_individual',
      'season_team',
    ]);
    expect(new Set(FAMILIES.map((family) => family.target)).size).toBe(FAMILIES.length);
  });
});

describe('the flat individual declaration', () => {
  it('maps every expression to at most one canonical field', () => {
    // An expression that resolved to two fields would make the decode order
    // dependent, which is exactly what a positional decode must never be.
    const seen = new Map<string, string>();
    for (const [field, aliases] of Object.entries<readonly string[]>(INDIVIDUAL_FLAT_ALIASES)) {
      for (const alias of aliases) {
        expect(seen.get(alias), `${alias} maps to two canonical fields`).toBeUndefined();
        seen.set(alias, field);
      }
    }
  });

  it('does not ignore an expression it also maps', () => {
    const mapped = new Set(Object.values(INDIVIDUAL_FLAT_ALIASES).flat());
    for (const ignored of INDIVIDUAL_FLAT_IGNORED) {
      expect(mapped.has(ignored), `${ignored} is both mapped and ignored`).toBe(false);
    }
  });

  it('requires only what every layout actually publishes', () => {
    // Points are absent at State Champs and empty in every prologue row; laps
    // are published at four of eight events. Requiring either would halt an
    // event over a column the league chose not to print.
    expect(INDIVIDUAL_FLAT_REQUIRED).toEqual(['plate', 'scoringTeam', 'place', 'timeRaw']);
    expect(INDIVIDUAL_FLAT_REQUIRED).not.toContain('points');
    expect(INDIVIDUAL_FLAT_REQUIRED).not.toContain('laps');
  });

  it('keys the rider on BIB and never on ID', () => {
    // 468 `ID` values map to more than one person in a single 2025 season: it
    // is a per-event row key that restarts at 1 every race.
    expect(INDIVIDUAL_FLAT_ALIASES.plate).toEqual(['BIB']);
    expect(INDIVIDUAL_FLAT_ALIASES.sourceRowId).toEqual(['ID']);
    expect(INDIVIDUAL_FLAT_ALIASES.plate).not.toContain('ID');
  });

  it('decodes CLUB to scoring_team, never to anything named club', () => {
    // The source's CLUB is the NICA-reported peer string. Our `club` is the
    // parent organisation a coach runs and lives only in config tables.
    expect(INDIVIDUAL_FLAT_ALIASES.scoringTeam).toEqual(['CLUB']);
    expect(Object.keys(INDIVIDUAL_FLAT_ALIASES)).not.toContain('club');
  });

  it('carries every signature expression in the alias or ignore list', () => {
    const known = new Set([
      ...Object.values(INDIVIDUAL_FLAT_ALIASES).flat(),
      ...INDIVIDUAL_FLAT_IGNORED,
    ]);
    for (const variant of INDIVIDUAL_FLAT.variants) {
      for (const expression of variant.signature) {
        expect(known.has(expression), `${expression} signs a variant but is unclassified`).toBe(
          true,
        );
      }
    }
  });
});

describe('every family declaration', () => {
  it('maps each expression to at most one canonical field', () => {
    for (const family of FAMILIES) {
      const seen = new Map<string, string>();
      for (const [field, aliases] of Object.entries<readonly string[]>(family.aliases)) {
        for (const alias of aliases) {
          expect(seen.get(alias), `${family.name}: ${alias} maps to two fields`).toBeUndefined();
          seen.set(alias, field);
        }
      }
    }
  });

  it('never ignores an expression it also maps', () => {
    for (const family of FAMILIES) {
      const mapped = new Set(Object.values(family.aliases).flat());
      for (const ignored of family.ignored) {
        expect(mapped.has(ignored), `${family.name}: ${ignored} is mapped and ignored`).toBe(false);
      }
    }
  });

  it('requires only fields it declares an alias for', () => {
    for (const family of FAMILIES) {
      for (const field of family.required) {
        expect(
          family.aliases[field],
          `${family.name}: ${field} is required but unmapped`,
        ).toBeDefined();
      }
    }
  });

  it('accounts for every expression its own signatures use', () => {
    for (const family of FAMILIES) {
      const known = recognizedExpressions(family);
      for (const variant of family.variants) {
        for (const expression of [...variant.signature, ...(variant.absent ?? [])]) {
          expect(
            known.has(expression),
            `${family.name}/${variant.name}: ${expression} is unclassified`,
          ).toBe(true);
        }
      }
    }
  });

  it('names exactly one record layout for each season family', () => {
    for (const family of [SEASON_INDIVIDUAL, SEASON_TEAM]) {
      expect(family.variants.filter((variant) => variant.record)).toHaveLength(1);
    }
    // No per-race family has one: every per-race list is the record for its own
    // event, and there is nothing to choose between.
    for (const family of FAMILIES.filter((f) => !f.name.startsWith('season_'))) {
      expect(family.variants.some((variant) => variant.record)).toBe(false);
    }
  });
});

describe('repeatOrdinals', () => {
  const points = SEASON_INDIVIDUAL.repeats!.find((r) => r.name === 'racePoints')!;

  it('reads the block width off the payload, not off a fixed set', () => {
    // RACE1..RACE10 in the mid-season snapshots, RACE1..RACE4 at Race 4. An
    // unseen RACE7 widens the block rather than halting the event.
    const wide = layoutOf(Array.from({ length: 10 }, (_, i) => `DisplayUpgrades(${i + 1})`));
    const narrow = layoutOf(Array.from({ length: 4 }, (_, i) => `DisplayUpgrades(${i + 1})`));

    expect(repeatOrdinals(wide, points)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(repeatOrdinals(narrow, points)).toEqual([1, 2, 3, 4]);
  });

  it('reports a gap honestly rather than filling it in', () => {
    const gapped = layoutOf(['DisplayUpgrades(1)', 'DisplayUpgrades(3)']);

    expect(repeatOrdinals(gapped, points)).toEqual([1, 3]);
  });

  it('finds nothing when the block is absent', () => {
    expect(repeatOrdinals(layoutOf(['SeasonPlace']), points)).toEqual([]);
  });

  it('recognizes every ordinal of a repeat group as classified', () => {
    const known = recognizedExpressions(SEASON_INDIVIDUAL);

    expect(known.has('DisplayUpgrades(7)')).toBe(true);
    expect(known.has('LowScoreFormatting(10)')).toBe(true);
    expect(known.has('DisplayUpgrades(11)')).toBe(false);
  });
});
