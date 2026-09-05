/**
 * The CI half of the fixture-payload defence.
 *
 * `scripts/git-hooks/pre-commit` stops a payload being committed from a machine
 * that has the hook. This catches the machine that did not: a clone where
 * `core.hooksPath` was already taken, a `git commit --no-verify`, a web edit, a
 * contributor who never ran `pnpm install`. Same failure, two independent
 * chances to catch it, which is the point — see docs/fixtures.md.
 *
 * It reads TRACKED files only. The corpus itself sits in the working tree at
 * `fixtures/` and is gitignored; the question this asks is not "is there a
 * payload on this disk" but "did one get into the repository", and on a public
 * repo those are very different questions.
 *
 * Three rules, narrowest first:
 *
 *   1. Nothing under `fixtures/` or `data/` is ever tracked. Blunt, certain,
 *      and cheap.
 *   2. A tracked RaceResult-shaped payload must carry NO rows. This is the rule
 *      that guards the committed shape corpus (#31): a stripper regression that
 *      starts emitting real rows fails the build rather than publishing them.
 *   3. No tracked JSON or CSV carries a value shaped like a person's full name,
 *      in either order and with diacritics. This is the name-shape assertion #28
 *      asks for. Pseudonyms («RIDER-A»), which is how redacted examples are
 *      written in this repo, pass.
 *
 * The core is a pure function over (path, content) pairs so it can be tested
 * against synthetic payloads without a git repo and without reading the real
 * corpus. `main()` is the thin shell that asks git what is tracked.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Directories whose contents are never committed. */
export const FORBIDDEN_PREFIXES = ['fixtures/', 'data/'];

/** Only these get read for name shapes; everything else is prose or code. */
const SCANNED_EXTENSIONS = ['.json', '.csv'];

/**
 * One word of a person's name: "Jordan", the `ucase([DisplayName])` variant
 * "JORDAN", or a hyphenated or apostrophed compound. Unicode-aware on purpose —
 * an ASCII-only class quietly exempts every rider whose name carries a
 * diacritic, and "the guard does not cover some of the children" is not a
 * tradeoff anyone chose.
 */
const NAME_WORD = String.raw`(?:\p{Lu}\p{Ll}+(?:['’\-]\p{Lu}?\p{Ll}+)?|\p{Lu}{2,}(?:['’\-]\p{Lu}+)?)`;

/**
 * Two name words, in either order RaceResult publishes them: "Jordan Rivers" or
 * "Rivers, Jordan".
 *
 * This is a tripwire, not a classifier, and it is wrong in both directions. It
 * false-positives on any two capitalised words in a scanned value — a venue, a
 * category, a place — which costs one red build and a look. It false-negatives
 * on a mononym, an initial ("J. Rivers"), and any name a two-word shape does not
 * describe, which is why it is the third rule and not the only one: the path
 * rule and the payload-rows rule do not depend on recognising a name at all.
 */
const NAME_SHAPE = new RegExp(`(?<!\\p{L})${NAME_WORD}(?:, | )${NAME_WORD}(?!\\p{L})`, 'u');

/** A redacted stand-in. The established form in this repo is «RIDER-A». */
const PSEUDONYM = /^«[^»]+»$/;

export interface Finding {
  path: string;
  rule: 'tracked-corpus-path' | 'payload-rows' | 'name-shape';
  detail: string;
}

export interface ScannedFile {
  path: string;
  /** Undefined for a file that could not be read as text — treated as opaque. */
  content?: string;
}

/** A RaceResult list payload: a `DataFields` column list beside a `data` bag of rows. */
function isRaceResultPayload(value: unknown): value is { DataFields: unknown[]; data: unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as Record<string, unknown>).DataFields) &&
    (value as Record<string, unknown>).data !== undefined
  );
}

/** Every row in a payload's `data`, whatever nesting the list happens to use. */
function rowsOf(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (typeof data === 'object' && data !== null) {
    return Object.values(data as Record<string, unknown>).flatMap((group) =>
      Array.isArray(group) ? group : [group],
    );
  }
  return [];
}

/** Every string anywhere in a parsed JSON value. */
function* strings(value: unknown): Generator<string> {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const item of value) yield* strings(item);
  else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) yield* strings(item);
  }
}

function looksLikeAName(value: string): boolean {
  if (PSEUDONYM.test(value.trim())) return false;
  return NAME_SHAPE.test(value);
}

/**
 * The whole guard. Pure: hand it what git says is tracked and it reports what
 * must not be there.
 */
export function scan(files: ScannedFile[]): Finding[] {
  const findings: Finding[] = [];

  for (const { path, content } of files) {
    const forbidden = FORBIDDEN_PREFIXES.find((prefix) => path.startsWith(prefix));
    if (forbidden !== undefined) {
      findings.push({
        path,
        rule: 'tracked-corpus-path',
        detail: `tracked under ${forbidden}, which is never committed`,
      });
      continue;
    }

    if (content === undefined) continue;
    if (!SCANNED_EXTENSIONS.some((extension) => path.endsWith(extension))) continue;

    if (path.endsWith('.json')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        // Not JSON despite the name. Fall through to the raw name scan below.
        parsed = undefined;
      }

      if (parsed !== undefined) {
        if (isRaceResultPayload(parsed)) {
          const rows = rowsOf(parsed.data);
          if (rows.length > 0) {
            findings.push({
              path,
              rule: 'payload-rows',
              detail: `RaceResult payload carrying ${rows.length} row(s); a committed payload must carry none`,
            });
          }
        }

        const named = [...strings(parsed)].find(looksLikeAName);
        if (named !== undefined) {
          findings.push({
            path,
            rule: 'name-shape',
            // The matching value is NOT echoed. If it is a real name, this
            // message is the last place it should be reproduced.
            detail: 'a value is shaped like a person’s full name',
          });
        }
        continue;
      }
    }

    if (content.split('\n').some(looksLikeAName)) {
      findings.push({
        path,
        rule: 'name-shape',
        detail: 'a line is shaped like a person’s full name',
      });
    }
  }

  return findings;
}

/** Paths git is tracking, relative to the repo root. */
export function trackedFiles(cwd = process.cwd()): string[] {
  const listed = spawnSync('git', ['ls-files', '-z'], { cwd, encoding: 'utf8' });
  if (listed.status !== 0) {
    throw new Error(`git ls-files failed: ${listed.stderr.trim()}`);
  }
  return listed.stdout.split('\0').filter((path) => path.length > 0);
}

function read(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function main(): void {
  const tracked = trackedFiles();
  const findings = scan(tracked.map((path) => ({ path, content: read(path) })));

  if (findings.length === 0) {
    console.log(`privacy guard: clean (${tracked.length} tracked files)`);
    return;
  }

  console.error('\n  BLOCKED: payload-shaped data is committed to this repository.\n');
  for (const finding of findings) {
    console.error(`    ${finding.path}\n      ${finding.rule}: ${finding.detail}`);
  }
  console.error(
    '\n  This repository is public and RaceResult payloads carry minors’ full names,' +
      '\n  schools, grades, plates and finish times. Treat this as a disclosure, not a' +
      '\n  bad commit: the procedure is in docs/fixtures.md.\n',
  );
  process.exitCode = 1;
}

// Run only as a script, never on import from a test.
if (process.argv[1] !== undefined && process.argv[1].endsWith('privacy-guard.ts')) {
  main();
}
