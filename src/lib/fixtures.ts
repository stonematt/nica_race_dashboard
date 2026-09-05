/**
 * Where the RaceResult fixture corpus lives, and how to address a payload
 * inside it.
 *
 * The corpus used to sit at `~/.local/share/nica_race_dashboard/fixtures/`,
 * outside the working tree, so that no git command could commit minors' names
 * onto a public repo. Issue #30 moved it in-tree at `fixtures/` and replaced
 * that physical guarantee with a mechanical one: `.gitignore` plus the
 * pre-commit hook in `scripts/git-hooks/`, installed by `pnpm install`.
 *
 * This module is the reason the move is worth making. Resolution is anchored on
 * this file's own location, so it reads no environment variable, no config file
 * and no current working directory: a fresh clone finds the corpus, and a
 * fidelity test invoked from anywhere finds the same one. Do not add an
 * environment override — that is precisely the machine-local configuration this
 * ticket removed.
 *
 * Node-only (it stats the filesystem). Import it from tests and from `bin/`,
 * never from a React component.
 */

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The corpus directory name, relative to the repo root. */
export const CORPUS_DIRNAME = 'fixtures';

/**
 * Seasons the corpus carries. 2025 is the full Oregon League season; 2026 is the opener.
 *
 * Declared rather than discovered off disk on purpose, and this is not the same removal
 * #30 made. The corpus is hand-fetched and hand-placed, never generated, so a directory
 * showing up under `fixtures/` is not evidence a season is ready to read — a half-finished
 * copy, a typo'd rename, a stray extraction — all look identical to a real season to a
 * scan that just lists what is on disk. `hasCorpus()` already leans on this list rather
 * than on the filesystem to decide whether the corpus is present at all; a season that
 * silently discovered itself would make that check pass on a corpus nobody meant to
 * declare ready. Adding a season is a one-line, reviewable diff here, which is the
 * point — do not replace this with a `readdirSync(root)` scan.
 */
export const CORPUS_SEASONS = ['2025', '2026'] as const;

let cachedRepoRoot: string | undefined;

/**
 * The root of this checkout: the nearest ancestor of this file holding a
 * `package.json`.
 *
 * Anchored on `import.meta.url` rather than `process.cwd()` on purpose — cwd is
 * whatever the caller happened to be in, and under vitest it is not even
 * stable across suites.
 */
export function repoRoot(): string {
  if (cachedRepoRoot !== undefined) return cachedRepoRoot;

  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) {
      cachedRepoRoot = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find a package.json above ${dirname(fileURLToPath(import.meta.url))}. ` +
          'src/lib/fixtures.ts expects to be run from inside the checkout.',
      );
    }
    dir = parent;
  }
}

/** Absolute path to the in-tree corpus directory. Present or not — see hasCorpus(). */
export function corpusRoot(): string {
  return join(repoRoot(), CORPUS_DIRNAME);
}

/**
 * Address a payload inside the corpus.
 *
 * Throws rather than returning a path outside `fixtures/`. A caller building a
 * path out of payload contents should not be able to reach the rest of the
 * disk, and a test that means to read `../../.env` is better off failing.
 */
export function corpusPath(...segments: string[]): string {
  const root = corpusRoot();
  const candidate = resolve(root, ...segments);
  const inside = relative(root, candidate);
  if (inside.startsWith('..') || isAbsolute(inside)) {
    throw new Error(`Refusing ${candidate}: outside the corpus at ${root}`);
  }
  return candidate;
}

/** Whether the corpus is actually on this machine. False on a fresh clone. */
export function hasCorpus(): boolean {
  return CORPUS_SEASONS.every((season) => existsSync(join(corpusRoot(), season)));
}

/**
 * The corpus root, or an error that says how to get one.
 *
 * The corpus is not committed and is not re-fetchable on a whim — the crawl was
 * deliberately slow out of respect for a volunteer-run nonprofit's timing
 * vendor — so an absent corpus is a "go read the doc" situation, not an ENOENT
 * three frames deep in a fidelity assertion.
 */
export function requireCorpus(): string {
  if (!hasCorpus()) {
    throw new Error(
      `No fixture corpus at ${corpusRoot()}. It is gitignored and never committed; ` +
        'copy it from another checkout of yours rather than re-fetching. See docs/fixtures.md.',
    );
  }
  return corpusRoot();
}
