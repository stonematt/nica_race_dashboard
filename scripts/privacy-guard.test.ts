/**
 * The privacy guard is tested for what it REFUSES, and every payload it is
 * shown here is synthetic. Reading the real corpus into a test that CI runs
 * would defeat the thing being built.
 *
 * The synthetic payload copies the real shape — `DataFields` beside a `data`
 * bag of positional rows, per the 2026 opener's individual-results list — with
 * invented people in it.
 */

import { describe, expect, it } from 'vitest';
import { scan } from './privacy-guard.ts';

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

  it('never echoes the row it found', () => {
    // A failure message is written to a public CI log.
    const findings = scan([{ path: 'shape/overall.json', content: payload([A_ROW]) }]);
    for (const finding of findings) {
      expect(finding.detail).not.toContain('Jordan');
      expect(finding.detail).not.toContain('Rivers');
    }
  });
});

describe('the name-shape rule', () => {
  it('refuses a JSON value shaped like a person’s full name', () => {
    const content = JSON.stringify({ roster: [{ rider: 'Jordan Rivers', grade: 9 }] });
    expect(scan([{ path: 'docs/roster.json', content }]).map((f) => f.rule)).toEqual([
      'name-shape',
    ]);
  });

  it('refuses the shouted form RaceResult publishes', () => {
    // `ucase([DisplayName])` is a real column in the 2026 opener's list.
    const content = JSON.stringify({ rows: [['214', 'JORDAN RIVERS', '00:41:12.3']] });
    expect(scan([{ path: 'docs/rows.json', content }])).toHaveLength(1);
  });

  it('refuses it in a CSV too', () => {
    const content = 'bib,name,time\n214,Jordan Rivers,00:41:12.3\n';
    expect(scan([{ path: 'docs/results.csv', content }]).map((f) => f.rule)).toEqual([
      'name-shape',
    ]);
  });

  it('passes a pseudonym, which is how redacted examples are written here', () => {
    const content = JSON.stringify({ rows: [['214', '«RIDER-A»', '00:41:12.3']] });
    expect(scan([{ path: 'docs/worked-example.json', content }])).toEqual([]);
  });

  it('leaves prose and source alone', () => {
    // The rule would light up on half the repo's comments otherwise, and a
    // guard everyone learns to override is not a guard.
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
