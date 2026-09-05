/**
 * The privacy guard is tested for what it REFUSES, and every payload it is
 * shown here is synthetic. Reading the real corpus into a test that CI runs
 * would defeat the thing being built.
 *
 * The synthetic payload copies the real shape — `DataFields` beside a `data`
 * bag of positional rows, per the 2026 opener's individual-results list — with
 * invented people in it.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scan, trackedFiles } from './privacy-guard.ts';
import { repoRoot } from '../src/lib/fixtures.ts';

/** The shape of a RaceResult list payload, with rows. */
function payload(rows: unknown[][]) {
  return JSON.stringify({
    list: { ListName: 'Online|Individual Results' },
    DataFields: ['BIB', 'ID', 'CategoryRank', 'ucase([DisplayName])', 'CLUB', 'TotalTime'],
    data: { '#1_Varsity Boys - North': rows },
  });
}

const A_ROW = ['214', '9', '1', 'Jordan Rivers', 'Some Composite', '00:41:12.3'];

describe('the tracked-corpus-path rule', () => {
  it('refuses anything tracked under fixtures/', () => {
    const findings = scan([{ path: 'fixtures/2025/raw-357242-overall.json', content: '{}' }]);
    expect(findings.map((f) => f.rule)).toEqual(['tracked-corpus-path']);
  });

  it('refuses anything tracked under data/', () => {
    expect(scan([{ path: 'data/dump.json', content: '{}' }])).toHaveLength(1);
  });

  it('does not care what is in the file', () => {
    // The path alone settles it. A payload emptied out is still a payload path.
    expect(scan([{ path: 'fixtures/2026/config-418436.json', content: payload([]) }])).toHaveLength(
      1,
    );
  });

  it('refuses a tracked path named exactly `fixtures`, with no trailing slash', () => {
    // #52: the prefix check on `fixtures/` never matches the bare path
    // `fixtures` at all, which is exactly what a symlink is tracked as.
    expect(scan([{ path: 'fixtures', content: '' }]).map((f) => f.rule)).toEqual([
      'tracked-corpus-path',
    ]);
  });

  it('refuses a tracked path named exactly `data` too', () => {
    expect(scan([{ path: 'data', content: '' }]).map((f) => f.rule)).toEqual([
      'tracked-corpus-path',
    ]);
  });

  it('refuses a tracked symlink named `fixtures`, whatever it points at', () => {
    // A symlink is a file to git — `git ls-files` reports it at the bare path
    // `fixtures`, no trailing slash, same as the case above. What the symlink
    // resolves to is irrelevant to this rule; the path itself is the finding.
    expect(
      scan([{ path: 'fixtures', content: '~/.local/share/nica_race_dashboard/fixtures' }]).map(
        (f) => f.rule,
      ),
    ).toEqual(['tracked-corpus-path']);
  });

  it('leaves an unrelated file with "fixtures" in its name alone', () => {
    // docs/fixtures.md is prose about the corpus, not a path under it.
    expect(scan([{ path: 'docs/fixtures.md', content: '# Fixture corpus\n' }])).toEqual([]);
  });
});

describe('the payload-rows rule', () => {
  it('refuses a committed payload that carries rows', () => {
    // The #31 regression this exists for: a stripper that starts emitting real
    // rows into the shape corpus fails the build instead of publishing them.
    const findings = scan([
      { path: 'fixtures-shape/2025/overall.json', content: payload([A_ROW]) },
    ]);
    expect(findings.map((f) => f.rule)).toContain('payload-rows');
  });

  it('counts rows across every group in the list', () => {
    const content = JSON.stringify({
      DataFields: ['BIB', 'ucase([DisplayName])'],
      data: { '#1_North': [A_ROW], '#2_South': [A_ROW, A_ROW] },
    });
    const finding = scan([{ path: 'shape/overall.json', content }]).find(
      (f) => f.rule === 'payload-rows',
    );
    expect(finding?.detail).toContain('3 row');
  });

  it('passes a stripped payload that kept the shape and dropped the rows', () => {
    // What #31 is supposed to produce: same columns, same groups, no people.
    const content = JSON.stringify({
      DataFields: ['BIB', 'ID', 'CategoryRank', 'ucase([DisplayName])', 'CLUB', 'TotalTime'],
      data: { '#1_Varsity Boys - North': [], '#2_Varsity Boys - South': [] },
    });
    expect(scan([{ path: 'shape/2025/overall.json', content }])).toEqual([]);
  });

  it('passes a two-level-nested payload that kept the shape and dropped the rows', () => {
    // A group grouped by group: category, then school, each stripped to [].
    // rowsOf() has to recurse past the inner group objects rather than
    // counting one of them as a single opaque "row".
    const content = JSON.stringify({
      DataFields: ['BIB', 'ID', 'CategoryRank', 'ucase([DisplayName])', 'CLUB', 'TotalTime'],
      data: {
        '#1_Varsity Boys': { '#1_North High': [], '#2_South High': [] },
        '#2_Varsity Girls': { '#1_North High': [] },
      },
    });
    expect(scan([{ path: 'shape/2025/overall.json', content }])).toEqual([]);
  });

  it('still refuses a two-level-nested payload that carries a real row', () => {
    // The false-negative this closes: a single-level flatMap returned the
    // inner group object itself as one "row", so a nested payload with rows
    // still in it could read as carrying only 1 opaque row rather than N real
    // ones — or, worse, an empty one could read as carrying 1.
    const content = JSON.stringify({
      DataFields: ['BIB', 'ID', 'CategoryRank', 'ucase([DisplayName])', 'CLUB', 'TotalTime'],
      data: {
        '#1_Varsity Boys': { '#1_North High': [A_ROW], '#2_South High': [] },
      },
    });
    const finding = scan([{ path: 'shape/2025/overall.json', content }]).find(
      (f) => f.rule === 'payload-rows',
    );
    expect(finding?.detail).toContain('1 row');
  });

  it('never echoes the row it found', () => {
    // A failure message is written to a public CI log.
    const findings = scan([{ path: 'shape/overall.json', content: payload([A_ROW]) }]);
    for (const finding of findings) {
      expect(finding.detail).not.toContain('Jordan');
      expect(finding.detail).not.toContain('Rivers');
    }
  });
});

describe('the name rules', () => {
  it('refuses a name in a positional row', () => {
    // An array of arrays is how RaceResult publishes people. That structure,
    // not the two capitalised words on its own, is what "payload-shaped" means.
    const content = JSON.stringify({ rows: [['214', 'Jordan Rivers', '00:41:12.3']] });
    expect(scan([{ path: 'docs/rows.json', content }]).map((f) => f.rule)).toEqual(['row-name']);
  });

  it('refuses the shouted form the source publishes', () => {
    // `ucase([DisplayName])` is a real column in the 2026 opener's list.
    const content = JSON.stringify({ rows: [['214', 'JORDAN RIVERS', '00:41:12.3']] });
    expect(scan([{ path: 'docs/rows.json', content }])).toHaveLength(1);
  });

  it('refuses a name carrying diacritics', () => {
    // An ASCII-only class quietly exempts a subset of the riders, which is the
    // worst possible thing for a guard whose whole job is covering all of them.
    for (const name of ['José García', 'JOSÉ GARCÍA']) {
      const content = JSON.stringify({ rows: [['214', name, '00:41:12.3']] });
      expect(scan([{ path: 'docs/rows.json', content }])).toHaveLength(1);
    }
  });

  it('refuses the surname-first order too', () => {
    const content = JSON.stringify({ rows: [['214', 'Rivers, Jordan', '00:41:12.3']] });
    expect(scan([{ path: 'docs/rows.json', content }])).toHaveLength(1);
  });

  it('refuses hyphenated and apostrophed names', () => {
    for (const name of ['Anne-Marie Dubois', "O'Brien Smith"]) {
      const content = JSON.stringify({ rows: [[name]] });
      expect(scan([{ path: 'docs/rows.json', content }])).toHaveLength(1);
    }
  });

  it('refuses a name under a field that names a person', () => {
    const content = JSON.stringify({ roster: [{ rider: 'Jordan Rivers', grade: 9 }] });
    expect(scan([{ path: 'docs/roster.json', content }]).map((f) => f.rule)).toEqual([
      'identity-key',
    ]);
  });

  it('refuses a key-to-display-name map', () => {
    // The names file deliberately lives outside this tree. This is the rule for
    // the day it stops doing so.
    const content = JSON.stringify({
      'rider-a': 'Jordan Rivers',
      'rider-b': 'Anne-Marie Dubois',
      'rider-c': 'José García',
    });
    expect(scan([{ path: 'config/rider-names.json', content }]).map((f) => f.rule)).toEqual([
      'name-map',
    ]);
  });

  it('refuses a name in a CSV data line', () => {
    const content = 'bib,name,time\n214,Jordan Rivers,00:41:12.3\n';
    expect(scan([{ path: 'docs/results.csv', content }]).map((f) => f.rule)).toEqual(['row-name']);
  });

  it('passes a pseudonym, which is how redacted examples are written here', () => {
    const content = JSON.stringify({ rows: [['214', '«RIDER-A»', '00:41:12.3']] });
    expect(scan([{ path: 'docs/worked-example.json', content }])).toEqual([]);
  });

  it('passes a flat list of school and club names', () => {
    // config/published-scoring-teams.json. Two capitalised words, no person —
    // and a guard that cries wolf on the repo's own config gets disabled.
    const content = JSON.stringify({
      '2025': ['Ashland High School', 'Corvallis Composite', 'Lake Oswego Composite'],
    });
    expect(scan([{ path: 'config/published-scoring-teams.json', content }])).toEqual([]);
  });

  it('passes a squad or club that has a name', () => {
    // A bare `name` key belongs to things as often as to people, so it is not
    // an identity key. config/club-seed.json relies on this.
    const content = JSON.stringify({
      club: 'Salem Composite Descenders',
      squads: [{ name: 'Fast Group', members: ['rider-a'] }],
    });
    expect(scan([{ path: 'config/club-seed.json', content }])).toEqual([]);
  });

  it('leaves prose and source alone', () => {
    const content = 'The coach Jordan Rivers asked for this.\n';
    expect(scan([{ path: 'docs/fixtures.md', content }])).toEqual([]);
    expect(scan([{ path: 'src/lib/seed.ts', content }])).toEqual([]);
  });

  it('passes the ordinary JSON a repo is full of', () => {
    const content = JSON.stringify({
      name: 'nica-race-dashboard',
      license: 'MIT',
      scripts: { test: 'vitest run' },
    });
    expect(scan([{ path: 'package.json', content }])).toEqual([]);
  });

  it('skips a file it could not read as text', () => {
    expect(scan([{ path: 'public/logo.png' }])).toEqual([]);
  });
});

describe('this repository', () => {
  it('is clean, and the guard does not cry wolf on its own committed files', () => {
    // The regression this exists for: an earlier version of the name rule
    // flagged config/published-scoring-teams.json and config/club-seed.json,
    // which carry school and squad names and no identity at all. A guard that
    // fails on the repo's own config is one that gets switched off. Running the
    // real scan here means CI catches that before a red build does.
    const findings = scan(
      trackedFiles(repoRoot()).map((path) => ({
        path,
        content: readFile(`${repoRoot()}/${path}`),
      })),
    );
    expect(findings).toEqual([]);
  });
});

function readFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}
