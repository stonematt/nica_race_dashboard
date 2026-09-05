/**
 * The club's own facts, read from a checked-in config file.
 *
 * This is the hand-maintained half of the database — club, scoring teams,
 * roster, plate mappings and squads — and it is deliberately kept apart from
 * ingest. Normalize never writes any of it, and editing it never implies a
 * re-ingest. This module is the read-and-validate half of that split; nothing
 * here touches a database.
 *
 * Three properties carry the weight.
 *
 *   - **Identity is not in the config file.** The repository is public and the
 *     riders are minors, so a rider in `config/club-seed.json` is a stable key
 *     and a plate mapping and nothing that names anyone. Display names arrive
 *     from a separate key -> name map kept *outside* the working tree, the same
 *     place and for the same reason as the payload corpus (docs/fixtures.md).
 *     Out of the tree rather than in `.gitignore`: that makes an accidental
 *     `git add` impossible instead of merely discouraged. With no names file,
 *     every rider takes its own pseudonym — `rider-a` becomes `«RIDER-A»`,
 *     which is the redaction form already used in the issue threads.
 *
 *   - **An unpublished scoring team is a hard failure.** Every scoring-team
 *     string is checked against the season's observed set in
 *     `config/published-scoring-teams.json`. The club is the union of its
 *     scoring teams and the composite-subdivision rule keeps renaming them, so
 *     a string the league does not publish must not be allowed to quietly drop
 *     a team out of the club rollup. A season with no entry in that file is an
 *     error too, not a pass.
 *
 *     The registry is checked in rather than read back out of the database on
 *     purpose. Validating against ingested rows would make a config edit depend
 *     on ingest state — the exact coupling this split exists to prevent — and a
 *     partially ingested season would fail perfectly good teams. A checked-in
 *     list is deterministic and a league rename shows up as a reviewable diff.
 *
 *   - **It reports every problem at once.** A config file is edited by hand, so
 *     failing on the first bad line and making the maintainer re-run is a poor
 *     trade against listing everything wrong with it.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Repo root, resolved from this file so it does not depend on the cwd. */
const repoRoot = path.join(import.meta.dirname, '..', '..');

export const clubConfigPath = path.join(repoRoot, 'config', 'club-seed.json');
export const publishedScoringTeamsPath = path.join(
  repoRoot,
  'config',
  'published-scoring-teams.json',
);

/**
 * Where the key -> display name map lives by default. Outside the working tree,
 * beside the payload corpus. `NICA_RIDER_NAMES` overrides it.
 */
export const defaultRiderNamesPath = path.join(
  os.homedir(),
  '.local',
  'share',
  'nica_race_dashboard',
  'config',
  'rider-names.json',
);

/** One plate a rider raced under, with inclusive league-round bounds. */
export interface PlateBinding {
  plate: string;
  /** Null means "from the start of the season", the common case. */
  fromRound: number | null;
  /** Null means "to the end of the season", the common case. */
  toRound: number | null;
}

export interface RiderConfig {
  /** Stable, non-identifying handle. Referenced by squads and the names map. */
  key: string;
  /** The names map's entry, or the key's pseudonym when there is none. */
  displayName: string;
  plates: PlateBinding[];
}

export interface SquadConfig {
  name: string;
  /** Rider keys. Every one must be declared in `riders`. */
  members: string[];
}

export interface ClubConfig {
  club: string;
  season: number;
  scoringTeams: string[];
  riders: RiderConfig[];
  squads: SquadConfig[];
}

/** Every problem found in one pass, so a hand-edited file gets fixed in one go. */
export class ClubConfigError extends Error {
  readonly problems: string[];

  constructor(source: string, problems: string[]) {
    super(`${source} is not valid club config:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ClubConfigError';
    this.problems = problems;
  }
}

/**
 * The pseudonym a rider carries when no names file supplies a real one.
 * `rider-a` -> `«RIDER-A»`. Stable, so a screenshot or a test stays readable.
 */
export function pseudonymFor(riderKey: string): string {
  return `«${riderKey.toUpperCase()}»`;
}

const RIDER_KEY = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const KNOWN_KEYS = new Set(['club', 'season', 'scoringTeams', 'riders', 'squads']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A `_`-prefixed key is documentation the maintainer left in the file. */
function isCommentKey(key: string): boolean {
  return key.startsWith('_');
}

function readJson(file: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new ClubConfigError(file, [`cannot be read: ${(error as Error).message}`]);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ClubConfigError(file, [`is not valid JSON: ${(error as Error).message}`]);
  }
}

/**
 * The scoring-team strings the league published in a season, keyed by year.
 * Comment keys are stripped; everything else must be a year mapping to strings.
 */
export function parsePublishedScoringTeams(
  raw: unknown,
  source = publishedScoringTeamsPath,
): Map<number, Set<string>> {
  if (!isRecord(raw)) throw new ClubConfigError(source, ['must be a JSON object']);

  const problems: string[] = [];
  const byYear = new Map<number, Set<string>>();

  for (const [key, value] of Object.entries(raw)) {
    if (isCommentKey(key)) continue;
    const year = Number(key);
    if (!Number.isInteger(year)) {
      problems.push(`"${key}" is not a season year`);
      continue;
    }
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || v.trim() === '')) {
      problems.push(`season ${year} must be an array of non-empty scoring-team strings`);
      continue;
    }
    byYear.set(year, new Set(value as string[]));
  }

  if (problems.length > 0) throw new ClubConfigError(source, problems);
  return byYear;
}

export function loadPublishedScoringTeams(
  file = publishedScoringTeamsPath,
): Map<number, Set<string>> {
  return parsePublishedScoringTeams(readJson(file), file);
}

/**
 * The key -> display name map. Absent is the normal case on a public checkout
 * and is not an error; a *present* file with a key no rider declares is, since
 * that is a typo or a stale entry silently doing nothing.
 */
export function parseRiderNames(raw: unknown, source: string): Map<string, string> {
  if (!isRecord(raw)) throw new ClubConfigError(source, ['must be a JSON object of key -> name']);

  const problems: string[] = [];
  const names = new Map<string, string>();
  for (const [key, value] of Object.entries(raw)) {
    if (isCommentKey(key)) continue;
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`"${key}" must map to a non-empty display name`);
      continue;
    }
    names.set(key, value.trim());
  }

  if (problems.length > 0) throw new ClubConfigError(source, problems);
  return names;
}

export function loadRiderNames(file?: string): Map<string, string> {
  const resolved = file ?? process.env.NICA_RIDER_NAMES ?? defaultRiderNamesPath;
  if (!fs.existsSync(resolved)) return new Map();
  return parseRiderNames(readJson(resolved), resolved);
}

export interface ParseClubConfigOptions {
  publishedScoringTeams: Map<number, Set<string>>;
  /** Rider key -> display name. Missing keys fall back to the pseudonym. */
  riderNames?: Map<string, string>;
  /** Named in error messages. */
  source?: string;
}

/** Parse and fully validate club config. Pure: no filesystem, no database. */
export function parseClubConfig(raw: unknown, options: ParseClubConfigOptions): ClubConfig {
  const source = options.source ?? clubConfigPath;
  const problems: string[] = [];
  const riderNames = options.riderNames ?? new Map<string, string>();

  if (!isRecord(raw)) throw new ClubConfigError(source, ['must be a JSON object']);

  for (const key of Object.keys(raw)) {
    if (!isCommentKey(key) && !KNOWN_KEYS.has(key)) {
      problems.push(`unknown key "${key}" — a typo here would silently seed nothing`);
    }
  }

  const club = typeof raw.club === 'string' ? raw.club.trim() : '';
  if (club === '') problems.push('"club" must be a non-empty club name');

  const season = raw.season;
  if (typeof season !== 'number' || !Number.isInteger(season)) {
    problems.push('"season" must be an integer year');
  }

  const scoringTeams = parseScoringTeams(raw.scoringTeams, season, options, problems);
  const riders = parseRiders(raw.riders, riderNames, problems);
  const squads = parseSquads(raw.squads, new Set(riders.map((r) => r.key)), problems);

  if (problems.length > 0) throw new ClubConfigError(source, problems);

  return { club, season: season as number, scoringTeams, riders, squads };
}

function parseScoringTeams(
  raw: unknown,
  season: unknown,
  options: ParseClubConfigOptions,
  problems: string[],
): string[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push('"scoringTeams" must be a non-empty array of published scoring-team strings');
    return [];
  }

  const teams: string[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      problems.push('every entry of "scoringTeams" must be a non-empty string');
      continue;
    }
    const team = entry.trim();
    if (seen.has(team)) {
      problems.push(`scoring team "${team}" is listed twice`);
      continue;
    }
    seen.add(team);
    teams.push(team);
  }

  if (typeof season !== 'number' || !Number.isInteger(season)) return teams;

  const published = options.publishedScoringTeams.get(season);
  if (!published) {
    problems.push(
      `no published scoring teams are recorded for season ${season}, so nothing can be validated ` +
        `against. Add the season's published strings to config/published-scoring-teams.json.`,
    );
    return teams;
  }

  for (const team of teams) {
    if (!published.has(team)) {
      problems.push(
        `scoring team "${team}" is not one the league published in ${season}. Either it is a typo ` +
          `or the league renamed it — check the season's published set rather than letting the ` +
          `team drop silently out of the club rollup.`,
      );
    }
  }

  return teams;
}

function parseRiders(
  raw: unknown,
  riderNames: Map<string, string>,
  problems: string[],
): RiderConfig[] {
  if (!Array.isArray(raw)) {
    problems.push('"riders" must be an array');
    return [];
  }

  const riders: RiderConfig[] = [];
  const seenKeys = new Set<string>();
  /** plate -> the bounded windows claimed for it, to catch overlaps. */
  const windows = new Map<string, { key: string; from: number; to: number }[]>();

  for (const [index, entry] of raw.entries()) {
    const where = `riders[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${where} must be an object`);
      continue;
    }
    const key = typeof entry.key === 'string' ? entry.key.trim() : '';
    if (!RIDER_KEY.test(key)) {
      problems.push(`${where}.key "${String(entry.key)}" must be a lower-case slug, e.g. rider-a`);
      continue;
    }
    if (seenKeys.has(key)) {
      problems.push(`rider key "${key}" is declared twice`);
      continue;
    }
    seenKeys.add(key);

    const plates = parsePlates(entry.plates, `${where}.plates`, problems);
    for (const binding of plates) {
      const from = binding.fromRound ?? Number.NEGATIVE_INFINITY;
      const to = binding.toRound ?? Number.POSITIVE_INFINITY;
      const claimed = windows.get(binding.plate) ?? [];
      for (const other of claimed) {
        if (from <= other.to && other.from <= to) {
          // A plate is never held by two people at the same race — reissues are
          // always disjoint in time. An overlap here would make the rider a
          // race result resolves to depend on row order.
          problems.push(
            `plate ${binding.plate} is claimed by both "${other.key}" and "${key}" over ` +
              `overlapping rounds; a reissued plate must be bounded so the two windows are disjoint`,
          );
        }
      }
      claimed.push({ key, from, to });
      windows.set(binding.plate, claimed);
    }

    riders.push({ key, displayName: riderNames.get(key) ?? pseudonymFor(key), plates });
  }

  for (const key of riderNames.keys()) {
    if (!seenKeys.has(key)) {
      problems.push(`the rider names file has an entry for "${key}", which no rider declares`);
    }
  }

  return riders;
}

function parsePlates(raw: unknown, where: string, problems: string[]): PlateBinding[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push(`${where} must be a non-empty array of plates`);
    return [];
  }

  const plates: PlateBinding[] = [];
  for (const [index, entry] of raw.entries()) {
    // A bare string is the unbounded whole-season form, which is most of them.
    const binding = typeof entry === 'string' ? { plate: entry } : entry;
    if (!isRecord(binding)) {
      problems.push(`${where}[${index}] must be a plate string or an object`);
      continue;
    }
    const plate = typeof binding.plate === 'string' ? binding.plate.trim() : '';
    if (plate === '') {
      problems.push(`${where}[${index}].plate must be a non-empty plate number`);
      continue;
    }
    const fromRound = parseBound(binding.fromRound, `${where}[${index}].fromRound`, problems);
    const toRound = parseBound(binding.toRound, `${where}[${index}].toRound`, problems);
    if (fromRound !== null && toRound !== null && fromRound > toRound) {
      problems.push(`${where}[${index}] has fromRound ${fromRound} after toRound ${toRound}`);
      continue;
    }
    plates.push({ plate, fromRound, toRound });
  }
  return plates;
}

function parseBound(raw: unknown, where: string, problems: string[]): number | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    problems.push(`${where} must be a league round ordinal (a whole number from 1)`);
    return null;
  }
  return raw;
}

function parseSquads(raw: unknown, riderKeys: Set<string>, problems: string[]): SquadConfig[] {
  if (!Array.isArray(raw)) {
    problems.push('"squads" must be an array');
    return [];
  }

  const squads: SquadConfig[] = [];
  const seenNames = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    const where = `squads[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${where} must be an object`);
      continue;
    }
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    if (name === '') {
      problems.push(`${where}.name must be a non-empty squad name`);
      continue;
    }
    if (seenNames.has(name)) {
      problems.push(`squad "${name}" is declared twice`);
      continue;
    }
    seenNames.add(name);

    const rawMembers = entry.members;
    if (!Array.isArray(rawMembers)) {
      problems.push(`${where}.members must be an array of rider keys`);
      continue;
    }
    const members: string[] = [];
    for (const member of rawMembers) {
      if (typeof member !== 'string' || !riderKeys.has(member)) {
        problems.push(`squad "${name}" lists "${String(member)}", which is not a declared rider`);
        continue;
      }
      if (members.includes(member)) {
        problems.push(`squad "${name}" lists "${member}" twice`);
        continue;
      }
      members.push(member);
    }
    squads.push({ name, members });
  }
  return squads;
}

export interface LoadClubConfigOptions {
  /** Defaults to the checked-in `config/club-seed.json`. */
  configFile?: string;
  publishedScoringTeamsFile?: string;
  /** Defaults to `$NICA_RIDER_NAMES`, then the path outside the working tree. */
  riderNamesFile?: string;
}

/** Read the checked-in config, merge in local names, and validate the result. */
export function loadClubConfig(options: LoadClubConfigOptions = {}): ClubConfig {
  const configFile = options.configFile ?? clubConfigPath;
  return parseClubConfig(readJson(configFile), {
    publishedScoringTeams: loadPublishedScoringTeams(options.publishedScoringTeamsFile),
    riderNames: loadRiderNames(options.riderNamesFile),
    source: configFile,
  });
}
