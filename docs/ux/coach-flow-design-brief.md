<!--
A brief written to be handed whole to an external design session (Claude Design or
similar). It is self-contained on purpose — it restates vocabulary and constraints that
live in CONTEXT.md, docs/adr/ and docs/ux/moments.md so that a reader with no repo
access can work from it alone. Those files remain authoritative; if they and this brief
disagree, they win and this brief is stale.

Tracks issue #80 (storyboard the coach flow, settle the navigation model).
-->

# Design session: the coach flow for a race-results analytics app

I want to work with you interactively on **flow and storyboard** — the route a person
takes through this product, and what each screen is for. Not visual polish, not code.

Treat this as roadmap work. **I do not care what is currently built.** Assume nothing
exists. If the right answer needs a surface that has never been discussed, propose it.
I am trying to find the shape of the whole product so I can sequence building it.

---

## What the product is

A web app for the coaching staff of one interscholastic (high school + middle school)
mountain bike club — the Salem Composite Descenders, in the Oregon league. Roughly 25
tracked riders across ~6 squads, ~20 coaches.

The league publishes race results. We ingest them, normalize them across races and
seasons, and render them for the people who coach. **We are not a scoring engine and not
a team-management tool.** The league's numbers are read verbatim; we describe, we never
adjudicate.

Done looks like: a race posts on a Sunday night, and a coach opens the app to see how
their riders did.

---

## The three people (this is the part I most want you to work with)

**1. Head Coach — the one who does the work nobody sees.**
Loads the race results. Does intake. Does at least a lightweight pass on ingestion to
make sure we captured every rider in our club. May or may not push all the way down to
sorting every rider into their squad. This is the only person who *writes* anything.
Their moment arrives on an ingest, not on a navigation — a job lands in their lap.

**2. Squad Leader — the one who owns a group.**
Reviews and validates their squad's participation. If something is missing or
outstanding for their riders, they should have the tools to fix it themselves rather
than escalating to the head coach. Thinks about squad performance. Has conversations
with individual riders about how they're going.

**3. Assistant Coach — the one who mostly reads.**
Logs in, looks at results, helps with whatever discussion is happening around the
athletes. Low ceremony, low commitment. Should get value in ten seconds.

**All three** want: league standings, performance by race and by season, and — this one
matters — to see *their own riders compared against the broader population outside the
club*. A rider is not just a rank inside our roster; they are a position in a field of
hundreds.

Open questions I'd like you to push on:
- Are these three roles, three modes, or three depths of the same screens?
- Does the head coach's intake work get *shared* — can it be handed down to squad
  leaders as a queue, so the person closest to the riders does the recognizing?
- The word "discussion" keeps coming up in how I describe two of these people. I don't
  know what that means as a surface. Notes on a rider? A per-race thread? Something a
  coach brings up on a screen and never types? Push on it. (Constraint: general
  messaging/calendars/practice/volunteers belong to a separate product called Outspoke.
  This one is analytics. But "the thing a coach writes down about a rider's progress"
  may be squarely ours, and I'd like the session to figure out which.)

---

## The seven moments already identified

These are the situations, in the coach's own head. Which persona owns which is
deliberately not settled.

| # | Moment | Trigger | Question in their head |
|---|---|---|---|
| M0 | Reconcile | New plates arrive with an ingest | "Who is this, and have I seen them before?" |
| M1 | Results land | A race posts | "What happened?" |
| M2 | Rider read | A rider asks, or coach preps the conversation | "Is this kid moving?" |
| M3 | Squad read | Weekly, per squad coach | "How is my group?" |
| M4 | Field read | After a good or a bad day | "Were we good, or was the field weak?" |
| M5 | Season read | Mid and late season | "Where is this season going?" |
| M6 | Season close | Season end, and next pre-season | "What did we do, and who is back?" |

M1 is the spine. M0 is the only write. M5 and M6 have no representation at all today and
M6 has never even been ticketed.

### The job stories under them

- **M0** — When a race brings in plates I do not recognise, mark each as a new rider or
  an existing one, so the roster grows from what actually raced. When a returning rider
  has this season's new plate, attach it to the person I already have, so their earlier
  seasons stay theirs.
- **M1** — When a race posts, see every rider of ours who started and how each finished,
  before anyone asks me. DNFs and non-finishers shown as a normal outcome beside
  finishers, so absence does not read as an error. When a result has not been matched to
  our roster, be told plainly, so I do not quietly under-count the club.
- **M2** — When a rider asks how they are doing, their season round by round on one
  measure, so I can say "you are moving" or "you are flat" with something on screen.
  When a rider's goal is finishing rather than placing, their starts and finishes
  legible without place dominating.
- **M3** — When I run one squad, its riders framed together across a round and across
  the season, so I can see movement inside the group I actually coach.
- **M4** — On a strong day, the club placed against its conference in that same round,
  so I can tell a strong club from a weak field. When comparing clubs, make it obvious
  who is included and who is not, so a comparison that drops half a roster reads as a
  filter rather than a bug.
- **M5** — Half the season in, the club's arc across rounds so far, so I can tell
  trending-up from flattening. When league standings publish, the official totals shown
  in place, so I never recompute or defend a number the league owns.
- **M6** — When a season ends, that season's roster and results retrievable whole, so a
  rider who graduated or transferred is still in the seasons they rode. When a new
  season starts, last season as a baseline, so a returning rider's first race has
  context.

---

## Structural facts that shape any flow

**The domain has two hierarchies, not one.** They touch at exactly one point.

- **League tree** (theirs, read-only, published): League → Conference → Scoring Team → Rider
- **Club tree** (ours, editable by coaches): Club → Squad → Rider
- They join at **Scoring Team** — the peer string the league reports a rider under
  ("Salem Composite", "Sprague High School Descenders"). A Club spans one or more
  Scoring Teams, and *which ones changes every season*.

**Crossing from one tree to the other is the coach's most important move, and it has no
representation anywhere today.** "My squad" and "the field my rider actually raced in"
are different sets, and moving between them is the whole game.

**Time.** Round → Season → Career. A **Round** is the league's race numbering (Race 1–4,
then State Champs); one Round can be two Events when the conferences race separately.
**Season** is the frame everything sits inside, not a filter — because club membership is
season-keyed, "all seasons" is not even a well-defined club.

**Every rider mark has three states, everywhere:** *positioned* (has a comparable
result), *started but no comparable position* (DNF, lapped, or time trial), and *did not
start* (no row at all — visible only by crossing the roster against the rounds). A start
is valuable in itself; the league gates State Champs eligibility on starts, not placings.

**Two orientations, roughly equal in number, and both first-class:** riders chasing
places, and riders whose season is measured in starts and finishes. This is orthogonal
to every structural split, so it can never be a filter or a segment — the *shape* of the
views has to serve both. A view that renders only place serves half the roster.

**Two metrics that never share an axis:** *Percent Back* (how far behind the category
winner — ours, continuous, the form metric, null for DNF/lapped/time-trial) and
*Season Points* (the league's published standing totals — theirs, discrete, read
verbatim, never recomputed).

**Middle school is a data trap:** team results are high-school-only, so a middle school
rider can have an individual standing and no team result at all. Any view that assumes
team results will be empty for the younger half of the club.

**Privacy:** these are minors. The whole app is behind auth, no anonymous tier.

---

## Four rules I have already committed to

State plainly if you think one is wrong — that would be the most useful outcome of the
session — but do not quietly design around one.

1. **Two trees joined at scoring team.** Not one hierarchy.
2. **Move one axis at a time.** A screen offers a step sideways (who) or a step out
   (when). Not both at once.
3. **Round, not event, is the unit of time.** A URL cannot simply be an event id.
4. **Season is the ambient frame, not a filter.**

---

## What is genuinely open

- What "one axis at a time" actually looks like as controls.
- **How the crossing at scoring team is represented.** Nothing today does it.
- Where season lives — URL segment, persistent selector, or both. Deep links need it.
- Whether a Round is a navigable place or only an axis on a chart.
- What the home page is for. What does each of the three people see on landing?
- The back-path problem: how you get *out* of a deep view.
- **Where the write moment sits.** M0 is the only place anyone writes, and it arrives on
  an ingest rather than a navigation. Does it live in a queue? A banner? A separate
  intake mode? Does it belong to the head coach alone or fan out to squad leaders?

---

## What I want out of the session

An interactive working session — you and me, back and forth — producing:

1. **The flow.** How a person moves through this. Ideally more than one competing shape,
   each with an honest statement of what it makes cheap and what it makes expensive, and
   the question that would kill it.
2. **A storyboard** of the moments in sequence — with the **crossings between** frames as
   the actual content, not each frame in isolation.
3. **The persona cut.** Whether these are three roles, three modes, or three depths, and
   what each one's landing surface is.
4. **A sequencing read** — what has to exist before what, so I can turn this into a
   roadmap.

## How I want you to work

- **Give me options with honest costs, not conclusions.** An artifact that reports where
  you think we're going reads as a status update and I can't argue with it. An artifact
  that poses choices is a conversation. This is the single most important instruction
  here — a previous attempt at this was rejected for exactly this reason.
- **One question at a time.** Do not answer for me, and do not batch five questions into
  a paragraph.
- **Go wide before you go deep.** I have not asked you to stay inside anything except
  the four rules and the vocabulary. If the right product is a different product, say so
  early.
- Use the vocabulary above precisely — the words are load-bearing and were argued over.
  Say Round or Event, never "race". Say Club when you mean the org, Scoring Team when
  you mean the league's label, Squad when you mean the coach's grouping.
- Visual fidelity is not the point. Boxes and arrows that show the route beat beautiful
  screens that don't.

When we land it, I'll want a written summary I can carry back to the project: the chosen
flow, the calls as decided, what was ruled out and why, and the sequencing.
