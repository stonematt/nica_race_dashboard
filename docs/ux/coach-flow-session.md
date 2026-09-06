# Coach flow — design session

**Destination:** `docs/ux/coach-flow-session.md`
**Date:** 2026-09-06
**Scope:** flow and storyboard for the coaching surfaces. No visual design, no code.
**Relationship to existing docs:** does not replace `docs/ux/moments.md` — that stays the
who-by-when frame and the job stories. This is the session that chose a flow through it, and
it proposes edits to `CONTEXT.md` and one split in `moments.md` (see _Doc reconciliation_).
Three of the four standing rules survive unchanged; Rule 3 was challenged and reinstated with
a corrected justification.
**Companion artifact:** `docs/ux/coach-flow-boards.html` (landed in this repo alongside this doc) — nine option boards (1a–1c, 2a–2e, 3a–3c, 4a–4c, 5a–5b, 6a–6c, 7a), each with what it makes cheap, what it makes expensive, and the question that would kill it. Ids referenced below are live anchors in that file.

---

## The chosen flow

**Home is the Roster Wall, scoped to a Squad** (`1b`). Riders are rows, Rounds are columns,
and the cell carries the three-state mark. Time is an axis on the home page, not a place you
go to reach it.

**A scope control widens the wall inside the club tree** — Squad ⇄ Club. Same component,
more rows, grouped by Squad. It does not reach into the league tree.

**A Round is a place** — `/2026/round-3/squad/wolf-pack` — reached by opening a column. Its
back-path _is_ the wall, structurally rather than by a button.

**The crossing is a single red link off the rider frame**, and the only door from the club
tree into the league tree: from "Rivera at Round 3" to "her category field at Round 3,"
forty-seven riders with her marked in it, and a statement on the face of who is included.

**The rule, stated for a coach:** the buttons keep you in a tree; the red link leaves one.

**M0 lives in a banner pinned above the wall**, not in a mode or a nav item. It appears on
ingest, it is filtered by Scoring Team so it fans out to Squad Leaders, and it disappears
when drained.

Route drawn in full, with the crossings as the content of the storyboard, at `5a`.

---

## Calls as decided

1. **Squad-scoped Roster Wall is the landing surface.** Everything else is reached from it.
2. **The Squad Leader is the primary user**, not the middle one. This followed from the
   landing choice rather than being decided separately, and it's worth saying out loud.
3. **Three depths, not three roles.** A role is a triple of defaults — where the scope
   control starts, whether the queue is visible, how the queue is filtered. One surface,
   configured. An Assistant can be promoted mid-season with no migration. Table at `6b`.
4. **M0 fans out.** The queue is scoped by Scoring Team; the Head Coach's view is the
   unfiltered one. The person closest to the riders does the recognising, and it costs one
   predicate.
5. **The crossing is a link, not a control** (`6a`). A field is not rows, so the shape
   change from wall to distribution is inevitable — the only question is where it happens.
   On a link, a change of shape is what the affordance means. On a segmented control that
   promised every notch was the same view, it's a broken promise, and it breaks exactly at
   the move that most needs to be legible. **The corpus supplies a second, deeper reason:**
   a Squad cuts across Scoring Teams, so at Rounds 2–4 one squad's riders sit in two
   different Events with different fields, winners and Percent Back denominators. The wall's
   column must therefore be a **Round** (the union of both Events) while the crossing's
   destination must be an **Event** (her category at _her_ Event). A control claiming
   sameness across that boundary would have been lying twice over.
6. **The scope control stays inside the club tree.** Squad and Club are both rows of riders
   we own, so the control never lies.
7. **"Discussion" is not a surface. It is a shape constraint on the rider frame.** Nothing
   is written. The frame has to be speakable out loud, and that is the acceptance test.
   Rules at `7a`.
8. **The product has exactly one write path** — attaching a plate to a Rider. No audit
   trail, no moderation, no edit history, no coach-authored text about a minor anywhere in
   the database. Given twenty volunteer coaches and a roster of minors, this is the largest
   privacy simplification available. **Deserves its own ADR.**

---

## Rules changed

**Rule 3 stands. Reinstate it as written.** Mid-session I argued for retiring it as a
navigation rule, on the assumption that Oregon does not split a Round across two Events.
I then read `fixtures/2025/configs-summary.json` and the assumption is false. **Retracted.**

The 2025 season is **five Rounds across eight Events**:

| Round | The league's own published event name                    | Events                    |
| ----- | -------------------------------------------------------- | ------------------------- |
| 1     | Race 1 — ORLeague — Old Oak Prologue                     | 1 — whole league          |
| 2     | Race 2 — ORLeague Moore Fun — South / North              | **2**                     |
| 3     | Race 3 — ORLeague Cascade Challenge — South / North      | **2**                     |
| 4     | Race 4 — ORLeague Newport Gnarnia — North / South        | **2**                     |
| 5     | Race 5 — ORLeague Butte, Scoot and Boogie — State Champs | 1 — 14 categories, not 28 |

Three of five Rounds are two Events. **Rule 3 stands — but not for the reason I first gave.**

I initially wrote that a Squad spans two Events at Rounds 2–4. That is wrong: **the Club sits
entirely in the North Conference**, so every Scoring Team it spans is North and a Squad is in
exactly one Event per Round. Round and Event are 1:1 _from inside this club_.

Rule 3 survives because **the field** spans both Events, not the squad. Any view that puts
North beside South must place two Events at one x, and the season arc must render Race 2 as
one point when the league published two. Keep the rule; replace its justification.

_This is the load-bearing fact that was missing from every doc: one club, one conference,
always North. It changes what "the field" means on every screen and belongs in `CONTEXT.md`._

**On the word "race" — the glossary is over-broad, not the usage.** The league's published
event names are literally "Race 1" … "Race 5". _Race N is the published label of a Round._
Recommendation: keep **Round** as the structural term and use **"Race 3"** as the display
name, because that is what a coach reads on the league's site. The word to avoid is not
"race" — it is saying "race" when you mean **Event**.

Also confirmed by the corpus: the Prologue is Race 1 (one Event, whole league, with its own
`Prologue/TT Results ALL` list), and State Champs is Race 5 — _inside_ the numbering, not
outside it.

Do **not** collapse Scoring Team vs. Club. That distinction is load-bearing and the crossing
depends on it.

**`CONTEXT.md` — strike the time-trial clause from Percent Back.** The definition currently
reads "null for a DNF, a lapped rider, and everyone in a time trial." The Prologue has a
real podium, positions 1..N, and chip timing that starts every rider's clock at the mat.
It has a category winner and a comparable time. **Percent Back works there.**

Consequences:

- The three states survive with a narrower middle: _positioned_ / _started but not
  positioned (DNF, lapped)_ / _did not start_.
- The Prologue is the **cleanest** Percent Back of the season — no pack, no traffic, no
  tactics. It is the season's baseline and the natural first point of every rider's arc,
  not a hole at x=1.
- **Watch this cost:** with Percent Back comparable at every Round, the wall's cell _can_
  carry magnitude. The moment it does, a finish-oriented rider's row becomes a row of
  how-far-back. The three-state mark was doing protective work. Don't spend it just because
  the data now allows it.

Rules 1, 2 and 4 stand unchallenged. Rule 4 in particular should be **structural in phase 0**
(Season as a URL segment) rather than a discipline — see sequencing.

---

## The missing word: Category

`CONTEXT.md` defines Conference, Division, Club, Squad, Scoring Team, Level, Round and Event
— and never names **the set a rider is actually ranked in**. The league does: the results
field is `CategoryRank` and the grouping is `CONTEST.NAME`. Category is the denominator of
Percent Back and the thing the athletes themselves asked about. Add it:

> **Category** — the league's raced-and-ranked group: Level plus grade band plus gender, and
> _through Round 4, Conference_ ("HS2 Girls – North"). Published as a contest per Event. The
> peer set a Rider is ranked in, and the denominator of Percent Back. **Conference-scoped at
> Rounds 1–4; league-wide at State Champs.** _Avoid:_ class, group, division.

**Confirmed against the corpus.** Race 1 runs **28 contests** whose names carry the
conference in the string (_Varsity Girls – North_, _MS3 Boys – South_). Race 5 runs **14** and
the suffix is gone — the categories merge. That is "we're scored against the North until we
get to state," in the data. The 2026 Prologue carries 28 groups, so the shape holds.

**This re-labels the crossing.** It was never "Club → Conference." It is **Rider → Category**,
and the Category carries the conference inside its own name — a much smaller and more
concrete thing to build than a tree traversal, and the thing the riders asked for.

**And it keeps Division honest.** Conference is North/South; Division is NICA's team-size
scoring bracket; Category is the third word that had been silently absorbing both.

---

## Do not build the cross-conference view with Percent Back

Percent Back is measured against **the category winner**, and through Round 4 that winner is
inside your own conference. A North rider at 8% back and a South rider at 8% back are each
8% behind a _different person_. Side by side they produce a number that looks comparative
and is not.

(This also removes a hypothetical: since a Club cannot span Conferences in a Season, there is
never an _internal_ cross-conference comparison to make — only an external, curiosity-driven
one.)

The honest instrument is **raw time on a shared course**. Both conferences ride the same
venue each Round, but only at **Race 1 and Race 5** do they ride it on the same day in the
same conditions. Everywhere else the comparison is confounded by Saturday-versus-Sunday.

So the pre-State curiosity has exactly one fair answer, and it is already ingested: **the
Prologue** — same course, same day, whole league, with a conference suffix you can lift off.

**M4 therefore splits in two, and they should not share a ticket:**

- **M4a — the rider in her Category.** Athlete-originated, the app's most-wanted view.
- **M4b — the club against another conference.** Late-season, coach-only, answerable only at
  Rounds 1 and 5, and only on raw time.

---

## Ruled out, and why

| Shape                                                                 | Why not                                                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Round Feed** (`1a`) — land on Rounds, newest first                  | A Rider is reachable only _through_ a Round they raced, so a did-not-start is unreachable by navigation — exactly the rider a coach most needs to notice.                                                                                                                       |
| **Work Desk** (`1c`) — land on ranked work items                      | With 25 riders and 5 Rounds there may never be enough work to fill it; empty nine weeks in twelve makes it a banner, not a home. It also has to _generate_ items, and "flat for three Rounds" is a judgement — the closest any shape came to adjudication.                      |
| **Season Ledger** (`2a`) — Season is the object, not the frame        | Wins M5 and M6 outright, but a Round becomes a paragraph competing with a whole season for attention on a Sunday night.                                                                                                                                                         |
| **Rider Board** (`2b`) — only riders are places                       | Strong on M2, but the field is hundreds of riders and cards stop at your own, so M4 needs a second vocabulary anyway. Dies quietly if the roster grows past ~60.                                                                                                                |
| **The Grid Itself** (`2c`) — the who×when table as literal navigation | Satisfies Rule 2 visibly, but asks a volunteer coach to learn a two-axis vocabulary before seeing how their kid did. Most cells are not a question anyone has.                                                                                                                  |
| **Question List** (`2d`) — the seven moments as sentences             | Best possible first visit; does not compose. "Is this kid moving _against the field_" needs its own sentence, so the list grows multiplicatively.                                                                                                                               |
| **No Home** (`2e`) — arrival, not navigation                          | Honest reading of "the moment arrives on an ingest," but it puts Outspoke's notification channel on the critical path of this product's front door, and has no answer for a coach arriving with their own question.                                                             |
| **Round as a column only** (`3a`)                                     | Cheapest to build, but "how did the Club do at Round 3" is not a squad wall, and M4's crossing has nowhere to hang except inside a cell.                                                                                                                                        |
| **Wall with a Conference scope notch** (`3c` / `5b`)                  | See call 5. The control breaks at its last notch.                                                                                                                                                                                                                               |
| **Notes on riders** (`7a` alternatives b, c, d)                       | A per-Round note, a per-athlete log, and a read-receipt were all considered. A thread is Outspoke's. A read-receipt is management, not analytics. A note was defensible as the qualitative column beside Percent Back, and was declined — see call 8 for what declining bought. |
| **The Career column**                                                 | The who×when grid has a Career column that no moment asks for. M2 is season-shaped; M6 is season-shaped. **Recommend deleting the column** until a coach asks — an axis with no job on it is where scope creep enters a roadmap.                                                |

---

## Sequencing

Full table with per-phase prerequisites and gates at `6c`.

| #   | Build                                  | Needs first                                                                                                  | Pays for                                                                         |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| 0   | The wall, Squad scope, read-only       | Season-keyed roster · Rounds enumerated · did-not-start derivation (roster × rounds) · **Season in the URL** | M3 whole; M1 for a Squad Leader                                                  |
| 1   | Scope: Squad ⇄ Club                    | Nothing new in the data                                                                                      | M1 for the Head Coach. Cheapest large win — do it while it's still the same file |
| 2   | The queue (M0)                         | Plate→Rider attach · Prior Name lookup · Scoring Team predicate                                              | M0, and the honesty of every number in phases 0–1                                |
| 3   | The rider frame                        | Percent Back per Round · Start count first-class                                                             | M2                                                                               |
| 4   | The crossing                           | Category field per Round · explicit "who is in this comparison"                                              | M4's rider half; job story 10                                                    |
| 5   | Season arc + standings in place        | Standings ingested · Level split handled (a Middle School rider has a standing and no team result)           | M5, which has nothing today                                                      |
| 6   | Season close / last season as baseline | Nothing — _if_ Season has been the frame since phase 0                                                       | M6, never ticketed                                                               |

**The real tension, stated plainly.** Phase 2 is the only write and the riskiest surface,
which argues for late. But until it exists the wall **under-counts the club** — an unmapped
plate is a rider who raced and does not appear — so phases 0 and 1 ship a front door with
quietly wrong numbers. It sits third because you can hold that line with a visible warning
for a few weeks and you cannot hold "there is no app" for a few weeks. If you disagree, the
swap 2 → 0 is cheap. Decide it before phase 0 ships, not after.

**Phase 3's gate.** Show the rider frame to a coach of a finish-oriented rider before
shipping it. If place dominates, fix it there — it is the last cheap moment, and after call 7
it is the _only_ place the two-orientations principle can be enforced.

---

## Still open

1. **Where Season lives.** Recommendation: URL segment **and** a persistent selector —
   `/2026/…` everywhere, with the selector rewriting the segment rather than filtering the
   page. It is the only combination that satisfies both "ambient frame" and "deep links need
   it." Cheap in phase 0, a migration after.
2. **Whether Career survives.** Recommend deleting the column (see above).
3. **Job story 9** — "the Club placed against its conference in that same Round" — has no
   home in Version C and is a genuine, named loss. It wants a club-level crossing, which is
   a later surface, not a scope notch. Note: the **2026 payload shape may remove the source
   data entirely** — `fixtures/2026/config-418436.json` carries three lists (Individual
   Results, By Team, Series Overall) and **no Team Results list**, where 2025 had two plus a
   season overall. If that holds through the season, story 9 has nothing to read from.
4. **A split Round has two fields.** "The club's day" at Race 3 is two comparisons, not one.
   Job story 10's "make it obvious who is included" now has teeth at the _Round_ level, not
   only at the club-comparison level. Not designed.

---

## Not decided in this session

Visual design, component inventory, chart types, the wall's cell rendering (mark vs.
magnitude — see the warning under _Rules changed_), and the queue's own interaction design.
The queue is the one place in the app that looks like a form and it has not been designed.

---

## Doc reconciliation — six edits

| File                 | Edit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CONTEXT.md`         | **Add Category** (entry above). Highest-value edit here.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `CONTEXT.md`         | Under **Club**: "A Club belongs to exactly one Conference per Season. It may span several Scoring Teams, all inside that Conference." This is a **league invariant**, not a trait of this club — Oregon does not let a Club span conferences in a season. Consequence: through Round 4 the far side of the crossing is always the Club's own Conference, with no branch. At State Champs the Category merges league-wide and the peer set doubles — the only variability in the mechanism. |
| `CONTEXT.md`         | **Round** → "a race weekend in the league's numbering (Race 1–5), published as one Event per Conference — or a single Event when the whole league rides together, at the Prologue and State Champs." Says _why_ a Round can be two Events.                                                                                                                                                                                                                                                 |
| `CONTEXT.md`         | **Percent Back** → strike "and everyone in a time trial"; add "measured within Category, so it is _not_ comparable across Conferences." The second clause is what stops a bad chart.                                                                                                                                                                                                                                                                                                       |
| `CONTEXT.md`         | **Event**, _"Avoid: Race"_ → "Race N is the league's published label for a Round and is fine on screen. Never say 'race' when you mean Event."                                                                                                                                                                                                                                                                                                                                             |
| `docs/ux/moments.md` | Split M4 into M4a and M4b (above).                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

## Terminology audit — as used in this session

| Term                        | Verdict                                                                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Round                       | Correct. Five per season, confirmed by the corpus. Best definition is _a race weekend_.                                         |
| Event                       | I claimed 1:1 with Round league-wide — wrong (8 Events / 5 Rounds). It _is_ 1:1 from inside this club.                          |
| Race                        | The glossary is over-broad, not the usage. "Race N" is the league's published label for a Round.                                |
| Prologue                    | Race 1, one Event, whole league, chip-timed, real podium, **conference-scoped categories**. Percent Back works.                 |
| State Champs                | Race 5 — _inside_ the numbering, not outside it. 14 contests; categories merge league-wide.                                     |
| Conference                  | North/South. Load-bearing twice: it splits a Round into two Events, _and_ it scopes Category through Round 4.                   |
| Division                    | Correctly distinguished in the docs. The session slipped once ("divisions or conferences"), which is evidence the risk is real. |
| Category                    | **Was missing.** The peer set and the denominator of Percent Back. Now proposed.                                                |
| Club / Squad / Scoring Team | Clean, no drift. Never collapse Scoring Team into Club.                                                                         |

---

## The Category view is a ranked list, not a distribution

Corrected late in the session. I described the far side of the crossing as a distribution
from the first option board onward. The corpus says don't: **Category sizes at the 2025
Prologue range from 2 riders to about 80** (Varsity Girls – South had two; HS1 Boys – North
had eighty). A histogram is meaningless at N=2; a full ranked list is unreadable at N=80.

The shape that works at both: a **ranked list anchored on her row** — a few above, a few
below, squad-mates pinned wherever they landed, field size stated in words ("3rd of 30"),
and the three states rendered inline (a DNF is a row with no position, not a missing row).
Smaller build than a chart, and it is what makes the sentence sayable.

---

## Parked for a later session

Held, not designed. From the reaction to the Category view (`10a`, `10d`):

- **Widen the Category table** with Points, Time, and possibly splits — the wish is that a
  wider table shows a bigger picture.
- **Points and Time are verified available.** The Prologue's published list carries both, so
  they are read verbatim and stay on the description side of ADR-0001. Safe to add.
- **Splits are unverified.** The corpus lists carry start and end _time of day_, not lap
  splits. Confirm against a live list before designing on them — it may be a request to the
  league rather than a column.
- **The elision ("⋮ 21 more") is a design object, not a truncation.** It is the only place
  the field size is actually felt. Open question for then: does it expand in place, or stay a
  permanent statement of scale?
- **The tension to bring to that session:** every column added pulls against the rule in
  `7a` that the frame must survive being said aloud. A wider table is a bigger picture and a
  worse sentence. Probable shape — the anchored row stays speakable and the extra columns are
  a disclosure you open — but that is a call for then.

---

## Checked against the corpus on intake — 2026-09-06

The session ran with no repo access, working from a self-contained brief. Every factual
claim above was re-verified against `fixtures/` when the handback landed. Five of seven
held exactly, including the ones the flow rests on: five Rounds across eight Events; 28
conference-suffixed contests at the Prologue and 14 unsuffixed at State Champs; the
Prologue's own `RankOrStatusTT` running 1..N per contest with a real `TIME`; Category
sizes running from 2 (`Varsity Girls - South`) to 80 (`HS1 Boys - North`); and the 2026
config advertising three lists with no Team Results among them.

Two claims did not survive, both in **Parked for a later session**:

- **Points is not on the Prologue list.** `Prologue/TT Results ALL` carries `BIB`, names,
  `CLUB`, `RankOrStatusTT` and `TIME` — no points field. Points for that Event lives on
  `Individual Results - By Team`. The polish session's "add Points and Time" is therefore
  a join, not a wider read of the same list. Time is there as claimed.
- **Splits are published, not absent.** The session recorded start and end time-of-day and
  no lap splits. 2025's by-team lists carry `DisplayLapTime(1..5)`, and 2026's
  `Individual Results` carries `Lap01` and `Lap02.SECTOR` and no time-of-day field at all.
  So the open question is not "does the league publish splits" — it does — but whether a
  split column survives the rule in `7a` that the frame must stay speakable.

One nuance worth carrying: the 2026 config's own `contests` map holds a single entry
(`{"1": "Prologue"}`) while the result payload groups 28 categories. Category comes off
the `data` key (`#<contestID>_<ContestName>`), not reliably off the config.
