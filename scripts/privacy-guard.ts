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
 *   1. Nothing under `fixtures/` or `data/` is ever tracked, and neither path
 *      is ever tracked by itself either — a symlink named exactly `fixtures`
 *      or `data` is a file to git, not a directory, so a prefix check alone
 *      misses it (#52).
 *   1b. A tracked symlink that RESOLVES into either directory is refused under
 *      any name (#58). Rule 1 reads the path git recorded; this reads where
 *      that path lands, which is the only question that matters once the link
 *      is called `fixtures2` instead. A link the guard cannot resolve at all
 *      is refused too — an unreadable destination is not a cleared one. The
 *      pre-commit hook carries the same two checks so the layers still agree.
 *   2. A tracked RaceResult-shaped payload must carry NO rows. This is the rule
 *      that guards the committed shape corpus (#31): a stripper regression that
 *      starts emitting real rows fails the build rather than publishing them.
 *   3. No tracked JSON or CSV holds a name-shaped value WHERE A PERSON GOES: a
 *      positional row, a field that names a person, or an object that maps keys
 *      to display names. This is the name-shape assertion #28 asks for, and the
 *      structure matters as much as the shape — a flat list of school names is
 *      not payload-shaped data, and a guard that says it is gets disabled.
 *      Pseudonyms («RIDER-A»), the redaction form used here, pass.
 *
 * The core is a pure function over (path, content) pairs so it can be tested
 * against synthetic payloads without a git repo and without reading the real
 * corpus. `main()` is the thin shell that asks git what is tracked.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

/**
 * Directories whose contents are never committed. Rule 1 also rejects the
 * bare path with the trailing slash stripped — `fixtures`, `data` — so a
 * tracked symlink of that exact name is caught the same way a tracked
 * directory of that name is. See rule 1's doc above.
 */
export const FORBIDDEN_PREFIXES = ['fixtures/', 'data/'];

/**
 * The same two directories as bare names, for the segment test rule 1b applies
 * to a resolved link target. Derived rather than restated so the two rules can
 * never drift apart into guarding different sets.
 */
const FORBIDDEN_NAMES = FORBIDDEN_PREFIXES.map((prefix) => prefix.slice(0, -1));

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

/** The three ways a name-shaped value earns a finding. See nameFindings(). */
export type NameRule = 'row-name' | 'identity-key' | 'name-map';

export interface Finding {
  path: string;
  rule:
    'tracked-corpus-path' | 'corpus-symlink' | 'unresolvable-symlink' | 'payload-rows' | NameRule;
  detail: string;
}

/**
 * Where a tracked symlink points, as the shell was able to work it out.
 *
 * `resolved` is the destination relative to the repo root when it lands inside
 * the checkout and absolute when it lands outside — the corpus has a second
 * copy under `~/.local/share/`, and docs/fixtures.md tells you to link it into
 * a worktree, so an out-of-tree target is the ordinary case rather than the
 * exotic one. `unresolved` carries the raw link text for a link that resolves
 * nowhere; the guard reports that rather than guessing.
 */
export type LinkTarget = { resolved: string } | { unresolved: string };

const NAME_RULE_DETAIL: Record<NameRule, string> = {
  'row-name': 'a positional row holds a value shaped like a person’s full name',
  'identity-key': 'a field that names a person holds a value shaped like a full name',
  'name-map': 'an object maps keys to values that are mostly shaped like full names',
};

export interface ScannedFile {
  path: string;
  /** Undefined for a file that could not be read as text — treated as opaque. */
  content?: string;
  /** Present only for a tracked symlink. See LinkTarget. */
  link?: LinkTarget;
}

/** One row of `git ls-files -s`: the path, and whether git recorded a symlink. */
export interface TrackedEntry {
  path: string;
  isSymlink: boolean;
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

/**
 * Every row in a payload's `data`, whatever nesting the list happens to use.
 *
 * A group is either a list of rows (the base case: an array, returned as-is)
 * or another object of groups one level deeper — a two-level-nested
 * RaceResult payload groups by category and then by school, say. Recursing
 * until an array turns up is what makes an inner group object count as MORE
 * grouping rather than as a row in its own right; the earlier one-level
 * `flatMap` treated a nested group object as a single opaque "row", which is
 * what let a correctly stripped nested payload still report rows carried.
 *
 * A group that is neither an array nor an object — a bare string, number, or
 * `null` sitting where a list of rows was expected — still counts as one
 * opaque row rather than zero. That shape should never occur in a real
 * payload, but the guard fails toward counting a row it cannot make sense of
 * rather than silently dropping it: this is the never-narrow rule applied to
 * the one case recursion could otherwise have quietly zeroed out.
 */
function rowsOf(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (typeof data === 'object' && data !== null) {
    return Object.values(data as Record<string, unknown>).flatMap(rowsOf);
  }
  return data === undefined ? [] : [data];
}

function looksLikeAName(value: string): boolean {
  if (PSEUDONYM.test(value.trim())) return false;
  return NAME_SHAPE.test(value);
}

/** `Rider Name`, `display_name` and `RIDERNAME` all normalize to the same key. */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Keys that name a person rather than a thing. Deliberately excludes a bare
 * `name`: clubs, squads and scoring teams all have one, and a rule that fires
 * on every `name` in the repo is a rule people learn to route around.
 */
const IDENTITY_KEYS = new Set([
  'firstname',
  'lastname',
  'surname',
  'givenname',
  'fullname',
  'displayname',
  'ridername',
  'rider',
  'athlete',
  'participant',
]);

/** Enough values to tell a mapping from a coincidence. */
const NAME_MAP_MINIMUM = 3;

/**
 * Where a name is allowed to be found, and where it is not.
 *
 * The earlier version of this rule looked at every string in every tracked JSON
 * and flagged anything with two capitalised words in it. That fires on
 * `config/published-scoring-teams.json` ("Ashland High School") and on every
 * squad name in `config/club-seed.json` — files that carry no identity at all —
 * and a guard that cries wolf on the repo's own config is one that gets
 * disabled. So the rule asks where the name sits, not just whether it is there:
 *
 *   - **A positional row.** An array of arrays is how RaceResult publishes
 *     people, and it is what "payload-shaped data" means. A school name in a
 *     flat list of strings is not that shape.
 *   - **An identity key.** `displayName`, `lastName`, `rider` — a field that
 *     names a person by definition.
 *   - **A name map.** An object whose string values are mostly name-shaped: the
 *     key → display-name file that deliberately lives outside this tree, if it
 *     ever stopped doing so.
 */
function* nameFindings(value: unknown): Generator<NameRule> {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (
        Array.isArray(item) &&
        item.some((cell) => typeof cell === 'string' && looksLikeAName(cell))
      ) {
        yield 'row-name';
      }
      yield* nameFindings(item);
    }
    return;
  }

  if (typeof value !== 'object' || value === null) return;

  const entries = Object.entries(value as Record<string, unknown>);

  for (const [key, item] of entries) {
    if (typeof item === 'string' && IDENTITY_KEYS.has(normalizeKey(key)) && looksLikeAName(item)) {
      yield 'identity-key';
    }
  }

  const stringValues = entries.map(([, item]) => item).filter((item) => typeof item === 'string');
  if (
    stringValues.length >= NAME_MAP_MINIMUM &&
    stringValues.filter(looksLikeAName).length * 2 > stringValues.length
  ) {
    yield 'name-map';
  }

  for (const [, item] of entries) yield* nameFindings(item);
}

/** A CSV data line — the header names columns, the rest carry people. */
function csvNameFindings(content: string): boolean {
  return content
    .split('\n')
    .slice(1)
    .some((line) => line.split(',').some((cell) => looksLikeAName(cell.trim())));
}

/**
 * Rule 1b over a resolved link target. Returns the finding, or undefined for a
 * link that lands somewhere ordinary.
 *
 * The test is on path SEGMENTS, not a prefix: the target may be
 * `fixtures/2025`, or `/home/x/.local/share/bike_race_results/fixtures`, and
 * both are the corpus. Expressing an in-tree target relative to the repo root
 * before the split is what keeps a checkout that happens to live under a
 * directory called `data` from flagging every link in it.
 */
function linkFinding(link: LinkTarget): Omit<Finding, 'path'> | undefined {
  if ('unresolved' in link) {
    return {
      rule: 'unresolvable-symlink',
      detail:
        `symlink to \`${link.unresolved}\` could not be resolved; a link whose ` +
        'destination cannot be read is refused rather than cleared',
    };
  }

  const segments = link.resolved.split(/[\\/]/);
  const name = FORBIDDEN_NAMES.find((forbidden) => segments.includes(forbidden));
  if (name === undefined) return undefined;

  return {
    rule: 'corpus-symlink',
    detail:
      `symlink resolving to \`${link.resolved}\`, which is inside \`${name}/\` — ` +
      'the corpus is never committed, under this name or any other',
  };
}

/**
 * The whole guard. Pure: hand it what git says is tracked and it reports what
 * must not be there.
 */
export function scan(files: ScannedFile[]): Finding[] {
  const findings: Finding[] = [];

  for (const { path, content, link } of files) {
    const forbidden = FORBIDDEN_PREFIXES.find(
      (prefix) => path === prefix.slice(0, -1) || path.startsWith(prefix),
    );
    if (forbidden !== undefined) {
      const bareName = forbidden.slice(0, -1);
      findings.push({
        path,
        rule: 'tracked-corpus-path',
        detail:
          path === bareName
            ? `tracked as \`${path}\` itself — a symlink or file with this exact name is never committed`
            : `tracked under ${forbidden}, which is never committed`,
      });
      continue;
    }

    if (link !== undefined) {
      const symlinkFinding = linkFinding(link);
      if (symlinkFinding !== undefined) {
        findings.push({ path, ...symlinkFinding });
        continue;
      }
      // An ordinary link falls through on purpose: readFileSync() follows it,
      // so its target's content is scanned by rules 2 and 3 exactly as it is
      // today. Skipping every symlink here would be a narrowing.
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

        // The matching value is never echoed. If it is a real name, a failure
        // message in a public CI log is the last place to reproduce it.
        for (const rule of new Set(nameFindings(parsed))) {
          findings.push({ path, rule, detail: NAME_RULE_DETAIL[rule] });
        }
        continue;
      }
    }

    if (csvNameFindings(content)) {
      findings.push({ path, rule: 'row-name', detail: NAME_RULE_DETAIL['row-name'] });
    }
  }

  return findings;
}

/**
 * What git is tracking, relative to the repo root, with git's own record of
 * which entries are symlinks (mode 120000). Asking the index rather than
 * lstat()ing the working tree keeps the question the one the guard is for:
 * what is *committed*, not what happens to be on this disk.
 */
export function trackedEntries(cwd = process.cwd()): TrackedEntry[] {
  const listed = spawnSync('git', ['ls-files', '-s', '-z'], { cwd, encoding: 'utf8' });
  if (listed.status !== 0) {
    throw new Error(`git ls-files failed: ${listed.stderr.trim()}`);
  }
  return listed.stdout
    .split('\0')
    .filter((record) => record.length > 0)
    .map((record) => {
      // `<mode> <object> <stage>\t<path>`, and -z leaves the path unquoted.
      const tab = record.indexOf('\t');
      if (tab === -1) throw new Error(`git ls-files returned an unreadable record: ${record}`);
      return { path: record.slice(tab + 1), isSymlink: record.startsWith('120000 ') };
    });
}

/** Paths git is tracking, relative to the repo root. */
export function trackedFiles(cwd = process.cwd()): string[] {
  return trackedEntries(cwd).map((entry) => entry.path);
}

/**
 * Where a tracked symlink lands, ready for rule 1b. Fails closed: anything the
 * filesystem will not answer comes back as `unresolved` rather than as a throw,
 * so a dangling link is a finding with a message and not a stack trace.
 */
export function resolveTrackedLink(path: string, cwd = process.cwd()): LinkTarget {
  const link = join(cwd, path);

  let resolved: string;
  try {
    resolved = realpathSync(link);
  } catch {
    let raw: string;
    try {
      raw = readlinkSync(link);
    } catch {
      raw = '(unreadable)';
    }
    return { unresolved: raw };
  }

  let root: string;
  try {
    root = realpathSync(cwd);
  } catch {
    return { resolved };
  }

  const inside = relative(root, resolved);
  if (inside === '' || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) {
    return { resolved };
  }
  return { resolved: inside };
}

function read(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function main(): void {
  const tracked = trackedEntries();
  const findings = scan(
    tracked.map(({ path, isSymlink }) => ({
      path,
      content: read(path),
      link: isSymlink ? resolveTrackedLink(path) : undefined,
    })),
  );

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
