-- Absent and zero are different facts about a lap count. (#48)
--
-- `v_individual_result` recovered a missing lap count by counting non-empty
-- splits, and the fallback was a sum of CASE expressions — so it produced `0`,
-- never `null`, for a list that publishes no lap columns at all. That is
-- precisely the time trial: every 2025 prologue rider got `laps = 0`, the
-- category maximum was also `0`, `laps = category_laps` held, the lapped branch
-- in `v_race_result` never fired, and 457 finishers were handed a percent-back
-- against a field where the concept has no meaning — up to 172.1%.
--
-- Two view replacements, no schema change and no re-ingest: `raw_fetch` and
-- `individual_result` are untouched, and both views keep their column names,
-- types and order so `create or replace` is legal with the dependent views in
-- place.

--------------------------------------------------------------------------------
-- v_individual_result — unchanged but for the lap-count fallback
--
-- (The rest of this view is 0001 verbatim. A view is replaced whole, so it is
-- restated here rather than patched; 0001 remains the place the joins and the
-- category repair are explained.)
--------------------------------------------------------------------------------
create or replace view v_individual_result as
with spine as (
  select
    ir.*,

    -- Does this event's list publish lap-split columns at all?
    --
    -- A column the list omits is null on every row of the event; a lap a rider
    -- did not complete is published as '-'. Only the event as a whole can tell
    -- those apart, so the question is asked once per event rather than per row.
    bool_or(
      ir.lap1 is not null or ir.lap2 is not null
        or ir.lap3 is not null or ir.lap4 is not null
    ) over (partition by ir.event_id)  as event_publishes_laps
  from individual_result ir
)
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

  -- Lap count is published at only 4 of 8 events. Where it is absent, counting
  -- non-empty splits recovers it for a mass-start race — verified to agree
  -- exactly where both exist — and cannot recover it for a time trial, which
  -- publishes no lap columns to count. A time trial's lap count is therefore
  -- unknown, not zero, and the fallback must not manufacture a number from an
  -- absence. Zero survives where it is real: a mass-start rider whose splits are
  -- all '-' completed no lap, and the event did publish the columns saying so.
  coalesce(
    ir.laps,
    case when ir.event_publishes_laps then
      (case when nullif(ir.lap1, '-') is not null then 1 else 0 end)
        + (case when nullif(ir.lap2, '-') is not null then 1 else 0 end)
        + (case when nullif(ir.lap3, '-') is not null then 1 else 0 end)
        + (case when nullif(ir.lap4, '-') is not null then 1 else 0 end)
    end
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

from spine ir
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
--
-- An unknown lap count now reaches this view as null instead of as a spurious
-- zero, so the guard is restated for it: unknown is not "ran the full distance",
-- and a row whose laps cannot be compared gets no percentage either.
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

  -- False, not null, where nobody's lap count is known. A time trial has no
  -- lapping — that is a fact about the format, not a gap in the data — and a
  -- null boolean reads as false down one render path and as a bug down the rest.
  -- `laps_down` stays null there, because a lap deficit is what is unknown.
  coalesce(w.status <> 'dnf' and w.laps < w.category_laps, false) as is_lapped,
  case
    -- Spelled out rather than left to `greatest`, which ignores its nulls and
    -- would answer "0 laps down" to a question nobody can answer.
    when w.laps is null or w.category_laps is null then null
    else greatest(w.category_laps - w.laps, 0)
  end                                                        as laps_down,

  -- Null unless the rider ran the full lap count. This is the guard.
  case
    when w.status = 'dnf' then null
    when w.laps is null or w.category_laps is null then null
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
