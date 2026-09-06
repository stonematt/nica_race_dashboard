/**
 * Database schema. Structure and rationale: issue #7.
 *
 * The organising principle: the source's numbers land in tables that mirror the
 * source; everything we decide is a view or a config table. NICA is the scoring
 * authority, so ingest is a fidelity problem — nothing is computed, corrected,
 * merged or rewritten on the way in.
 *
 * Three layers, and they never mix:
 *   raw        — append-only archive of every fetch, verbatim
 *   normalized — one table per source list family, decoded positionally
 *   config     — hand-maintained; normalize never writes here
 *
 * Domain views live in the migrations as raw `create or replace view`, because
 * that is where every decision belongs — revisable without a re-ingest.
 */

import { relations } from 'drizzle-orm';
import {
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/* ============================================================================
 * Calendar: season -> round -> event
 *
 * A flat event table does not survive the fixtures. 2025's Race 2 is two
 * RaceResult events (North and South); the 2026 opener is one event carrying
 * both conferences as a category suffix; State Champs is one event with no
 * suffix at all. Meanwhile the season standings list publishes RACE1..RACE4,
 * and those ordinals are league *rounds*, not event ids. `round.ordinal` is
 * the join that lets a rider's Race 3 season points sit next to their Race 3
 * lap times.
 * ========================================================================= */

export const season = pgTable(
  'season',
  {
    id: serial('id').primaryKey(),
    year: integer('year').notNull(),
  },
  (t) => [uniqueIndex('season_year_key').on(t.year)],
);

export const round = pgTable(
  'round',
  {
    id: serial('id').primaryKey(),
    seasonId: integer('season_id')
      .notNull()
      .references(() => season.id),
    /** 1..4 for conference races; State Champs continues the sequence. */
    ordinal: integer('ordinal').notNull(),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('round_season_ordinal_key').on(t.seasonId, t.ordinal)],
);

export const event = pgTable(
  'event',
  {
    id: serial('id').primaryKey(),
    roundId: integer('round_id')
      .notNull()
      .references(() => round.id),
    /** RaceResult's event id, e.g. "363499". Text, because it is an opaque key. */
    sourceEventId: text('source_event_id').notNull(),
    /**
     * Set for conference-specific events, null for combined ones. Where null,
     * conference is derived per row from the normalized category — or at State
     * Champs from the team record, never from the contest string, which drops
     * the suffix entirely.
     */
    conference: text('conference'),
    name: text('name').notNull(),
    date: date('date'),
  },
  (t) => [uniqueIndex('event_source_event_id_key').on(t.sourceEventId)],
);

/* ============================================================================
 * Raw layer — append-only, never mutated
 *
 * Every fetch appends, including no-ops: "we checked Sunday at 21:00 and
 * nothing had changed" is a fact worth keeping. At ~560 KB per season, ten
 * seasons is under 6 MB.
 *
 * There is deliberately no UPDATE or DELETE path anywhere in this codebase.
 * ========================================================================= */

export const rawFetch = pgTable(
  'raw_fetch',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
    season: integer('season').notNull(),
    /** Source event id as a string; raw does not depend on the calendar tables. */
    eventId: text('event_id').notNull(),
    /**
     * The config's stable hex list ID (F1A053, C6D0BA, ...), NOT the list name.
     * Event 357242 publishes the same list `Name` twice with different Mode, so
     * (event_id, list_name) is not unique. Null for a config fetch.
     */
    listId: text('list_id'),
    listName: text('list_name').notNull(),
    url: text('url').notNull(),
    httpStatus: integer('http_status').notNull(),
    payload: jsonb('payload').notNull(),
    /**
     * sha256 of the canonical payload. This is the entire correction-diff
     * mechanism: two rows for the same (event_id, list_id) with different
     * hashes is a correction. No extra machinery.
     */
    contentHash: text('content_hash').notNull(),
  },
  (t) => [index('raw_fetch_lookup_idx').on(t.eventId, t.listId, t.fetchedAt)],
);

/* ============================================================================
 * Normalized layer — one table per source list family
 *
 * Tables decode exactly one list, verbatim. Everything arrives from the payload
 * as a string ("9.0" for grade, "-" for an absent lap, "500" for points);
 * typed coercion is this layer's only permitted transformation.
 *
 * Decoding is positional, per event, per list, via
 * DataFields.indexOf(field.Expression) read from list.Fields[]. Never zip
 * Fields to DataFields — they are different lengths. Never cache a column
 * index across events; the layout drifts five ways within one season.
 * ========================================================================= */

/**
 * The spine: the flat per-race individual list. Every rider on every team, so
 * percent-back, percentile and club comparison all have the full field.
 */
export const individualResult = pgTable(
  'individual_result',
  {
    eventId: integer('event_id')
      .notNull()
      .references(() => event.id),
    /** The plate (payload `BIB`). The rider handle — never `ID`, which is a
     *  per-event row key that collides across 468 values in one season. */
    plate: text('plate').notNull(),
    /** Payload `ID`, kept for provenance only. Never join on this. */
    sourceRowId: text('source_row_id'),
    displayName: text('display_name').notNull(),
    /**
     * The payload's `CLUB` expression, verbatim.
     *
     * NAMING TRAP, and it is load-bearing: the source's `CLUB` is our
     * `scoring_team` — the NICA-reported peer string ("Salem Composite",
     * "Sprague High School Descenders"). It is NEVER our `club`, which is the
     * parent organisation a coach runs and appears only in config tables. This
     * is the one place the two vocabularies touch.
     */
    scoringTeam: text('scoring_team').notNull(),
    /** The category string exactly as published, spelling defects included
     *  ("HS2 Boys- South", "HS2 Girl - South"). Never key on this. */
    categoryRaw: text('category_raw').notNull(),
    /**
     * The whole canonical category ("HS2 Girls"), not a level token —
     * `v_individual_result` coalesces this column as the canonical `category`
     * every other view reads. Writing a bare level here ("HS2") would
     * collapse HS1/HS2/HS3 into one bucket everywhere that category is used.
     */
    categoryLevel: text('category_level'),
    /** Grade band and gender, normalized. Key on these plus categoryLevel. */
    categoryGradeBand: text('category_grade_band'),
    categoryGender: text('category_gender'),
    /** North | South, split out of the raw category's suffix ("HS2 Boys-
     *  South"). Null where the category carries no conference. */
    conference: text('conference'),
    /** Place as published: an integer, or "*" for a DNF. Verbatim. */
    place: text('place').notNull(),
    /**
     * finished | dnf — the only values ingest ever writes. No DQ, no DNS —
     * zero of each in a full season. Lapped-ness is not a value of this
     * column: it needs the category's leading lap count, which no single row
     * carries, so `v_race_result` derives it as a separate `is_lapped`
     * boolean rather than a third status here.
     */
    status: text('status').notNull(),
    /** "[H:]MM:SS.cc", or "DNF". Verbatim. */
    timeRaw: text('time_raw').notNull(),
    timeSeconds: numeric('time_seconds'),
    points: integer('points'),
    /** Present at only 4 of 8 events; recoverable by counting lap splits. */
    laps: integer('laps'),
    lap1: text('lap1'),
    lap2: text('lap2'),
    lap3: text('lap3'),
    lap4: text('lap4'),
    /** Added into TIME by the source, and not inside any lap split. */
    penalty: text('penalty'),
    ptsLeader: boolean('pts_leader').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.eventId, t.plate] }),
    index('individual_result_scoring_team_idx').on(t.scoringTeam),
    index('individual_result_category_idx').on(t.eventId, t.categoryRaw),
  ],
);

/**
 * The attribute sidecar. HIGH SCHOOL ONLY at all 8 events — every one of the
 * 1,338 rows nests under a single `High School` node — so gender, grade, team
 * place and the scored flag are unavailable for every middle-school rider.
 *
 * Kept as its own table rather than merged into the spine: the join is 1,336
 * of 1,338 (two orphans with nowhere to live in a merged row), it would null
 * out half the corpus by construction, and the fidelity test needs a table
 * that maps to exactly one list.
 */
export const individualResultByTeam = pgTable(
  'individual_result_by_team',
  {
    eventId: integer('event_id')
      .notNull()
      .references(() => event.id),
    plate: text('plate').notNull(),
    sourceRowId: text('source_row_id'),
    displayName: text('display_name').notNull(),
    /** The team's division placing at this event. */
    teamPlace: text('team_place'),
    place: text('place'),
    categoryRaw: text('category_raw'),
    /** "M" or "F" — no other value appears in 1,338 rows. */
    gender: text('gender'),
    /** Format drifts: "9.0" at some events, "9" at others; 6 rows blank. */
    grade: text('grade'),
    points: integer('points'),
    lap1: text('lap1'),
    lap2: text('lap2'),
    lap3: text('lap3'),
    lap4: text('lap4'),
    lap5: text('lap5'),
    penalty: text('penalty'),
    timeRaw: text('time_raw'),
    /** The source's `B;` flag: this rider counted toward the team score. */
    scored: boolean('scored').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.plate] })],
);

/** `Team Results` — HS-only, nested High School > Division N. */
export const teamRaceResult = pgTable(
  'team_race_result',
  {
    eventId: integer('event_id')
      .notNull()
      .references(() => event.id),
    scoringTeam: text('scoring_team').notNull(),
    division: text('division'),
    place: text('place'),
    penaltyPoints: integer('penalty_points'),
    points: integer('points'),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.scoringTeam] })],
);

/**
 * `Team Results - Detailed` — the only source that carries middle-school team
 * scoring. The team node is a packed string split on `///`:
 *   "1.///Portland Metro Composite///3834 Points /// Penalty Points: 0"
 */
export const teamRaceCounter = pgTable(
  'team_race_counter',
  {
    eventId: integer('event_id')
      .notNull()
      .references(() => event.id),
    plate: text('plate').notNull(),
    /** "High School" or "Middle School" — the depth-1 group key. */
    level: text('level'),
    division: text('division'),
    scoringTeam: text('scoring_team').notNull(),
    teamPlace: text('team_place'),
    teamPoints: integer('team_points'),
    teamPenaltyPoints: integer('team_penalty_points'),
    displayName: text('display_name'),
    individualPoints: integer('individual_points'),
    gender: text('gender'),
    /** "Boys" | "Girls" | "Open". */
    type: text('type'),
    categoryRaw: text('category_raw'),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.plate] })],
);

/**
 * `Individual Results - Overall` — the league's own season standings, per
 * conference, middle school included. Read verbatim; never recomputed. A naive
 * sum is wrong: the series is best 3 of 4 plus a 25-point attendance bonus,
 * and mid-season upgrades forfeit individual points.
 *
 * Read the Race 4 events for the final record — earlier events publish
 * season-to-date snapshots and State Champs' copy is degenerate.
 */
export const seasonIndividualStanding = pgTable(
  'season_individual_standing',
  {
    id: serial('id').primaryKey(),
    seasonId: integer('season_id')
      .notNull()
      .references(() => season.id),
    conference: text('conference'),
    plate: text('plate').notNull(),
    displayName: text('display_name').notNull(),
    scoringTeam: text('scoring_team'),
    categoryRaw: text('category_raw'),
    seasonPlace: text('season_place'),
    /** The published drop rule, verbatim: "3/4". */
    bestOf: text('best_of'),
    /** Never repair a missing LOW SCORE by inferring min() — 363500 omits it. */
    lowScore: integer('low_score'),
    bonusTotal: integer('bonus_total'),
    final: integer('final'),
    /** Which event's copy of the standings this row came from. */
    sourceEventId: text('source_event_id').notNull(),
  },
  (t) => [uniqueIndex('season_standing_key').on(t.seasonId, t.conference, t.plate)],
);

/**
 * Per-race season points, LONG not wide. The source publishes RACE1..RACE10 and
 * the layout drifts five ways across 8 events (DataFields lengths 12/31/31/31/
 * 31/18/16/19; `#FIN` appears then vanishes). A long table absorbs all of it,
 * and gives the literal `Upgrade` sentinel and the red drop-marker an honest home.
 */
export const seasonIndividualRacePoints = pgTable(
  'season_individual_race_points',
  {
    standingId: integer('standing_id')
      .notNull()
      .references(() => seasonIndividualStanding.id, { onDelete: 'cascade' }),
    /** Joins to round.ordinal — the league's own race numbering. */
    roundOrdinal: integer('round_ordinal').notNull(),
    /** Verbatim: an integer, "0" for an absence, or the "Upgrade" sentinel. */
    points: text('points'),
    /** From the source's LowScoreFormatting hint: this is the dropped race. */
    isDropped: boolean('is_dropped').notNull().default(false),
    isUpgrade: boolean('is_upgrade').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.standingId, t.roundOrdinal] })],
);

/**
 * `Team Results - Overall` — HS-only. SEASON = R2 + R3 + R4 with no drop; the
 * Prologue does not count toward team season points. Per-race scores stay as
 * published jsonb because the column set shifts with the season's shape.
 */
export const seasonTeamStanding = pgTable(
  'season_team_standing',
  {
    seasonId: integer('season_id')
      .notNull()
      .references(() => season.id),
    conference: text('conference'),
    scoringTeam: text('scoring_team').notNull(),
    division: text('division'),
    place: text('place'),
    /** { "2": 3834, "3": 3901, "4": 3777 } keyed by round ordinal. */
    racePoints: jsonb('race_points'),
    seasonTotal: integer('season_total'),
    sourceEventId: text('source_event_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.seasonId, t.conference, t.scoringTeam] })],
);

/* ============================================================================
 * Config layer — hand-maintained. Normalize never writes here.
 * ========================================================================= */

/** The organisation a coach runs, e.g. Salem Composite Descenders. Ours. */
export const club = pgTable(
  'club',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('club_name_key').on(t.name)],
);

/**
 * club -> scoring_team, one-to-many and SEASON-KEYED. The Descenders are three
 * strings; the composite-subdivision rule (5+ riders from one school forces a
 * split the next year) makes the strings unstable across seasons.
 *
 * Validate on ingest against the season's observed scoring-team set, so a
 * league rename fails loudly instead of silently dropping a team.
 */
export const clubScoringTeam = pgTable(
  'club_scoring_team',
  {
    clubId: integer('club_id')
      .notNull()
      .references(() => club.id, { onDelete: 'cascade' }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => season.id),
    scoringTeam: text('scoring_team').notNull(),
  },
  (t) => [primaryKey({ columns: [t.clubId, t.seasonId, t.scoringTeam] })],
);

/**
 * The roster. Stands alone and requires no result: a coaching structure
 * includes kids who practise, join late, get injured in week one, or ride
 * without racing. If a rider row could only exist where a result exists, the
 * roster could not show them and a coach could not squad them.
 */
export const rider = pgTable('rider', {
  id: serial('id').primaryKey(),
  displayName: text('display_name').notNull(),
  notes: text('notes'),
});

/**
 * The season-keyed club roster: which riders were this club's in a given year.
 * The parallel to `club_scoring_team`, on the other side of the join — that one
 * season-keys the league's name for us, this one season-keys who we were.
 *
 * Membership has to carry a season or a club has no history. Resolved through
 * `squad_member` alone it would be current-state only, so "how did we do in
 * 2022" would answer with today's roster: a rider who has since graduated
 * vanishes from their own seasons, and a rider who joined this year appears in
 * races they never rode.
 *
 * Two reads off one table, and a transfer needs both. The club a rider left
 * reads by (club, season) and still sees them in the years they rode; the club
 * they joined reads by rider and gets their whole career. So a rider may hold
 * rows for two clubs in one season — a mid-season transfer is exactly that —
 * and the key deliberately permits it.
 *
 * Also the only way a non-start is countable. A missed round is the *absence*
 * of a result row, not a value in one, so it is legible solely by crossing this
 * roster against the season's rounds (ADR-0001, `docs/ux/moments.md`).
 *
 * Stands alone and requires no result, for the same reason `rider` does: a
 * roster includes kids who practise, join late, or get injured in week one.
 * Deliberately not derived from `squad_member` — squadding is a coaching lens
 * over the roster, and a rider can be on the roster and in no squad.
 *
 * No mid-season bounds, unlike `rider_plate`. That table needed them because
 * the source data forced them; here the season is the grain we chose (#81).
 *
 * Nothing writes this table yet — the coach's reconcile action is #79 and the
 * reads that need it are #82 and #18. It lands ahead of them because every
 * cross-season club number is silently wrong without it.
 */
export const clubMember = pgTable(
  'club_member',
  {
    clubId: integer('club_id')
      .notNull()
      .references(() => club.id, { onDelete: 'cascade' }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => season.id),
    riderId: integer('rider_id')
      .notNull()
      .references(() => rider.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.clubId, t.seasonId, t.riderId] }),
    /** The by-rider read: a rider's club history, including across a transfer. */
    index('club_member_rider_idx').on(t.riderId),
  ],
);

/**
 * Rider identity, with race bounds. (season, plate) alone is unsafe: in 2025,
 * 4 riders changed plates mid-season (splitting one person in two) and 7 plates
 * were reissued to a second person (merging two people into one).
 *
 * The fact that rescues it: reissues are always disjoint in time — a plate
 * never belongs to two people at the same event. So the common case is one row
 * with both bounds NULL, a plate change is two bounded rows under one rider,
 * and a reissue is two bounded rows for one plate under different riders.
 *
 * Deliberately NOT materialised onto result rows. The mapping is config that
 * changes after ingest — you add a rider in March and want February's races to
 * reflect it. A materialised FK would make every config edit require a
 * re-normalize, and a stale FK is indistinguishable from a correct one.
 */
export const riderPlate = pgTable(
  'rider_plate',
  {
    id: serial('id').primaryKey(),
    riderId: integer('rider_id')
      .notNull()
      .references(() => rider.id, { onDelete: 'cascade' }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => season.id),
    plate: text('plate').notNull(),
    /** Null bounds mean "the whole season", which is the common case. */
    fromRoundOrdinal: integer('from_round_ordinal'),
    toRoundOrdinal: integer('to_round_ordinal'),
  },
  (t) => [index('rider_plate_lookup_idx').on(t.seasonId, t.plate)],
);

/**
 * A coach profile keyed to next-auth's user. The adapter owns user/account/
 * session/verificationToken — leave those alone or an adapter upgrade will
 * fight you. The email allowlist is enforced in src/auth.ts, not here.
 */
export const coach = pgTable('coach', {
  userId: text('user_id').primaryKey(),
  clubId: integer('club_id')
    .notNull()
    .references(() => club.id),
  displayName: text('display_name').notNull(),
});

/**
 * A squad is constituted for a season. "JV" in 2025 and "JV" in 2026 are two
 * squads that share a name, not one squad with a history — which is why the
 * who/when matrix gives squad no across-seasons cell at all
 * (`docs/ux/moments.md`).
 *
 * This does not walk back the map's standing decision that squads carry no
 * history. That decision is about the mid-season shuffle: a coach regroups at
 * will and we record where a rider ended up, never the churn. What is
 * season-keyed is the squad itself (#81).
 */
export const squad = pgTable(
  'squad',
  {
    id: serial('id').primaryKey(),
    clubId: integer('club_id')
      .notNull()
      .references(() => club.id, { onDelete: 'cascade' }),
    seasonId: integer('season_id')
      .notNull()
      .references(() => season.id),
    name: text('name').notNull(),
  },
  (t) => [uniqueIndex('squad_club_season_name_key').on(t.clubId, t.seasonId, t.name)],
);

/** ~20 coaches across ~6 squads is roughly three apiece. Many-to-many. */
export const squadCoach = pgTable(
  'squad_coach',
  {
    squadId: integer('squad_id')
      .notNull()
      .references(() => squad.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.squadId, t.userId] })],
);

/**
 * Deliberately still a bare pair: the season is `squad.season_id`, so a
 * membership row is already season-scoped through its squad and a column here
 * would only restate it.
 *
 * Within a season this is current state only — no validity range, per the map's
 * standing decision that a squad's mid-season shuffle carries no history.
 * Unlike rider_plate, which needs bounds because the source data forced them.
 *
 * Not constrained to `club_member` in the database. "You may only squad a rider
 * on that season's roster" needs the season restated here to be a foreign key,
 * and a redundant column buys nothing else.
 *
 * What stands in for it today is narrower than that, and worth saying plainly
 * rather than leaving a reader to assume the rule is enforced somewhere. On the
 * seeded path, `parseSquads` checks a squad's members against the rider list in
 * the same config file — not against `club_member`, which nothing writes yet.
 * So the rule holds for config-seeded data and nowhere else. Whoever builds the
 * write surface (#79) owns making it hold there too.
 */
export const squadMember = pgTable(
  'squad_member',
  {
    squadId: integer('squad_id')
      .notNull()
      .references(() => squad.id, { onDelete: 'cascade' }),
    riderId: integer('rider_id')
      .notNull()
      .references(() => rider.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.squadId, t.riderId] })],
);

/* ============================================================================
 * next-auth tables, owned by @auth/drizzle-adapter.
 * Shapes must match what the adapter expects. Do not add columns here; put
 * coach profile data on `coach` above.
 * ========================================================================= */

export const users = pgTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').notNull(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
});

export const accounts = pgTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
});

export const verificationTokens = pgTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/* ============================================================================
 * Relations
 * ========================================================================= */

export const seasonRelations = relations(season, ({ many }) => ({
  rounds: many(round),
}));

export const roundRelations = relations(round, ({ one, many }) => ({
  season: one(season, { fields: [round.seasonId], references: [season.id] }),
  events: many(event),
}));

export const eventRelations = relations(event, ({ one, many }) => ({
  round: one(round, { fields: [event.roundId], references: [round.id] }),
  individualResults: many(individualResult),
}));

export const individualResultRelations = relations(individualResult, ({ one }) => ({
  event: one(event, { fields: [individualResult.eventId], references: [event.id] }),
}));

export const clubRelations = relations(club, ({ many }) => ({
  scoringTeams: many(clubScoringTeam),
  squads: many(squad),
  members: many(clubMember),
}));

export const riderRelations = relations(rider, ({ many }) => ({
  plates: many(riderPlate),
  squadMemberships: many(squadMember),
  clubSeasons: many(clubMember),
}));
