# Orchestration: milestones 0 → 2 (Roster Wall to first shareable)

You are the orchestrator for `stonematt/bike_race_results`. You run on Opus. You hold the decisions, the diffs that matter, the merges, and the summary. Everything noisy or procedural goes to Sonnet subagents. Fan-out is standing permission, recursive to depth 3.

Goal of this run: a coach can open the app, land on the Roster Wall for their squad, click into a Round, and cross into a rider's Category. Three navigable pages that make sense on the 2025 fixture. That is milestone 3's input.

## Read first, in this order

1. `CLAUDE.md` (repo) and the global rules it inherits: `stone-commit`, `stone-merge`, feature branch → `dev`, no attribution trailers, review policy is two-axis (`/code-review`) before any merge.
2. `gh issue view 1` — the map. `gh issue view 1 --comments | tail -60` — the 2026-09-06 re-sequence comment is the plan you execute.
3. `docs/ux/coach-flow-session.md` — the decided surface. Boards are in `docs/ux/coach-flow-boards.html`.
4. `CONTEXT.md`, `docs/adr/*`, `docs/ux/moments.md`, `docs/brand.md`, `docs/fixtures.md`.
5. `gh issue list --milestone "0 Docs reconciled"`, then `"1 Roster Wall"`, then `"2 Crossing"`.

Delegate reads 3–5 to one Sonnet `Explore` agent and ask for a 300-word brief. Read 1–2 yourself.

## Invariants you enforce, not the subagents

- **NICA is the scoring authority.** Never compute points, place, category assignment, DQ, or eligibility. Describe: percent back, lapped, field size, "3rd of 30" read from source. ADR-0001.
- **Two trees joined at Scoring Team.** The wall lives in the club tree. The crossing is the one link into the league tree. ADR-0002.
- **One write path**: plate attach. Not in scope for this run; nothing else writes.
- **Season is the frame, not a filter.** Season is a URL segment (#88). Round is the column unit, not Event.
- **Privacy.** `fixtures/` never leaves the machine. Tests run on `shape-corpus/`. No cron ingest. `pnpm privacy-guard` and `pnpm brand:check` are gates, not suggestions.
- `rm -rf .next` before `pnpm typecheck`; stale generated types are a known false positive.

## Milestone 0 — Docs reconciled

Tickets: #94, #90, #93, #63.

- **#94** → Sonnet `general-purpose`, one branch `docs/reconcile-coach-flow`. Brief: apply the reconciliation table from the session doc verbatim, add Category, mark the brief superseded. Return the diff summary. You read the CONTEXT.md diff yourself before commit; vocabulary errors here compound.
- **#90** → you write ADR-0003 (single write path, plate attach only). Short. Same branch.
- **#93, #63** are decisions already made in the session (delete Career; no place-plotted strip for a time trial). Record each as a one-line comment and close, or fold #93 into the wall ticket if the column exists in code. Have Sonnet check whether it does.

One PR. Two-axis review. Merge from the main session. Close the milestone.

## Milestone 1 — Roster Wall

Tickets: #35, #88, #74.

Design is decided; do not reopen it. Cells are three-state marks, not magnitudes. Rows are riders in the Squad, columns are Rounds in the Season. The wall is the home route.

Cut seams before dispatch. Suggested lanes, each a Sonnet `general-purpose` agent on its own branch, file-fenced:

1. **Routing + season** (#88): `src/app/[season]/...` segment, persistent selector, redirect from `/` to the current season and the coach's default squad. Touches `app/`, `middleware.ts`, and whatever resolves "current season" from the calendar tables.
2. **Wall query** (`src/lib/db/query.ts` and a new pure module `src/lib/roster-wall.ts`): riders × Rounds for a squad and season, three-state outcome per cell, derived only from fields the source already publishes. Unit tests on shape corpus. This lane owns #74 if the field-strip contract is on its path.
3. **Wall component** (`src/components/RosterWall.tsx`): renders the pure module's output. Reads `docs/brand.md` first. No data access.
4. **Round page**: a Round is a navigable place. Reuse `RaceDetail` where the Round is a single Event; a split Round shows two fields and states that in words.

Lanes 1 and 2 first, in parallel. 3 and 4 after 2 lands, in parallel. Each lane: tests green, `pnpm lint`, `pnpm typecheck`, PR into `dev`, two-axis review. You merge. Before merging lane 3, run the app yourself (`/run`) on the 2025 seed and look at the wall. If a cell reads wrong, that is a decision, and it is yours.

Milestone exit: `/` → wall for the Descenders' default squad, 2025 season, every Round column present, a Round click lands on a page with the field.

## Milestone 2 — Crossing

Tickets: #92, #91.

Close #91 with one comment: crossing ships before scope toggle and queue. Then #92 as two lanes:

1. **Category query**: given a rider and a Round, the ranked list of her Category at that Round, read from source place fields, never computed. Squad-mates flagged. Field size as a number the component can phrase. Pure module + tests on shape corpus.
2. **Category view**: a ranked list anchored on her row, three states inline, squad-mates pinned. Link from the wall cell. The link is the red link; style it as the one crossing, per brand.

Same gates. You look at it running before merge.

Milestone exit: wall cell → Category list with the rider's row visible on load. Close milestone. Post a comment on #1 with what shipped and what the recording (#95) should show.

## Working rules for the run

- One PR per lane. Small. `stone-commit` for every commit, `stone-merge` to land. Never `gh pr merge` from a subagent; it will be denied. Subagents report readiness, you merge.
- Subagent briefs state facts and the ticket number. They do not carry authority to merge, waive review, or touch `fixtures/`.
- When a subagent surfaces a question that changes shape (a new column, a term not in CONTEXT.md, a computed number), stop the lane and decide. Record the decision on the ticket.
- Do not build the scope toggle, the queue, the rider frame, or the season trend. If a lane drifts there, cut it.
- End of run: `gh issue list --milestone` for 0, 1, 2 shows nothing open. Summary to the user: three pages, how to see them, what to record for #95.
