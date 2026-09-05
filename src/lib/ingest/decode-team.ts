/**
 * The three per-race lists that are not the spine: the By-Team attribute
 * sidecar, `Team Results`, and `Team Results - Detailed`.
 *
 * Each decodes verbatim into exactly one table. Merging them into the spine was
 * rejected on issue #7 and the reasons still hold: the By-Team join is 1,336 of
 * 1,338 rows with two orphans that would have nowhere to live, By-Team is
 * high-school-only so half the corpus would be null by construction, and a
 * fidelity test needs a table that maps to exactly one list.
 */

import {
  INDIVIDUAL_BY_TEAM,
  TEAM_RACE_COUNTER,
  TEAM_RACE_RESULT,
  type LayoutVariant,
} from './families.ts';
import {
  cellReader,
  checkExpressionsRecognized,
  checkRowCount,
  checkUniqueKey,
  DecodeError,
  groupedRows,
  parseIntOrRefuse,
  readListLayout,
  resolveFamilyFields,
  type DecodedList,
  type ListPayload,
} from './rows.ts';

/* ── By-Team ──────────────────────────────────────────────────────────────── */

export interface ByTeamRow {
  plate: string;
  sourceRowId: string | null;
  displayName: string;
  teamPlace: string | null;
  place: string | null;
  categoryRaw: string | null;
  gender: string | null;
  grade: string | null;
  points: number | null;
  lap1: string | null;
  lap2: string | null;
  lap3: string | null;
  lap4: string | null;
  lap5: string | null;
  penalty: string | null;
  timeRaw: string | null;
  scored: boolean;
}

/**
 * Normalize the published grade, and leave a blank one unknown.
 *
 * The format drifts — `9.0` at some events, `9` at others — and six rows across
 * the season carry nothing at all. Trimming the decimal is a typed coercion of
 * one value; **turning a blank into a number would be an invention**, so a
 * blank stays null. A rider with no published grade has no grade here.
 */
export function normalizeGrade(where: string, raw: string | null): string | null {
  if (raw === null) return null;

  const grade = raw.trim();
  if (grade === '') return null;
  if (!/^\d+(\.0+)?$/.test(grade)) {
    throw new DecodeError(
      `${where}: grade "${raw}" is neither a year nor blank. ` +
        'A grade that is not a number must be classified deliberately, not coerced.',
    );
  }
  return String(Number(grade));
}

/** Decode `Individual Results - By Team` — the high-school attribute sidecar. */
export function decodeByTeam(
  where: string,
  variant: LayoutVariant,
  payload: ListPayload,
): DecodedList<ByTeamRow> {
  const layout = readListLayout(where, payload);
  checkExpressionsRecognized(where, layout, INDIVIDUAL_BY_TEAM);

  const columns = resolveFamilyFields(where, layout, INDIVIDUAL_BY_TEAM);
  const at = cellReader(layout, columns);
  const rows: ByTeamRow[] = [];

  for (const { groups, row, number } of groupedRows(
    where,
    payload.data,
    INDIVIDUAL_BY_TEAM.depth,
  )) {
    layout.checkRowWidth(row, number);

    const plate = at(row, 'plate');
    const displayName = at(row, 'displayName');
    if (plate === null || displayName === null) {
      throw new DecodeError(
        `${where}: row ${number} in [${groups.join(' > ')}] has no plate or name.`,
      );
    }

    rows.push({
      plate,
      sourceRowId: at(row, 'sourceRowId'),
      displayName,
      teamPlace: at(row, 'teamPlace'),
      place: at(row, 'place'),
      // The category comes from the row here, not the group: the By-Team group
      // label is the team, and it carries whitespace defects of its own
      // ("Klamath Falls Composite  - D2"). Never key on that label.
      categoryRaw: at(row, 'categoryRaw'),
      gender: at(row, 'gender'),
      grade: normalizeGrade(where, at(row, 'grade')),
      points: parseIntOrRefuse(where, 'points', at(row, 'points')),
      lap1: at(row, 'lap1'),
      lap2: at(row, 'lap2'),
      lap3: at(row, 'lap3'),
      lap4: at(row, 'lap4'),
      lap5: at(row, 'lap5'),
      penalty: at(row, 'penalty'),
      timeRaw: at(row, 'timeRaw'),
      // `B;` means this rider's points counted toward the team score.
      scored: at(row, 'scored') === 'B;',
    });
  }

  const publishedCount = checkRowCount(where, payload.list?.ListFooterText, rows.length);
  checkUniqueKey(
    where,
    'plates',
    rows.map((row) => row.plate),
  );

  return { variant, expressions: layout.dataFields, publishedCount, rows };
}

/* ── Team Results ─────────────────────────────────────────────────────────── */

export interface TeamRaceRow {
  scoringTeam: string;
  division: string | null;
  place: string | null;
  penaltyPoints: number | null;
  points: number | null;
}

/** Decode `Team Results` — one row per scoring team, high school only. */
export function decodeTeamRace(
  where: string,
  variant: LayoutVariant,
  payload: ListPayload,
): DecodedList<TeamRaceRow> {
  const layout = readListLayout(where, payload);
  checkExpressionsRecognized(where, layout, TEAM_RACE_RESULT);

  const columns = resolveFamilyFields(where, layout, TEAM_RACE_RESULT);
  const at = cellReader(layout, columns);
  const rows: TeamRaceRow[] = [];

  for (const { groups, row, number } of groupedRows(where, payload.data, TEAM_RACE_RESULT.depth)) {
    layout.checkRowWidth(row, number);

    const scoringTeam = at(row, 'scoringTeam');
    if (scoringTeam === null) {
      throw new DecodeError(`${where}: row ${number} in [${groups.join(' > ')}] names no team.`);
    }

    rows.push({
      // The source's CLUB is our scoring_team, never our club.
      scoringTeam,
      // `High School > Division N`. The level is constant in this family and
      // the schema keeps only the division.
      division: groups[1] ?? null,
      place: at(row, 'place'),
      // Empty at every row of every 2025 event — the column exists and no
      // penalty was ever assessed. Stored as null, never as 0.
      penaltyPoints: parseIntOrRefuse(where, 'penalty points', at(row, 'penaltyPoints')),
      points: parseIntOrRefuse(where, 'points', at(row, 'points')),
    });
  }

  const publishedCount = checkRowCount(where, payload.list?.ListFooterText, rows.length);
  checkUniqueKey(
    where,
    'scoring teams',
    rows.map((row) => row.scoringTeam),
  );

  return { variant, expressions: layout.dataFields, publishedCount, rows };
}

/* ── Team Results - Detailed ──────────────────────────────────────────────── */

export interface TeamCounterRow {
  plate: string;
  level: string | null;
  division: string | null;
  scoringTeam: string;
  teamPlace: string | null;
  teamPoints: number | null;
  teamPenaltyPoints: number | null;
  displayName: string | null;
  individualPoints: number | null;
  gender: string | null;
  type: string | null;
  categoryRaw: string | null;
}

/** What the packed team node carries. */
export interface TeamNode {
  rank: string;
  scoringTeam: string;
  points: number | null;
  penaltyPoints: number | null;
}

/**
 * Split the packed team node.
 *
 * `1.///Portland Metro Composite///3834 Points /// Penalty Points: 0` — four
 * parts, always. The team's name, score and penalty are published *only* here,
 * inside a group label, which is why this parse is not optional: it is the sole
 * source of middle-school team scoring in the whole catalog.
 */
export function parseTeamNode(where: string, node: string): TeamNode {
  const parts = node.split('///');
  if (parts.length !== 4) {
    throw new DecodeError(
      `${where}: team node "${node}" splits into ${parts.length} parts, not 4. ` +
        'The team name, score and penalty are published nowhere else.',
    );
  }

  const [rank, scoringTeam, points, penalty] = parts as [string, string, string, string];
  const pointsMatch = /(-?\d+)\s*Points/i.exec(points);
  const penaltyMatch = /Penalty Points:\s*(-?\d+)/i.exec(penalty);

  if (!pointsMatch || !penaltyMatch) {
    throw new DecodeError(
      `${where}: team node "${node}" does not carry "<n> Points" and "Penalty Points: <n>".`,
    );
  }

  return {
    rank: rank.trim().replace(/\.$/, ''),
    scoringTeam: scoringTeam.trim(),
    points: Number(pointsMatch[1]),
    penaltyPoints: Number(penaltyMatch[1]),
  };
}

/**
 * Decode `Team Results - Detailed` — the counters, and the only published
 * source of middle-school team scoring.
 *
 * State Champs adds a third top-level group with an empty label: 80 rows over
 * 20 team nodes, all scoring 0, with no category and no points. They are
 * registered-but-unclassified entrants and they are **kept**, with a null
 * level, rather than filtered — dropping 80 published rows to tidy a group
 * label is exactly the kind of decision that belongs in a view, not in ingest.
 */
export function decodeTeamCounter(
  where: string,
  variant: LayoutVariant,
  payload: ListPayload,
): DecodedList<TeamCounterRow> {
  const layout = readListLayout(where, payload);
  checkExpressionsRecognized(where, layout, TEAM_RACE_COUNTER);

  const columns = resolveFamilyFields(where, layout, TEAM_RACE_COUNTER);
  const at = cellReader(layout, columns);
  const rows: TeamCounterRow[] = [];

  for (const { groups, row, number } of groupedRows(where, payload.data, TEAM_RACE_COUNTER.depth)) {
    layout.checkRowWidth(row, number);

    const plate = at(row, 'plate');
    if (plate === null) {
      throw new DecodeError(`${where}: row ${number} in [${groups.join(' > ')}] has no plate.`);
    }
    const node = parseTeamNode(where, groups[2] ?? '');

    rows.push({
      plate,
      // "High School" | "Middle School", or empty at the State Champs
      // unclassified group.
      level: groups[0] || null,
      division: groups[1] ?? null,
      scoringTeam: node.scoringTeam,
      teamPlace: at(row, 'teamPlace'),
      teamPoints: node.points,
      teamPenaltyPoints: node.penaltyPoints,
      displayName: at(row, 'displayName'),
      individualPoints: parseIntOrRefuse(where, 'individual points', at(row, 'individualPoints')),
      gender: at(row, 'gender'),
      type: at(row, 'type'),
      // Verbatim, defects included. The canonical form is derived by
      // `v_individual_result`; this table mirrors one list.
      categoryRaw: at(row, 'categoryRaw'),
    });
  }

  const publishedCount = checkRowCount(where, payload.list?.ListFooterText, rows.length);
  checkUniqueKey(
    where,
    'plates',
    rows.map((row) => row.plate),
  );

  return { variant, expressions: layout.dataFields, publishedCount, rows };
}
