# Race Results

An analytics environment for interscholastic mountain bike race results. It ingests what
the league published, normalizes it across races and seasons, and renders it for the
people who coach one club. It serves two populations at once — riders chasing places, and
riders whose season is measured in starts and finishes — and a view that speaks to only one
of them is incomplete. It is not a team-management tool and it is not a scoring engine.

## Language

### The two trees

The domain has two hierarchies, not one. They are joined at Scoring Team.

**League tree**:
The league's own structure, read from published results and never edited here.
League → Conference → Scoring Team → Rider.

**Club tree**:
Our overlay, owned by the coaches and edited here.
Club → Squad → Rider.

**Scoring Team**:
The peer string the league reports a rider under ("Salem Composite", "Sprague High
School Descenders"). The join between the two trees, and the only place they touch.
_Avoid_: Team — the word coaches use for Club.

**Conference**:
The league's geographic subdivision (North, South). A level of the league tree.
_Avoid_: Division, Region.

**Division**:
NICA's team-scoring bracket (`High School > Division N`), assigned by team size. An
attribute of a team's result at an event, sitting beside place and points. Not a level
of either tree.
_Avoid_: Conference.

**Category**:
The league's raced-and-ranked group: Level plus grade band plus gender, and — through
Round 4 — Conference ("HS2 Girls – North"). Published as one contest per Event; the
league's own fields are `CategoryRank` and the contest name. The peer set a Rider is
ranked in, and the denominator of Percent Back. **Conference-scoped at Rounds 1–4,
league-wide at State Champs**: the 2025 Prologue ran 28 contests carrying the conference
in the name, State Champs ran 14 without it.
_Avoid_: class, group, division.

**Club**:
The organization a coach runs. Spans one or more Scoring Teams, and which ones changes
per season. When a coach says "team", they mean this. **A Club belongs to exactly one
Conference per Season** — a league invariant, not a trait of this club — and every
Scoring Team it spans sits inside that Conference. So through Round 4 the far side of
the crossing is always the Club's own Conference, with no branch to handle.

**Squad**:
A coach-owned grouping of riders inside a Club, cutting across Scoring Teams.
Constituted per Season. Within a Season it is current-state only: a coach regroups at
will and we record where a Rider ended up, never the mid-season churn.

**Rider**:
A tracked person on the club roster. Everyone else in the results is a result row, not
a tracked person.

### The calendar

**Season**:
A racing year. The frame every view sits inside — not a filter, because Club membership
is season-keyed and a Club is a different set of Scoring Teams each year.

**Round**:
A race weekend in the league's own numbering (Race 1..5, State Champs last). The unit of
the time axis. Published as one Event per Conference — or as a single Event when the
whole league rides together, at the Prologue and at State Champs. The 2025 season was
five Rounds across eight Events.

**Event**:
A single published race at one venue. What the results are ingested from.
_Avoid_: Race when you mean Event — that is the ambiguity. "Race N" is the league's own
published label for a Round and is fine on screen.

### Outcomes

**Start**:
A Rider having a result row at a Round. Valuable in itself — the league gates State
Champs eligibility on starts, not placings. A non-start is the _absence_ of a row, so it
is visible only by crossing the Club roster against the Rounds.

**Level**:
`High School` or `Middle School`, the league's own split of the field. Load-bearing
because the sources treat the two differently: team results are high-school only, while
season individual standings cover both.

**Percent Back**:
How far behind the Category's winner a Rider finished, as a percentage. The form metric.
Null for a DNF and for a lapped rider. Measured within Category, so it is **not**
comparable across Conferences: through Round 4 two riders at 8% back are each 8% behind
a different person. The Prologue is not an exception — it is chip-timed with a real
podium and a comparable time, so Percent Back works there, and it is the cleanest
reading of the season.

**Season Points**:
The league's published season standing totals. The standing metric. Read verbatim,
never recomputed, and never plotted on the same axis as Percent Back.

### Roster

**Roster**:
Which Riders belonged to a Club in a given Season. Season-keyed, so a Rider who
graduated or transferred stays in the seasons they actually rode. A Squad is likewise
constituted per Season. A Rider may be on two Clubs' Rosters in one Season — that is a
mid-season transfer, and both Clubs need to read it.

**Prior Name**:
A name a Rider used in an earlier Season. Held for lookup and reconciliation only, and
never rendered. The name on screen is always the Rider's current one, in every Season.
_Avoid_: Alias, former name, persona.

**Unmapped Rider**:
A result row on one of the Club's Scoring Teams whose plate is not yet attached to a
Rider. The queue a coach drains to grow the Roster from what actually raced.

### Boundaries

**Description**:
Anything recomputable from the published rows that carries no consequence — Percent
Back, lapped, field size, Start count. Ours to derive.

**Adjudication**:
Anything the league decides and acts on — Season Points, season place, category
assignment, State Champs eligibility. Read verbatim or not shown. Never derived here.

**Outspoke**:
The separate team-management project — messaging, calendars, practice, volunteers.
Results flow out to it; roster and scheduling never flow in as truth. `rider.id` is the
shared key.
