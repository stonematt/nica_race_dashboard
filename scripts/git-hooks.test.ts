/**
 * The pre-commit hook is the whole safety argument for moving the corpus
 * in-tree (#30). Before the move, "no git command can commit minors' names"
 * was a fact about the filesystem; now it is a fact about this hook, so the
 * hook gets tested the way the allowlist does — for what it REFUSES.
 *
 * These run the real hook through a real `git commit` in a throwaway
 * repository. A unit test of a string matcher would pass while `git add -f`
 * walked straight past it.
 *
 * Every repository built here lives under os.tmpdir() and is removed again;
 * nothing touches this checkout's index or the corpus.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, statSync, symlinkSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CORPUS_DIRNAME, repoRoot } from '../src/lib/fixtures.ts';

const HOOKS_PATH = 'scripts/git-hooks';
const HOOK = join(repoRoot(), HOOKS_PATH, 'pre-commit');
const INSTALLER = join(repoRoot(), 'scripts', 'install-git-hooks.mjs');

/**
 * Global and system git config are pointed at nowhere: the developer running
 * this suite may have commit signing, a template dir, or a core.hooksPath of
 * their own, and none of that is under test here.
 */
const ISOLATED_GIT_ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function git(cwd: string, ...args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', env: ISOLATED_GIT_ENV });
}

/**
 * A repository shaped like this one: the same .gitignore rule, the same
 * hooksPath, the checked-in hook itself, and one payload sitting in fixtures/.
 */
async function scratchRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'nica-hook-'));
  created.push(dir);

  git(dir, 'init', '--quiet', '-b', 'main');
  git(dir, 'config', 'core.hooksPath', HOOKS_PATH);
  git(dir, 'config', 'commit.gpgsign', 'false');

  await mkdir(join(dir, HOOKS_PATH), { recursive: true });
  // Copied with the checked-in file's own mode, not a hardcoded 0o755. Git
  // ignores a hook that is not executable — it prints a hint and lets the
  // commit through — so if this repo ever loses the bit, every rejection test
  // below fails instead of quietly passing against a mode the test invented.
  await writeFile(join(dir, HOOKS_PATH, 'pre-commit'), readFileSync(HOOK), {
    mode: statSync(HOOK).mode & 0o777,
  });

  await writeFile(join(dir, '.gitignore'), `${CORPUS_DIRNAME}/\n`);
  await mkdir(join(dir, CORPUS_DIRNAME, '2025'), { recursive: true });
  await writeFile(
    join(dir, CORPUS_DIRNAME, '2025', 'raw-357242-individual-results-overall.json'),
    JSON.stringify({ data: [['«RIDER-A»', 'Some Middle School', '7', '00:41:12.3']] }),
  );
  await writeFile(join(dir, 'source.ts'), 'export const ok = true;\n');

  git(dir, 'add', '.gitignore', 'source.ts');
  git(dir, 'commit', '--quiet', '-m', 'initial');

  return dir;
}

const PAYLOAD = `${CORPUS_DIRNAME}/2025/raw-357242-individual-results-overall.json`;

describe('the pre-commit hook', () => {
  it('rejects a commit that stages a fixture payload', async () => {
    const dir = await scratchRepo();
    // Straight `git add` on a path .gitignore does not cover — a corpus copied
    // in before the ignore rule existed, or a stray fixtures/ in a subtree.
    await writeFile(join(dir, '.gitignore'), '');
    git(dir, 'add', PAYLOAD);
    expect(git(dir, 'diff', '--cached', '--name-only').stdout).toContain(PAYLOAD);

    const commit = git(dir, 'commit', '-m', 'add a payload');

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toContain('BLOCKED');
    expect(git(dir, 'log', '--oneline').stdout.trim().split('\n')).toHaveLength(1);
  });

  it('rejects it just as hard when the add was forced past .gitignore', async () => {
    const dir = await scratchRepo();
    // The failure mode the ticket is actually about. .gitignore is a request;
    // `git add -f` is how a payload gets committed by someone in a hurry.
    git(dir, 'add', '-f', PAYLOAD);
    expect(git(dir, 'diff', '--cached', '--name-only').stdout).toContain(PAYLOAD);

    const commit = git(dir, 'commit', '-m', 'force in a payload');

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toContain('BLOCKED');
    expect(git(dir, 'log', '--oneline').stdout.trim().split('\n')).toHaveLength(1);
  });

  it('names the reason and the way out', async () => {
    const dir = await scratchRepo();
    git(dir, 'add', '-f', PAYLOAD);

    const { stderr } = git(dir, 'commit', '-m', 'force in a payload');

    expect(stderr).toContain(PAYLOAD);
    expect(stderr).toMatch(/public/);
    expect(stderr).toMatch(/minors' full names/);
    expect(stderr).toContain('docs/fixtures.md');
    expect(stderr).toContain('--no-verify');
  });

  it('lets an ordinary source file through', async () => {
    const dir = await scratchRepo();
    await writeFile(join(dir, 'source.ts'), 'export const ok = false;\n');
    git(dir, 'add', 'source.ts');

    const commit = git(dir, 'commit', '-m', 'edit a source file');

    expect(commit.status).toBe(0);
    expect(git(dir, 'log', '--oneline').stdout.trim().split('\n')).toHaveLength(2);
  });

  it('lets a payload be deleted from history-in-progress', async () => {
    const dir = await scratchRepo();
    // Someone cleaning up after a bypass must be able to commit the removal.
    git(dir, 'add', '-f', PAYLOAD);
    git(dir, 'commit', '--no-verify', '-m', 'the mistake');
    git(dir, 'rm', '--quiet', '--cached', PAYLOAD);

    const commit = git(dir, 'commit', '-m', 'remove the payload');

    expect(commit.status).toBe(0);
  });

  it('rejects a payload renamed out of the corpus in the same commit', async () => {
    const dir = await scratchRepo();
    // The hole a path check has: `git mv fixtures/x.json notes.json` stages the
    // payload's bytes at a path nothing under fixtures/ would ever match.
    git(dir, 'add', '-f', PAYLOAD);
    git(dir, 'commit', '--no-verify', '-m', 'the mistake');
    git(dir, 'mv', PAYLOAD, 'notes.json');

    const commit = git(dir, 'commit', '-m', 'launder it out of fixtures/');

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toContain('renamed out of the corpus');
  });

  it('fails closed when it cannot read the index', async () => {
    const dir = await scratchRepo();
    // A hook that exits 0 on an unexpected git error is a hook that waves the
    // payload through on the one day something is wrong.
    const run = spawnSync('sh', [join(dir, HOOKS_PATH, 'pre-commit')], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...ISOLATED_GIT_ENV, GIT_INDEX_FILE: '/dev/null/nope' },
    });

    expect(run.status).not.toBe(0);
  });

  it('guards the directory the resolver actually reads', () => {
    // If CORPUS_DIRNAME ever moves, this fails rather than the hook silently
    // guarding a path nothing uses.
    expect(readFileSync(HOOK, 'utf8')).toContain(`:(top)${CORPUS_DIRNAME}`);
  });
});

describe('the pre-commit hook and symlinks into the corpus', () => {
  // #58. #52 taught the hook one name, `fixtures`, and recorded the rest as out
  // of scope. The guard now follows a link wherever it lands, and this is the
  // local half agreeing with it — two independent layers catching the same set
  // was the whole point of #52 and is not allowed to regress.

  it('rejects a corpus symlink staged under a name the pathspec never sees', async () => {
    const dir = await scratchRepo();
    // The ticket's reproduction, verbatim.
    symlinkSync(join(dir, CORPUS_DIRNAME), join(dir, 'fixtures2'));
    git(dir, 'add', '-f', 'fixtures2');

    const commit = git(dir, 'commit', '-m', 'sneak the corpus in sideways');

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toContain('BLOCKED');
    expect(commit.stderr).toContain('fixtures2');
    expect(git(dir, 'log', '--oneline').stdout.trim().split('\n')).toHaveLength(1);
  });

  it('rejects a relative link from a subdirectory into a season', async () => {
    const dir = await scratchRepo();
    await mkdir(join(dir, 'docs'), { recursive: true });
    symlinkSync(`../${CORPUS_DIRNAME}/2025`, join(dir, 'docs', 'nested-link'));
    git(dir, 'add', '-f', 'docs/nested-link');

    const commit = git(dir, 'commit', '-m', 'link a season from docs');

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toContain('BLOCKED');
    expect(commit.stderr).toContain('nested-link');
  });

  it('lets an ordinary symlink through', async () => {
    const dir = await scratchRepo();
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'notes.md'), '# notes\n');
    symlinkSync('docs', join(dir, 'docslink'));
    git(dir, 'add', 'docs/notes.md', 'docslink');

    const commit = git(dir, 'commit', '-m', 'link the docs directory');

    expect(commit.status).toBe(0);
    expect(git(dir, 'log', '--oneline').stdout.trim().split('\n')).toHaveLength(2);
  });

  it('follows a chain of links to a payload file, the way the guard does', async () => {
    // The hook resolves a directory target with `cd -P`, which cannot enter a
    // file. Its fallback has to resolve the directory the target lands in, not
    // the one the link sits in, or realpath() on the guard's side sees the
    // corpus and the hook does not — and the two layers stop agreeing.
    const dir = await scratchRepo();
    symlinkSync(`${CORPUS_DIRNAME}/2025`, join(dir, 'linkdir'));
    symlinkSync('linkdir/raw-357242-individual-results-overall.json', join(dir, 'evidence.json'));
    git(dir, 'add', '-f', 'evidence.json');

    const commit = git(dir, 'commit', '-m', 'link one payload through a link');

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toContain('evidence.json');
  });

  it('fails closed on a link it cannot resolve, and says which one', async () => {
    const dir = await scratchRepo();
    symlinkSync('../nowhere/fixtures', join(dir, 'gone'));
    git(dir, 'add', '-f', 'gone');

    const commit = git(dir, 'commit', '-m', 'stage a dangling link');

    expect(commit.status).not.toBe(0);
    expect(commit.stderr).toContain('gone');
    expect(commit.stderr).toMatch(/could not be resolved/);
  });
});

describe('hook installation', () => {
  it('is wired to the prepare lifecycle, so a plain pnpm install gets it', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot(), 'package.json'), 'utf8'));
    expect(pkg.scripts.prepare).toContain('scripts/install-git-hooks.mjs');
  });

  it('is executable, in the working tree and in the index', () => {
    // Learned the hard way: git skips a non-executable hook with nothing but a
    // hint on stderr, and the commit lands. `git ls-files -s` is the half that
    // matters for a fresh clone — the mode git records is the mode it checks out.
    expect(statSync(HOOK).mode & 0o111).toBe(0o111);
    const indexed = git(repoRoot(), 'ls-files', '-s', `${HOOKS_PATH}/pre-commit`).stdout;
    expect(indexed.startsWith('100755 ')).toBe(true);
  });

  it('restores an executable bit that a checkout dropped', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nica-install-'));
    created.push(dir);
    git(dir, 'init', '--quiet', '-b', 'main');
    const before = statSync(HOOK).mode;
    chmodSync(HOOK, 0o644);
    try {
      const run = spawnSync('node', [INSTALLER], {
        cwd: dir,
        encoding: 'utf8',
        env: ISOLATED_GIT_ENV,
      });
      expect(run.status).toBe(0);
      expect(statSync(HOOK).mode & 0o111).toBe(0o111);
    } finally {
      chmodSync(HOOK, before);
    }
  });

  it('is installed in this very checkout', () => {
    // `pnpm install` ran the installer; if this fails the developer is working
    // without the block.
    const configured = git(repoRoot(), 'config', '--get', 'core.hooksPath').stdout.trim();
    expect(configured).toBe(HOOKS_PATH);
    expect(existsSync(HOOK)).toBe(true);
  });

  it('points a fresh clone at the checked-in hooks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nica-install-'));
    created.push(dir);
    git(dir, 'init', '--quiet', '-b', 'main');

    const run = spawnSync('node', [INSTALLER], {
      cwd: dir,
      encoding: 'utf8',
      env: ISOLATED_GIT_ENV,
    });

    expect(run.status).toBe(0);
    expect(git(dir, 'config', '--get', 'core.hooksPath').stdout.trim()).toBe(HOOKS_PATH);
  });

  it('leaves somebody else’s hooksPath alone, and says the block is off', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nica-install-'));
    created.push(dir);
    git(dir, 'init', '--quiet', '-b', 'main');
    git(dir, 'config', 'core.hooksPath', '.husky');

    const run = spawnSync('node', [INSTALLER], {
      cwd: dir,
      encoding: 'utf8',
      env: ISOLATED_GIT_ENV,
    });

    expect(run.status).toBe(0);
    expect(git(dir, 'config', '--get', 'core.hooksPath').stdout.trim()).toBe('.husky');
    expect(run.stderr).toContain('NOT active');
  });

  it('does not fail an install outside a git checkout', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nica-install-'));
    created.push(dir);

    const run = spawnSync('node', [INSTALLER], {
      cwd: dir,
      encoding: 'utf8',
      env: ISOLATED_GIT_ENV,
    });

    expect(run.status).toBe(0);
  });
});
