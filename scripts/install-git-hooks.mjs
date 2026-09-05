/**
 * Point git at the repo's checked-in hooks.
 *
 * Runs from the `prepare` lifecycle script, so an ordinary `pnpm install` in a
 * fresh clone installs the pre-commit payload block. A hook that needs a
 * separate setup step is a hook the clone that most needs it will not have.
 *
 * `core.hooksPath` rather than copying files into `.git/hooks`: the hook stays
 * version-controlled and reviewable, an edit to it takes effect immediately,
 * and because a relative hooksPath resolves against each working tree's root,
 * every git worktree gets its own copy of the hook it has checked out.
 *
 * Deliberately never fails the install. A tarball with no .git, a machine with
 * no git on PATH, or a hooksPath somebody else already configured are all
 * reasons to warn and step aside, not to break `pnpm install`.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOKS_PATH = 'scripts/git-hooks';
const HOOKS = ['pre-commit'];

function git(...args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

function warn(message) {
  console.warn(`[install-git-hooks] ${message}`);
}

const inRepo = git('rev-parse', '--git-dir');
if (inRepo.error || inRepo.status !== 0) {
  // Not a checkout (or no git at all). Nothing to install, nothing to say.
  process.exit(0);
}

const configured = git('config', '--get', 'core.hooksPath');
const current = configured.status === 0 ? configured.stdout.trim() : '';

if (current && current !== HOOKS_PATH) {
  warn(
    `core.hooksPath is already set to "${current}", leaving it alone. ` +
      `The fixture-payload pre-commit block is NOT active — set it with ` +
      `\`git config core.hooksPath ${HOOKS_PATH}\` or chain ${HOOKS_PATH}/pre-commit ` +
      `from your own hook. See docs/fixtures.md.`,
  );
  process.exit(0);
}

if (current === HOOKS_PATH) {
  process.exit(0);
}

const set = git('config', 'core.hooksPath', HOOKS_PATH);
if (set.status !== 0) {
  warn(`could not set core.hooksPath: ${set.stderr.trim()}`);
  process.exit(0);
}

console.log(`[install-git-hooks] core.hooksPath -> ${HOOKS_PATH}`);

/**
 * Git silently ignores a hook without the executable bit — it prints a hint
 * and lets the commit through. That is the worst possible failure for this
 * particular hook, and it is exactly what a checkout with core.fileMode=false,
 * a zip download, or a Windows worktree produces. Re-assert the bit rather
 * than trusting the mode git recorded.
 */
const hooksDir = join(dirname(dirname(fileURLToPath(import.meta.url))), HOOKS_PATH);
for (const hook of HOOKS) {
  const path = join(hooksDir, hook);
  if (!existsSync(path)) continue;
  const mode = statSync(path).mode;
  if ((mode & 0o111) !== 0o111) {
    chmodSync(path, mode | 0o755);
  }
}
