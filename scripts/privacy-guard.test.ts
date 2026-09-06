/**
 * The privacy guard is tested for what it REFUSES, and every payload it is
 * shown here is synthetic. Reading the real corpus into a test that CI runs
 * would defeat the thing being built.
 *
 * The synthetic payload copies the real shape — `DataFields` beside a `data`
 * bag of positional rows, per the 2026 opener's individual-results list — with
 * invented people in it.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveTrackedLink, scan, trackedFiles } from './privacy-guard.ts';
import { repoRoot } from '../src/lib/fixtures.ts';

/**
 * Every temporary tree the symlink tests build, removed again afterwards.
 * Nothing here touches this checkout's index or the real corpus.
 */
const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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
      scan([{ path: 'fixtures', content: '~/.local/share/bike_race_results/fixtures' }]).map(
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

  it('still counts a group that is neither an array nor an object as one row', () => {
    // Should never occur in a real payload, but the never-narrow rule means
    // recursing into objects must not quietly zero out a shape rowsOf() does
    // not recognize — it has to fail toward counting a row, not dropping one.
    const content = JSON.stringify({
      DataFields: ['BIB', 'ucase([DisplayName])'],
      data: { '#1_North': 'not a list of rows', '#2_South': null },
    });
    const finding = scan([{ path: 'shape/overall.json', content }]).find(
      (f) => f.rule === 'payload-rows',
    );
    expect(finding?.detail).toContain('2 row');
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
      name: 'bike-race-results',
      license: 'MIT',
      scripts: { test: 'vitest run' },
    });
    expect(scan([{ path: 'package.json', content }])).toEqual([]);
  });

  it('skips a file it could not read as text', () => {
    expect(scan([{ path: 'public/logo.png' }])).toEqual([]);
  });
});

describe('the corpus-symlink rule', () => {
  // #58: #52 closed the case where the link is named exactly `fixtures`, and
  // recorded the rest as out of scope. A link called anything else still walked
  // past both defences. The link's NAME is not the question; where it lands is.

  it('refuses a symlink into the corpus under a name that gives nothing away', () => {
    // `ln -s "$PWD/fixtures" ./fixtures2` — the reproduction from the ticket.
    expect(
      scan([{ path: 'fixtures2', link: { resolved: 'fixtures' } }]).map((f) => f.rule),
    ).toEqual(['corpus-symlink']);
  });

  it('refuses a symlink into a directory under the corpus', () => {
    expect(
      scan([{ path: 'nested-link', link: { resolved: 'fixtures/2025' } }]).map((f) => f.rule),
    ).toEqual(['corpus-symlink']);
  });

  it('refuses a symlink into the corpus copy that lives outside the repo', () => {
    // docs/fixtures.md tells you to symlink the corpus into a worktree. Named
    // `fixtures` that is rule 1's business; named anything else it is this one's,
    // and the target resolves nowhere near the checkout.
    const resolved = '/home/someone/.local/share/bike_race_results/fixtures/2025';
    expect(scan([{ path: 'corpus', link: { resolved } }]).map((f) => f.rule)).toEqual([
      'corpus-symlink',
    ]);
  });

  it('refuses one into data/ as well, so the two forbidden names stay in step', () => {
    expect(scan([{ path: 'dump', link: { resolved: 'data/2025' } }]).map((f) => f.rule)).toEqual([
      'corpus-symlink',
    ]);
  });

  it('names the link and where it landed, without echoing a row', () => {
    const [finding] = scan([{ path: 'fixtures2', link: { resolved: 'fixtures/2025' } }]);
    expect(finding.path).toBe('fixtures2');
    expect(finding.detail).toContain('fixtures/2025');
  });

  it('leaves an ordinary symlink alone', () => {
    // The rule that must not start crying wolf. A link to docs/ is a link to
    // docs/, and a guard that fails on one gets switched off.
    expect(scan([{ path: 'docslink', link: { resolved: 'docs' } }])).toEqual([]);
    expect(scan([{ path: 'readme', link: { resolved: 'docs/fixtures.md' } }])).toEqual([]);
  });

  it('fails closed on a link it cannot resolve, and says which one and why', () => {
    // A dangling link is a link whose destination the guard cannot see. It is
    // refused rather than waved through, and it reports rather than throws.
    const [finding] = scan([{ path: 'gone', link: { unresolved: '../elsewhere/fixtures' } }]);
    expect(finding.rule).toBe('unresolvable-symlink');
    expect(finding.path).toBe('gone');
    expect(finding.detail).toContain('../elsewhere/fixtures');
    expect(finding.detail).toMatch(/could not be resolved/);
  });

  it('still reports a link named `fixtures` as the path finding it has always been', () => {
    // The two layers agreeing on this exact path was the point of #52. Widening
    // must not reclassify it out from under the rule that already had it.
    expect(
      scan([{ path: 'fixtures', content: '', link: { resolved: 'fixtures' } }]).map((f) => f.rule),
    ).toEqual(['tracked-corpus-path']);
  });

  it('still scans an ordinary symlink’s content, so nothing is narrowed', () => {
    // A symlink is read through to its target. If the guard started skipping
    // every link it would lose a finding it makes today.
    const content = JSON.stringify({ rows: [['214', 'Jordan Rivers', '00:41:12.3']] });
    expect(
      scan([{ path: 'rows.json', content, link: { resolved: 'docs/rows.json' } }]).map(
        (f) => f.rule,
      ),
    ).toEqual(['row-name']);
  });
});

describe('resolving a tracked symlink', () => {
  // The filesystem half, which is where the bug actually lived: scan() can only
  // be as wide as what the shell hands it.

  async function tree(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'nica-guard-'));
    created.push(dir);
    const root = realpathSync(dir);
    await mkdir(join(root, 'fixtures', '2025'), { recursive: true });
    await mkdir(join(root, 'docs'), { recursive: true });
    return root;
  }

  it('reports a link into the corpus relative to the repo root', async () => {
    const root = await tree();
    symlinkSync(join(root, 'fixtures'), join(root, 'fixtures2'));
    expect(resolveTrackedLink('fixtures2', root)).toEqual({ resolved: 'fixtures' });
  });

  it('follows a relative link from a subdirectory', async () => {
    const root = await tree();
    symlinkSync('../fixtures/2025', join(root, 'docs', 'nested-link'));
    expect(resolveTrackedLink('docs/nested-link', root)).toEqual({ resolved: 'fixtures/2025' });
  });

  it('reports an ordinary link relative to the root too', async () => {
    const root = await tree();
    symlinkSync(join(root, 'docs'), join(root, 'docslink'));
    expect(resolveTrackedLink('docslink', root)).toEqual({ resolved: 'docs' });
  });

  it('keeps a target outside the repo absolute', async () => {
    const root = await tree();
    const outside = await mkdtemp(join(tmpdir(), 'nica-outside-'));
    created.push(outside);
    symlinkSync(outside, join(root, 'elsewhere'));
    expect(resolveTrackedLink('elsewhere', root)).toEqual({ resolved: realpathSync(outside) });
  });

  it('reports a dangling link as unresolved, carrying the target it names', async () => {
    const root = await tree();
    symlinkSync('../nowhere/fixtures', join(root, 'gone'));
    expect(resolveTrackedLink('gone', root)).toEqual({ unresolved: '../nowhere/fixtures' });
  });
});

describe('the guard as a script', () => {
  // End to end, against the ticket's own reproduction: a real repository, a
  // real forced add, the real entry point.

  async function scratchRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'nica-guard-repo-'));
    created.push(dir);
    const root = realpathSync(dir);
    spawnSync('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
    await mkdir(join(root, 'fixtures', '2025'), { recursive: true });
    await mkdir(join(root, 'docs'), { recursive: true });
    await writeFile(join(root, 'fixtures', '2025', 'raw.json'), '{"data":[["«RIDER-A»"]]}');
    await writeFile(join(root, 'docs', 'notes.md'), '# notes\n');
    await writeFile(join(root, '.gitignore'), 'fixtures/\n');
    spawnSync('git', ['add', '.gitignore', 'docs/notes.md'], { cwd: root });
    return root;
  }

  function runGuard(cwd: string) {
    return spawnSync('node', [join(repoRoot(), 'scripts', 'privacy-guard.ts')], {
      cwd,
      encoding: 'utf8',
    });
  }

  it('refuses the ticket’s reproduction: a corpus symlink under another name', async () => {
    const root = await scratchRepo();
    symlinkSync(join(root, 'fixtures'), join(root, 'fixtures2'));
    spawnSync('git', ['add', '-f', 'fixtures2'], { cwd: root });

    const run = runGuard(root);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('corpus-symlink');
    expect(run.stderr).toContain('fixtures2');
  });

  it('reports a dangling tracked link without a stack trace', async () => {
    const root = await scratchRepo();
    symlinkSync('../nowhere/fixtures', join(root, 'gone'));
    spawnSync('git', ['add', '-f', 'gone'], { cwd: root });

    const run = runGuard(root);

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('unresolvable-symlink');
    expect(run.stderr).not.toMatch(/at .*\(/);
  });

  it('stays clean when the only symlink is an ordinary one', async () => {
    const root = await scratchRepo();
    symlinkSync(join(root, 'docs'), join(root, 'docslink'));
    spawnSync('git', ['add', 'docslink'], { cwd: root });

    const run = runGuard(root);

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('privacy guard: clean');
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
