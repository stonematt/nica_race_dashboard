/**
 * Everything the race-detail page reads, and the one place it reads it.
 *
 * **The page reads views, never a normalized result table** (issue #1). Three
 * of them:
 *
 *   - `v_race_result` — the whole field of the event, which is what a strip is
 *     drawn against. It carries the derived comparisons already computed:
 *     percent back, the lapped flag, the lap deficit, the field percentile.
 *   - `v_rider_result` — the same rows with identity resolved, which is how a
 *     plate becomes one of the club's riders. Resolution happens at query time
 *     and inside the plate's race bounds, so a config edit in March re-labels
 *     February with no re-normalize.
 *   - `v_unmapped_rider` — the loud warning, live against config.
 *
 * The config tables (`club`, `squad`, `squad_member`, `coach`) are read
 * directly, because they are hand-maintained facts about the club rather than
 * ingested results. That is the split the schema exists to keep (issue #7).
 *
 * Nothing here computes a score, a place or a rank. NICA is the scoring
 * authority; this module fetches what was published and hands it on.
 */

import { sql } from 'drizzle-orm';
import { parseTimeSeconds } from '../../../lib/ingest/decode.ts';
import {
  buildSquadCard,
  fieldsByCategory,
  type RaceResultRow,
  type SquadCard,
  type UnmappedRider,
} from '../../../components/race-detail.ts';
import type { Database } from '../../../lib/db/index.ts';

/*
 * Imports here are relative, not `@/`-aliased. The alias is a tsconfig path
 * that Next resolves and vitest does not — the test configs register no
 * resolver for it — so an aliased import in a module a test loads fails at
 * collection. `src/auth.ts` is relative for the same reason. The page files,
 * which no test loads, keep the alias the rest of `src/app` uses.
 */

/**
 * Any database this module can read: the app's, or a test's in-memory one.
 *
 * Narrowed to `execute` on purpose. It keeps the test seam structural rather
 * than importing `db/testing.ts` — which would pull the migrator, and the
 * migration folder it reads, into the app bundle.
 */
export type AnyDatabase = Pick<Database, 'execute'>;

export type RaceHeader = {
  eventId: number;
  sourceEventId: string;
  name: string;
  seasonYear: number;
  roundOrdinal: number;
};

export type RaceDetail = {
  race: RaceHeader;
  club: { id: number; name: string } | null;
  squads: SquadCard[];
  unmapped: UnmappedRider[];
  /** Starters at the event, across every category. For the page's own summary. */
  starters: number;
};

type Row = Record<string, unknown>;

const str = (v: unknown): string => String(v ?? '');
const num = (v: unknown): number => Number(v);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * The published splits, in order, dropping the ones the list left empty.
 *
 * `-` is the source's own "no lap here"; a null column is a lap the list never
 * published. Both mean there is no bar to draw, and neither is a zero.
 */
function splits(row: Row): { lapSplits: string[]; lapSeconds: number[] } {
  const published = (['lap1', 'lap2', 'lap3', 'lap4'] as const)
    .map((key) => row[key])
    .filter((v): v is string => typeof v === 'string' && v !== '-' && v.trim() !== '');

  return {
    lapSplits: published,
    lapSeconds: published.map((raw) => parseTimeSeconds(raw) ?? 0),
  };
}

function toResultRow(row: Row): RaceResultRow {
  return {
    plate: str(row.plate),
    displayName: str(row.display_name),
    category: str(row.category),
    place: str(row.place),
    status: row.status === 'dnf' ? 'dnf' : 'finished',
    timeRaw: str(row.time_raw),
    points: numOrNull(row.points),
    isLapped: row.is_lapped === true,
    lapsDown: numOrNull(row.laps_down),
    pctBack: numOrNull(row.pct_back),
    fieldSize: num(row.field_size),
    fieldTopPct: numOrNull(row.field_top_pct),
    scored: row.scored === true,
    ptsLeader: row.pts_leader === true,
    grade: numOrNull(row.grade),
    ...splits(row),
  };
}

/** The races there are to open, newest first. */
export async function listRaces(db: AnyDatabase): Promise<RaceHeader[]> {
  const result = await db.execute(sql`
    select distinct event_id, source_event_id, event_name, season_year, round_ordinal
      from v_race_result
     order by season_year desc, round_ordinal desc, source_event_id desc`);

  return (result.rows as Row[]).map((row) => ({
    eventId: num(row.event_id),
    sourceEventId: str(row.source_event_id),
    name: str(row.event_name),
    seasonYear: num(row.season_year),
    roundOrdinal: num(row.round_ordinal),
  }));
}

/**
 * The club this coach belongs to.
 *
 * Falls back to the only club when the signed-in user has no coach profile.
 * The development sign-in shim admits any address without creating one, so
 * without the fallback every locally-signed-in coach would see an empty page
 * and no reason why. With more than one club and no profile, there is nothing
 * honest to guess, so it returns null and the page says so.
 */
export async function resolveClub(
  db: AnyDatabase,
  userId: string | null,
): Promise<{ id: number; name: string } | null> {
  if (userId !== null) {
    const owned = await db.execute(sql`
      select c.id, c.name from coach co join club c on c.id = co.club_id
       where co.user_id = ${userId} limit 1`);
    const row = (owned.rows as Row[])[0];
    if (row) return { id: num(row.id), name: str(row.name) };
  }

  const only = await db.execute(sql`select id, name from club order by id limit 2`);
  const rows = only.rows as Row[];
  return rows.length === 1 ? { id: num(rows[0]!.id), name: str(rows[0]!.name) } : null;
}

/**
 * The squads to show.
 *
 * A coach's own squads, from `squad_coach` — or every squad in the club when
 * that link is empty. Nothing seeds `squad_coach` yet, so a hard filter would
 * render an empty page for every real user today. Named here rather than left
 * implicit: when the roster surface lands and coaches are linked to squads,
 * this fallback becomes the wrong answer and should go.
 */
async function squadNames(
  db: AnyDatabase,
  clubId: number,
  userId: string | null,
): Promise<{ id: number; name: string }[]> {
  if (userId !== null) {
    const mine = await db.execute(sql`
      select s.id, s.name from squad s
        join squad_coach sc on sc.squad_id = s.id
       where sc.user_id = ${userId} and s.club_id = ${clubId}
       order by s.name`);
    const rows = mine.rows as Row[];
    if (rows.length > 0) return rows.map((row) => ({ id: num(row.id), name: str(row.name) }));
  }

  const all = await db.execute(sql`
    select id, name from squad where club_id = ${clubId} order by name`);
  return (all.rows as Row[]).map((row) => ({ id: num(row.id), name: str(row.name) }));
}

/** One race, assembled: the field, the squads drawn against it, the warning. */
export async function loadRaceDetail(
  db: AnyDatabase,
  sourceEventId: string,
  userId: string | null,
): Promise<RaceDetail | null> {
  const fieldResult = await db.execute(sql`
    select * from v_race_result where source_event_id = ${sourceEventId}`);
  const fieldRows = fieldResult.rows as Row[];
  if (fieldRows.length === 0) return null;

  const first = fieldRows[0]!;
  const race: RaceHeader = {
    eventId: num(first.event_id),
    sourceEventId: str(first.source_event_id),
    name: str(first.event_name),
    seasonYear: num(first.season_year),
    roundOrdinal: num(first.round_ordinal),
  };

  const byCategory = fieldsByCategory(fieldRows.map(toResultRow));
  const club = await resolveClub(db, userId);
  if (club === null) {
    return { race, club: null, squads: [], unmapped: [], starters: fieldRows.length };
  }

  const squads = await squadNames(db, club.id, userId);

  // Identity resolved by the view, inside the plate's race bounds. A rider who
  // changed plates mid-season stays one person; a reissued plate stays two.
  const memberResult = await db.execute(sql`
    select sm.squad_id, rr.rider_name, rr.*
      from v_rider_result rr
      join squad_member sm on sm.rider_id = rr.rider_id
      join squad s on s.id = sm.squad_id
     where rr.event_id = ${race.eventId} and s.club_id = ${club.id}`);

  const bySquad = new Map<number, { row: RaceResultRow; name: string }[]>();
  for (const row of memberResult.rows as Row[]) {
    const squadId = num(row.squad_id);
    const entry = { row: toResultRow(row), name: str(row.rider_name) };
    const existing = bySquad.get(squadId);
    if (existing) existing.push(entry);
    else bySquad.set(squadId, [entry]);
  }

  const unmappedResult = await db.execute(sql`
    select plate, display_name, scoring_team from v_unmapped_rider
     where event_id = ${race.eventId} and club_id = ${club.id}
     order by plate`);

  return {
    race,
    club,
    squads: squads.map((squad) =>
      buildSquadCard(squad.name, bySquad.get(squad.id) ?? [], byCategory),
    ),
    unmapped: (unmappedResult.rows as Row[]).map((row) => ({
      plate: str(row.plate),
      name: str(row.display_name),
      scoringTeam: str(row.scoring_team),
    })),
    starters: fieldRows.length,
  };
}
