/**
 * Club config validation. The properties that matter: the checked-in file is
 * valid and carries no identity, an unpublished scoring team is a hard failure,
 * and a plate is never claimed by two riders at the same race.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ClubConfigError,
  clubConfigPath,
  loadClubConfig,
  loadPublishedScoringTeams,
  loadRiderNames,
  parseClubConfig,
  parsePublishedScoringTeams,
  parseRiderNames,
  pseudonymFor,
  publishedScoringTeamsPath,
} from './club-config.ts';

const published = new Map([
  [
    2025,
    new Set([
      'Salem Composite',
      'South Salem High School Descenders',
      'Sprague High School Descenders',
      'Sherwood High School',
    ]),
  ],
]);

const base = {
  club: 'Descenders',
  season: 2025,
  scoringTeams: ['Salem Composite'],
  riders: [{ key: 'rider-a', plates: ['202'] }],
  squads: [{ name: 'Descenders', members: ['rider-a'] }],
};

const parse = (overrides: Record<string, unknown>, riderNames?: Map<string, string>) =>
  parseClubConfig({ ...base, ...overrides }, { publishedScoringTeams: published, riderNames });

const problemsOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ClubConfigError) return error.problems;
    throw error;
  }
  throw new Error('expected a ClubConfigError');
};

const tempFiles: string[] = [];
const tempFile = (name: string, contents: string): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'club-config-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, contents);
  tempFiles.push(dir);
  return file;
};

afterEach(() => {
  delete process.env.NICA_RIDER_NAMES;
  while (tempFiles.length > 0) fs.rmSync(tempFiles.pop()!, { recursive: true, force: true });
});

describe('the checked-in config', () => {
  it('is valid against the checked-in published scoring teams', () => {
    const config = loadClubConfig({ riderNamesFile: path.join(os.tmpdir(), 'no-such-names.json') });

    expect(config.club).toBe('Descenders');
    expect(config.season).toBe(2025);
    expect(config.scoringTeams).toEqual([
      'Salem Composite',
      'South Salem High School Descenders',
      'Sprague High School Descenders',
    ]);
    expect(config.riders.length).toBeGreaterThan(0);
    expect(config.squads.length).toBeGreaterThan(0);
  });

  it('carries no rider identity — this repo is public and the riders are minors', () => {
    // The whole privacy argument in one assertion: with no local names file
    // present, every display name the config can produce is its own pseudonym.
    // A real name in the committed file would fail here.
    const config = loadClubConfig({ riderNamesFile: path.join(os.tmpdir(), 'no-such-names.json') });
    for (const rider of config.riders) {
      expect(rider.displayName).toBe(pseudonymFor(rider.key));
      expect(rider.displayName).toMatch(/^«RIDER-[A-Z]+»$/);
    }

    // And nothing name-shaped is in the file's bytes either: keys are slugs,
    // plates are digits, and the only free text is the club and squad names.
    const raw = JSON.parse(fs.readFileSync(clubConfigPath, 'utf8')) as Record<string, unknown>;
    for (const rider of raw.riders as { key: string; plates: unknown[] }[]) {
      expect(rider.key).toMatch(/^rider-[a-z]+$/);
      expect(Object.keys(rider).sort()).toEqual(['key', 'plates']);
      for (const plate of rider.plates) expect(String(plate)).toMatch(/^\d+$/);
    }
  });

  it('lists the three Descenders scoring teams among the season it validates against', () => {
    const set = loadPublishedScoringTeams().get(2025);
    expect(set).toBeDefined();
    expect(set!.has('Salem Composite')).toBe(true);
    expect(set!.has('South Salem High School Descenders')).toBe(true);
    expect(set!.has('Sprague High School Descenders')).toBe(true);
    // The observed set is the whole league, not just this club — otherwise
    // validating a club's teams against it would be circular.
    expect(set!.size).toBeGreaterThan(10);
  });
});

describe('scoring-team validation', () => {
  it('refuses a string the league does not publish', () => {
    const problems = problemsOf(() => parse({ scoringTeams: ['Sprague Descenders'] }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Sprague Descenders');
    expect(problems[0]).toContain('2025');
  });

  it('catches a rename rather than letting the team drop out of the rollup', () => {
    // The failure this exists to prevent: the league renames a team, the config
    // still names the old string, the club rollup silently loses a third of its
    // riders and nothing anywhere says so.
    expect(() =>
      parse({
        scoringTeams: ['Salem Composite', 'Sprague High School Descenders (South)'],
      }),
    ).toThrow(ClubConfigError);
  });

  it('refuses a season with no published set rather than passing it', () => {
    const problems = problemsOf(() => parse({ season: 2024 }));
    expect(problems[0]).toContain('2024');
    expect(problems[0]).toContain('published-scoring-teams.json');
  });

  it('refuses a duplicate scoring team', () => {
    expect(() => parse({ scoringTeams: ['Salem Composite', 'Salem Composite'] })).toThrow(
      /listed twice/,
    );
  });

  it('requires at least one scoring team', () => {
    expect(() => parse({ scoringTeams: [] })).toThrow(ClubConfigError);
  });
});

describe('rider and plate validation', () => {
  it('accepts a bare plate string as the unbounded whole-season form', () => {
    const config = parse({ riders: [{ key: 'rider-a', plates: ['202'] }] });
    expect(config.riders[0]!.plates).toEqual([{ plate: '202', fromRound: null, toRound: null }]);
  });

  it('accepts a bounded plate', () => {
    const config = parse({
      riders: [
        {
          key: 'rider-a',
          plates: [
            { plate: '204', toRound: 2 },
            { plate: '886', fromRound: 3 },
          ],
        },
      ],
      squads: [{ name: 'Descenders', members: ['rider-a'] }],
    });
    expect(config.riders[0]!.plates).toEqual([
      { plate: '204', fromRound: null, toRound: 2 },
      { plate: '886', fromRound: 3, toRound: null },
    ]);
  });

  it('accepts a reissued plate when the two windows are disjoint', () => {
    const config = parse({
      riders: [
        { key: 'rider-a', plates: [{ plate: '204', toRound: 2 }] },
        { key: 'rider-b', plates: [{ plate: '204', fromRound: 3 }] },
      ],
      squads: [{ name: 'Descenders', members: ['rider-a', 'rider-b'] }],
    });
    expect(config.riders).toHaveLength(2);
  });

  it('refuses a plate two riders claim at the same race', () => {
    // A plate never belongs to two people at one event. Allowing it would make
    // the rider a result resolves to depend on row order.
    const problems = problemsOf(() =>
      parse({
        riders: [
          { key: 'rider-a', plates: [{ plate: '204', toRound: 3 }] },
          { key: 'rider-b', plates: [{ plate: '204', fromRound: 3 }] },
        ],
        squads: [{ name: 'Descenders', members: ['rider-a', 'rider-b'] }],
      }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('204');
    expect(problems[0]).toContain('disjoint');
  });

  it('refuses an unbounded plate that swallows a bounded one', () => {
    expect(() =>
      parse({
        riders: [
          { key: 'rider-a', plates: ['204'] },
          { key: 'rider-b', plates: [{ plate: '204', fromRound: 3 }] },
        ],
        squads: [{ name: 'Descenders', members: ['rider-a', 'rider-b'] }],
      }),
    ).toThrow(ClubConfigError);
  });

  it('refuses bounds that run backwards', () => {
    expect(() =>
      parse({ riders: [{ key: 'rider-a', plates: [{ plate: '204', fromRound: 4, toRound: 2 }] }] }),
    ).toThrow(/fromRound 4 after toRound 2/);
  });

  it('refuses a duplicate rider key', () => {
    expect(() =>
      parse({
        riders: [
          { key: 'rider-a', plates: ['202'] },
          { key: 'rider-a', plates: ['204'] },
        ],
      }),
    ).toThrow(/declared twice/);
  });

  it('refuses a rider key that is not a slug', () => {
    expect(() => parse({ riders: [{ key: 'Rider A', plates: ['202'] }] })).toThrow(ClubConfigError);
  });

  it('refuses a rider with no plates', () => {
    expect(() => parse({ riders: [{ key: 'rider-a', plates: [] }] })).toThrow(ClubConfigError);
  });
});

describe('squad validation', () => {
  it('refuses a member that is not a declared rider', () => {
    const problems = problemsOf(() =>
      parse({ squads: [{ name: 'Descenders', members: ['rider-z'] }] }),
    );
    expect(problems[0]).toContain('rider-z');
  });

  it('refuses a duplicate squad name', () => {
    expect(() =>
      parse({
        squads: [
          { name: 'Descenders', members: [] },
          { name: 'Descenders', members: [] },
        ],
      }),
    ).toThrow(/declared twice/);
  });
});

describe('structural validation', () => {
  it('refuses an unknown key, which would otherwise seed nothing in silence', () => {
    const problems = problemsOf(() => parse({ scoringTeam: ['Salem Composite'] }));
    expect(problems[0]).toContain('scoringTeam');
  });

  it('keeps a _-prefixed key, which is the maintainer documenting the file', () => {
    expect(() => parse({ _comment: ['notes for whoever edits this'] })).not.toThrow();
  });

  it('reports every problem in one pass', () => {
    const problems = problemsOf(() =>
      parse({
        club: '',
        scoringTeams: ['Nowhere High School'],
        squads: [{ name: 'Descenders', members: ['rider-z'] }],
      }),
    );
    expect(problems.length).toBeGreaterThanOrEqual(3);
  });
});

describe('rider names, kept outside the working tree', () => {
  it('falls back to the key pseudonym when there is no names file', () => {
    const config = parse({});
    expect(config.riders[0]!.displayName).toBe('«RIDER-A»');
  });

  it('takes a display name from the names map when one is there', () => {
    const config = parse({}, new Map([['rider-a', 'A Rider']]));
    expect(config.riders[0]!.displayName).toBe('A Rider');
  });

  it('refuses a names entry no rider declares, so a stale key is not silent', () => {
    const problems = problemsOf(() => parse({}, new Map([['rider-q', 'Someone Else']])));
    expect(problems[0]).toContain('rider-q');
  });

  it('reads the names file named by NICA_RIDER_NAMES', () => {
    process.env.NICA_RIDER_NAMES = tempFile('names.json', '{"rider-a": "A Rider"}');
    expect(loadRiderNames().get('rider-a')).toBe('A Rider');
  });

  it('treats an absent names file as the normal case, not an error', () => {
    process.env.NICA_RIDER_NAMES = path.join(os.tmpdir(), 'definitely-not-here.json');
    expect(loadRiderNames().size).toBe(0);
  });

  it('refuses a names file that maps a key to something that is not a name', () => {
    expect(() => parseRiderNames({ 'rider-a': 42 }, 'names.json')).toThrow(ClubConfigError);
  });
});

describe('published scoring teams file', () => {
  it('skips comment keys and keys the rest by year', () => {
    const parsed = parsePublishedScoringTeams({ _comment: ['why'], 2025: ['Salem Composite'] });
    expect([...parsed.keys()]).toEqual([2025]);
    expect(parsed.get(2025)!.has('Salem Composite')).toBe(true);
  });

  it('refuses a key that is not a season year', () => {
    expect(() => parsePublishedScoringTeams({ latest: ['Salem Composite'] })).toThrow(
      ClubConfigError,
    );
  });

  it('refuses a season whose value is not a list of strings', () => {
    expect(() => parsePublishedScoringTeams({ 2025: 'Salem Composite' })).toThrow(ClubConfigError);
  });
});

describe('loading from disk', () => {
  it('names the file it could not read', () => {
    const missing = path.join(os.tmpdir(), 'not-a-config.json');
    expect(() => loadClubConfig({ configFile: missing })).toThrow(new RegExp('not-a-config.json'));
  });

  it('reports malformed JSON as a config problem, not a raw parse error', () => {
    const file = tempFile('club-seed.json', '{ not json');
    expect(() => loadClubConfig({ configFile: file })).toThrow(ClubConfigError);
  });

  it('resolves both checked-in files without depending on the working directory', () => {
    expect(fs.existsSync(clubConfigPath)).toBe(true);
    expect(fs.existsSync(publishedScoringTeamsPath)).toBe(true);
  });
});
