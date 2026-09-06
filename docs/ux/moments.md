# Moments and job stories

Design context for the views. Not a spec — a spec covers one build, and this outlives all
of them. Every follow-on design session should start here, then read `CONTEXT.md` for the
vocabulary and `docs/adr/` for the decisions.

Produced by a coarse grilling sweep, 2026-09-05. Six questions, six decisions; the
decisions themselves live in `CONTEXT.md` and ADRs 0001-0002.

## The frame

Every view is a cell in a grid of **who** by **when**.

The _who_ axis is two trees, not one, joined at Scoring Team (ADR-0002):

```
League tree (theirs, read-only)      Club tree (ours, editable)
  league                               club
    conference                           squad
      scoring team  ←——— joined ———→  scoring team
        rider                              rider
```

The _when_ axis is two scales, with Season as the ambient frame rather than a filter:

|            | one round       | season to date           |
| ---------- | --------------- | ------------------------ |
| conference | field context   | standings, read verbatim |
| club       | the club's day  | the club's arc           |
| squad      | the squad's day | the squad's arc          |
| rider      | the ride        | progression              |

There is no across-seasons column. A Career axis was carried here until the coach-flow
session (2026-09-06) observed that no moment asks for one — M2 is season-shaped and so is
M6 — and that an axis with no job on it is where scope creep enters a roadmap. It comes
back when a coach asks for it.

Two rules fall out of the frame:

- **Move one axis at a time.** A screen offers a step sideways (who) or a step out (when).
  Nothing else. The single most important move in the app is the crossing from the club
  tree to the league tree — "my squad" to "versus the field" — and it is joined at Scoring
  Team. Scoring Team is where the two trees _join_ (ADR-0002); the coach-flow session named
  where the move actually _lands_, which is a Rider's **Category** at a Round, the peer set
  the league ranked her in. Not "Club → Conference", which was never a real move.
- **Round, not event, is the unit of time.** One Round can be two Events when the
  conferences race separately. Plot events and two riders land at different x-positions
  for the same race.

As of this writing the app implements exactly one cell — club by one round — with no
movement on either axis. That, not styling, is why it reads as a dead end.

## Moments

Seven moments. An analytic cycle, not a race-day clock.

| #       | Moment             | Trigger                                         | The question in a coach's head              |
| ------- | ------------------ | ----------------------------------------------- | ------------------------------------------- |
| **M0**  | Reconcile          | New plates arrive with an ingest                | "Who is this, and have I seen them before?" |
| **M1**  | Results land       | A race posts                                    | "What happened?"                            |
| **M2**  | Rider read         | A rider asks, or a coach preps the conversation | "Is this kid moving?"                       |
| **M3**  | Squad read         | Weekly, per squad coach                         | "How is my group?"                          |
| **M4a** | Field read — rider | A rider asks where she stood                    | "Where was I in my Category?"               |
| **M4b** | Field read — club  | After a good or a bad day                       | "Were we good, or was the field weak?"      |
| **M5**  | Season read        | Mid and late season                             | "Where is this season going?"               |
| **M6**  | Season close       | Season end, and the next pre-season             | "What did we do, and who is back?"          |

M1 is the spine and matches the map's done-condition. M2-M4 hang off it. M0 precedes all
of them and is the only moment where the coach writes; M5 and M6 have no representation in
the app at all today.

**M4 splits in two** (coach-flow session, 2026-09-06), because the two halves are answerable
on different instruments and should never share a ticket. **M4a** is the rider in her
Category — athlete-originated, reachable off a single cell, and the most-wanted view in the
app. **M4b** is the club set against another Conference, which Percent Back cannot honestly
answer: it is measured against your own Conference's Category winner through Round 4, so two
riders at 8% back are behind different people. The honest instrument is raw time on a shared
course, and both Conferences ride the same venue on the same day only at Race 1 and Race 5.
So M4b is late-season, coach-only, and answerable at two Rounds.

## Job stories

Form: _When [situation], I want [motivation], so I can [outcome]._

Story numbers are stable ids and are cited by number elsewhere, so the M4 split left 10
sitting above 9 rather than renumbering them.

### M0 — Reconcile

1. When a race brings in plates I do not recognise, I want to mark each as a new rider or
   an existing one, so the roster grows from what actually raced.
2. When a returning rider has this season's new plate, I want to attach it to the person I
   already have, so their earlier seasons stay theirs.

The roster is **discovered from results**, not entered up front. `v_unmapped_rider`
already finds the queue and the race page already warns about it; nothing yet acts on it.

### M1 — Results land

3. When a race posts, I want to see every rider of ours who started and how each finished,
   so I know what happened before anyone asks me.
4. When I open a fresh race, I want DNFs and non-finishers shown as a normal outcome
   beside finishers, so absence does not read as an error.
5. When a result has not been matched to our roster, I want to be told plainly, so I do
   not quietly under-count the club.

### M2 — Rider read

6. When a rider asks how they are doing, I want their season round by round on one
   measure, so I can say "you are moving" or "you are flat" with something on screen.
7. When a rider's goal is finishing rather than placing, I want their starts and finishes
   legible without place dominating, so the view serves them too.

### M3 — Squad read

8. When I run one squad, I want its riders framed together across a round and across the
   season, so I can see movement inside the group I actually coach.

### M4a — Field read, rider

10. When a rider asks where she stood, I want her Category at that Round with her row
    anchored in it and the field size stated, so the comparison she gets is the one the
    league actually ranked her in — and so it is obvious who is included and who is not,
    and a comparison that drops half a field reads as a filter rather than a bug.

### M4b — Field read, club

9. When we have a strong day, I want the club placed against its conference in that same
   round, so I can tell a strong club from a weak field. **Has no home in the chosen flow
   and is a named loss** — it wants a club-level crossing, which is a later surface rather
   than a notch on the scope control. Watch the source: the 2026 payload
   (`fixtures/2026/config-418436.json`) advertises three lists and no Team Results list,
   where 2025 carried two team lists plus a season overall. If that holds through the
   season, this story has nothing to read from.

### M5 — Season read

11. When the season is half over, I want the club's arc across rounds so far, so I can
    tell trending-up from flattening.
12. When league standings publish, I want the official totals shown in place, so I never
    recompute or defend a number the league owns.

### M6 — Season close

13. When a season ends, I want that season's roster and results retrievable whole, so a
    rider who has since graduated or transferred is still in the seasons they rode.
14. When a new season starts, I want last season as a baseline, so a returning rider's
    first race has context.

## Three states, everywhere

Percent Back is null for a DNF and for a lapped rider. A season trend built on it
therefore has holes by construction — and the rider most likely to have them is the
finish-focused rider, not the podium chaser. So a rider's mark is never
present-or-missing. It is one of three:

- **positioned** — has a Percent Back
- **started, no comparable position** — DNF or lapped
- **did not start** — no result row at all

The middle state narrowed on 2026-09-06: the Prologue is chip-timed with a real podium
and a comparable time, so it is not a hole at x=1 but the season's cleanest Percent Back
and the natural first point of every rider's arc. **Watch the cost.** With Percent Back
comparable at every Round, the cell of any grid _can_ carry magnitude instead of a mark.
The three-state mark was doing protective work for the finish-oriented half of the
roster; do not spend it just because the data now allows it.

The third is invisible in league data: a non-starter simply has no row. It is legible only
by crossing the season's Roster against the Rounds. That is the first job the club tree
does that the league tree cannot, and it is why Start count is a first-class season fact
(ADR-0001).

## Scope

| In                                                         | Out — belongs to Outspoke          |
| ---------------------------------------------------------- | ---------------------------------- |
| Results ingest and normalisation across rounds and seasons | Messaging                          |
| The two trees, and movement between them                   | Calendars, practice management     |
| Round, season and cross-season analytics                   | Volunteer coordination             |
| Published standings, read never computed                   | Race-day schedules, waves, staging |
| Rider identity, for attributing results                    | Family accounts                    |

This repo is the read model of record for what happened on course. Results flow out to
Outspoke; roster and scheduling never flow in as truth. `rider.id` is the shared key.

## Two orientations, both first-class

Riders hold genuinely different definitions of a good season. Some are **competitive** —
placing, podiums, moving up the field. Others are oriented to **participation and personal
achievement** — starting every round, finishing what they start, riding with their squad. A
pre-season athlete survey found both in roughly equal measure.

This cuts across everything else. It is not middle school versus high school, not category,
not squad: there are high schoolers whose season is finishing a lap and middle schoolers
chasing a podium. Orientation is orthogonal to every structural split in the data, which
means it can never be a filter or a segment. It has to be served by the shape of the views
themselves.

This is a design principle, not a demographic note. **A view that renders only place serves
half the roster.** It is why a rider's mark has three states rather than
present-or-missing, why Start count is a first-class season fact, and why Percent Back
(continuous, shows movement) sits beside published standings (discrete, shows rank) instead
of being replaced by them.

## Level is a separate axis, and a data trap

Independently of orientation, the league splits the field by **Level** — `High School` or
`Middle School` — and the sources treat the two differently. `team_race_counter.level` is
an explicit key; `team_race_result` is high-school only, nested under
`High School > Division N`; `season_individual_standing` covers both.

So a middle school rider can have an individual standing and no team result at all. Any
view that assumes team results exist for every rider will be empty for the younger half of
the club. That is a data-shape constraint, unrelated to what any of those riders wants out
of a season.

## Where the evidence came from

The audience shape — roughly 20 coaches across 6 squads in one club, tracking about 25
riders — is the map's, issue #1.

The orientation finding above comes from a pre-season athlete survey held outside this
repo. It is coaching-staff-only and concerns minors, so it is summarised as themes here
and not quoted. The same survey supports the map's decision to use squad cards as the
frame: squads are the club's real internal unit.

A separate critique of a printed race-day schedule was reviewed and found to be mostly
about logistics, which is Outspoke's scope, not this repo's. One thing crossed the
boundary: race-day call-ups are made on last season's results. That is logistics
_consuming_ results, and it is an argument for M6 holding a season whole — not a feature
here.
