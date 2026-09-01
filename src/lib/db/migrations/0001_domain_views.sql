-- Domain views. Nothing in the app reads a normalized table directly.
--
-- Every join, rollup, mapping, category normalization and derived metric lives
-- here, because a view is revisable with `create or replace` — no migration, no
-- re-ingest, and no possibility of confusing a decision with an ingested fact.
--
-- Written by hand rather than generated: Drizzle's view DSL is thinner than its
-- table DSL, and these carry logic worth reading as SQL.

--------------------------------------------------------------------------------
-- v_individual_result — the spine, with its sidecar and a canonical category
--
-- LEFT join, deliberately. `individual_result_by_team` is High-School-only and
-- misses two rows that exist in the flat list; an inner join would silently
-- drop published results. The flat list is the spine and loses nothing.
--------------------------------------------------------------------------------
create or replace view v_individual_result as
select
  ir.event_id,
  e.source_event_id,
  e.name                      as event_name,
  rd.season_id,
  rd.ordinal                  as round_ordinal,
  s.year                      as season_year,
  ir.plate,
  ir.display_name,
  ir.scoring_team,
  ir.category_raw,

  -- Canonical category. Normalize writes these columns; the fallback repairs the
  -- raw string in place so a view stays correct even against a partial ingest.
  -- Two stable spelling defects to absorb: "HS2 Boys- South" (no space before
  -- the dash) and "HS2 Girl - South" (singular), both present at every South
  -- event all season.
  coalesce(
    ir.category_level,
    regexp_replace(
      regexp_replace(btrim(ir.category_raw), '\s*-\s*(North|South)\s*$', ''),
      'Girl$', 'Girls'
    )
  )                           as category,

  -- Conference is per-row, not per-event: combined events carry it as a category
  -- suffix, and State Champs drops it entirely (null here, recoverable only from
  -- the team record — never from the contest string).
  coalesce(
    ir.conference,
    (regexp_match(ir.category_raw, '-\s*(North|South)\s*$'))[1],
    e.conference
  )                           as conference,

  ir.place,
  ir.status,
  ir.time_raw,
  ir.time_seconds,
  ir.points,

  -- Lap count is published at only 4 of 8 events, and is fully recoverable by
  -- counting non-empty splits. Verified to agree exactly where both exist.
  coalesce(
    ir.laps,
    (case when nullif(ir.lap1, '-') is not null then 1 else 0 end)
      + (case when nullif(ir.lap2, '-') is not null then 1 else 0 end)
      + (case when nullif(ir.lap3, '-') is not null then 1 else 0 end)
      + (case when nullif(ir.lap4, '-') is not null then 1 else 0 end)
  )                           as laps,

  ir.lap1, ir.lap2, ir.lap3, ir.lap4,
  ir.penalty,
  ir.pts_leader,

  -- From the sidecar. Null for every middle-school rider by construction, not
  -- by absence: `individual_result_by_team` has zero MS rows at all 8 events.
  bt.gender,
  bt.grade,
  bt.team_place,
  coalesce(bt.scored, false)  as scored,
  (bt.plate is null)          as by_team_missing

from individual_result ir
  join event e   on e.id = ir.event_id
  join round rd  on rd.id = e.round_id
  join season s  on s.id = rd.season_id
  left join individual_result_by_team bt
    on bt.event_id = ir.event_id and bt.plate = ir.plate;

--> statement-breakpoint
--------------------------------------------------------------------------------
-- v_race_result — the spine plus the derived comparison metrics
--
-- The one guard that must never be lost: percent back is computed ONLY among
-- riders who completed the same number of laps as the category's leaders. NICA
-- pulls lapped riders at the line and scores them with a valid TIME, so a naive
-- time / winner_time inverts the ordering — at 2025 Race 4 North it would rank
-- five 2-lap HS1 Boys ahead of the actual winner. Lapped riders get a null
-- pct_back and a laps_down count instead. Never render them as a percentage.
--------------------------------------------------------------------------------
create or replace view v_race_result as
with ranked as (
  select
    v.*,
    max(case when v.status <> 'dnf' then v.laps end)
      over (partition by v.event_id, v.category)            as category_laps,
    count(*)
      over (partition by v.event_id, v.category)            as field_size
  from v_individual_result v
),
winner as (
  select
    r.*,
    min(case when r.laps = r.category_laps and r.status <> 'dnf' then r.time_seconds end)
      over (partition by r.event_id, r.category)            as winner_seconds
  from ranked r
)
select
  w.*,
  (w.status <> 'dnf' and w.laps < w.category_laps)          as is_lapped,
  greatest(w.category_laps - w.laps, 0)                     as laps_down,

  -- Null unless the rider ran the full lap count. This is the guard.
  case
    when w.status = 'dnf' then null
    when w.laps < w.category_laps then null
    when w.winner_seconds is null or w.winner_seconds = 0 then null
    else round(((w.time_seconds / w.winner_seconds) - 1) * 100, 1)
  end                                                        as pct_back,

  -- Percentile is suppressed entirely below n=10. Six of sixteen categories
  -- routinely field under ten riders and Varsity Girls fielded ONE at Race 2
  -- North; "100th percentile" over n=1 is a lie that reads as an achievement.
  case
    when w.field_size >= 10 and w.place ~ '^\d+$'
      then round((w.place::numeric / w.field_size) * 100)
    else null
  end                                                        as field_top_pct
from winner w;

--> statement-breakpoint
--------------------------------------------------------------------------------
-- v_rider_result — identity resolved at query time, never materialized
--
-- (season, plate) alone is unsafe: in 2025 four riders changed plates mid-season
-- and seven plates were reissued to a second person. The bounds make it safe,
-- and resolving here rather than on the result row means a config edit in March
-- correctly re-labels February's races with no re-normalize.
--------------------------------------------------------------------------------
create or replace view v_rider_result as
select
  rp.rider_id,
  rd.display_name             as rider_name,
  v.*
from v_race_result v
  join rider_plate rp
    on rp.season_id = v.season_id
   and rp.plate = v.plate
   and (rp.from_round_ordinal is null or v.round_ordinal >= rp.from_round_ordinal)
   and (rp.to_round_ordinal   is null or v.round_ordinal <= rp.to_round_ordinal)
  join rider rd on rd.id = rp.rider_id;

--> statement-breakpoint
--------------------------------------------------------------------------------
-- v_club_result — the club rollup
--
-- Presentation only. A rider's scoring team stays the source string verbatim;
-- this view is the only place the union is asserted, and it reads config rather
-- than assuming a club maps 1:1 to a scoring team.
--------------------------------------------------------------------------------
create or replace view v_club_result as
select
  c.id                        as club_id,
  c.name                      as club_name,
  v.*
from v_race_result v
  join club_scoring_team cst
    on cst.season_id = v.season_id
   and cst.scoring_team = v.scoring_team
  join club c on c.id = cst.club_id;

--> statement-breakpoint
--------------------------------------------------------------------------------
-- v_unmapped_rider — the loud warning, as a live query against config
--
-- Any result row on one of the focus club's scoring teams that resolves to no
-- rider for that round. Because it reads config live it stays correct as the
-- mapping drifts, and it never guesses: no fuzzy name matching, ever.
--------------------------------------------------------------------------------
create or replace view v_unmapped_rider as
select
  cv.club_id,
  cv.club_name,
  cv.season_id,
  cv.season_year,
  cv.event_id,
  cv.round_ordinal,
  cv.plate,
  cv.display_name,
  cv.scoring_team,
  cv.category
from v_club_result cv
where not exists (
  select 1
  from rider_plate rp
  where rp.season_id = cv.season_id
    and rp.plate = cv.plate
    and (rp.from_round_ordinal is null or cv.round_ordinal >= rp.from_round_ordinal)
    and (rp.to_round_ordinal   is null or cv.round_ordinal <= rp.to_round_ordinal)
);
