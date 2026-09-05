# Swarm profile — bike_race_results

Filled 2026-09-04. Re-run the gates and the blast-radius probe every swarm; those two rows are
the run's, not the repo's. Everything else is the repo's until the repo changes.

---

**Repo** `stonematt/bike_race_results` · root `/Users/mstone/src/github.com/scd/bike_race_results` · base branch `dev`

The release branch is `main`. Feature branches cut from `dev` and PR into `dev`. Nothing in a
swarm ever touches `main`.

**Ready label** `ready-for-agent`. It narrows; it does not decide. `wayfinder:map`,
`wayfinder:prototype` and `wayfinder:grilling` are out of scope for a swarm — they are the
user's own design surface.

**Read before designing**

- `CLAUDE.md` at the repo root, and `docs/agents/{domain,issue-tracker,triage-labels}.md`
- `docs/brand.md` — mandatory before any UI work. Ink-on-orange is never white; orange is a
  highlight, not a field; navy banner ground. Nothing from `scd-brand/sources/` enters this repo.
- `docs/fixtures.md` — the corpus, and why it is not committed
- The wayfinder map, issue #1: `gh issue view 1`. It holds the destination, the domain
  vocabulary and the standing decisions.
- There is no `CONTEXT.md` and `docs/adr/` is empty. Proceed silently; do not create them.

**Dependency sync** `pnpm install --frozen-lockfile` in the fresh worktree. Node 24 (`.nvmrc`),
pnpm 10.33.2.

## Gates

In this order, all green before anything opens. Baseline at `fb8a51f`:

| gate | command | baseline at `fb8a51f` |
| --- | --- | --- |
| types | `pnpm typecheck` | clean, exit 0, no output |
| lint | `pnpm lint` | clean, exit 0, no output |
| format | `pnpm format:check` | `All matched files use Prettier code style!` |
| tests | `pnpm test` | `Test Files 8 passed (8)` · `Tests 69 passed (69)` |

Beat or match those counts. A test count that went *down* is a deleted test, not a win.

## Blast radius

Probes planted at `$TMPDIR`, `~/.local/share/bike_race_results/`,
`~/.local/share/bike_race_results/fixtures/`, `~/.config/`, the repo root and `.pglite/`;
the full gate set run at `fb8a51f`.

**All six markers survived.** The gate set is fully sandboxed — it writes nothing outside the
worktree. PGlite in the test suite is in-memory.

**The line your new tests hold:** a test gets its database from `createTestDb()` in
`src/lib/db/testing.ts` — never `createDb()` from `src/lib/db/index.ts`, which resolves a real
URL and can land a database on disk at `.pglite/`. A test never writes anywhere under
`~/.local/share/bike_race_results/`. Break either and the next swarm's probe dies.

## Leave unrun

| command | what it touches |
| --- | --- |
| `pnpm fetch` / `bin/fetch.ts` | The **live RaceResult API** of a volunteer-run nonprofit's timing vendor. Never run it — not to check your work, not once. The whole corpus is already on disk. This holds even for the lane that *implements* it; that ticket is tested against a stubbed transport and recorded config fixtures. |
| `pnpm db:migrate` / `bin/migrate.ts` | Writes to whatever `DATABASE_URL` resolves to, and can create `.pglite/` on disk. |
| `pnpm seed` / `bin/seed.ts` | Same database, plus it reads the real allowlist. |
| `pnpm db:studio` | Interactive. It will hang an unattended lane until someone kills it. |
| any write under `~/.local/share/bike_race_results/` | **The fixture corpus is the only copy.** 1.7M, 64 payloads, fetched once on purpose and slowly. Read it. Copy from it. Never move, never delete, never rewrite. The ticket that brings it in-tree copies and leaves the original standing. |

`pnpm brand:check` is safe but is not a gate — it reads a private sibling repo and exits 0 when
it is absent.

## Frozen files

`src/lib/db/schema.ts` and everything under `src/lib/db/migrations/` are **frozen for this
swarm**. All 23 tables and all 5 views (`v_individual_result`, `v_race_result`,
`v_rider_result`, `v_club_result`, `v_unmapped_rider`) already exist and every queued ticket was
written against them.

Two lanes each running `drizzle-kit generate` produce two `0002_*.sql` files and a conflicting
`meta/_journal.json`, and that conflict is not resolvable by merge. So: if you believe you need
a schema change or a migration, **stop and escalate**. Do not generate one.

`package.json` and `pnpm-lock.yaml` are owned by exactly one lane at a time — the lane brief
says whether it is yours. If it is not and you need a script or a dependency, escalate.

## Verbs

Each names a skill, and a skill is a file. Read the file and follow what it points at.

| verb | skill | path |
| --- | --- | --- |
| implement | `implement` | `~/.claude/skills/implement/SKILL.md` (it points at `/tdd` — use it) |
| review | `code-review` | `~/.claude/skills/code-review/SKILL.md` |
| commit | `stone-commit` | `~/.claude/skills/stone-commit/SKILL.md` |
| merge | `stone-merge` | `~/.claude/skills/stone-merge/SKILL.md` |

`implement` sets `disable-model-invocation`, so the `Skill` tool cannot reach it — read the file
from disk.

## Landing policy

- **Feature PR into `dev`: the lane self-merges.** That is the whole point of an unattended run.
- **Never `main`.** No promotion, no release PR, no `--admin`, no force-push.
- **The two-axis review is not optional and is not skippable at rung 4.** `code-review` runs
  Standards and Spec as parallel agents. Pre-supply both inputs or it stalls: the fixed point is
  `origin/dev` three-dot (so the diff is against the merge-base), and the spec source is the
  ticket this branch closes. Apply its mechanical findings to the branch and commit them;
  escalate a judgement call with the finding quoted. This satisfies rung 3 of `stone-merge`
  Section 2.0.
  *Why it is load-bearing here:* this app renders minors' names behind one auth gate, so the
  failure that matters is a diff that passes every convention while quietly widening access.
- **Attribution:** no `Co-Authored-By: Claude`, no `Generated with Claude Code`, in any commit
  message or PR body. Every repo, every time.
- Link the ticket from the PR body so `closingIssuesReferences` resolves — the review's Spec
  axis reads it.
- After merging: delete the branch local **and** remote, remove the worktree, and
  `git fetch origin --prune`. A stale `origin/*` ref makes the next lane's cleanup look skipped.

### `gh pr merge --delete-branch` fails in a worktree — and it is not a failed merge

Observed by two lanes, 2026-09-04/05. From a linked worktree, with `dev` checked out in the
main tree:

```
fatal: 'dev' is already used by worktree at .../bike_race_results
```

**The merge itself lands** — it is a server-side API call. Only gh's local checkout and its
remote-branch delete are skipped. A lane that reads this as a failure will retry a merge that
already happened.

Confirm with `gh pr view <n> --json state,mergeCommit`, then delete the remote branch
explicitly: `git push origin --delete <branch>`. If *that* is refused by the classifier,
record the branch SHA, hand the user the command, and carry on — do not loop, and never route
around it with a different binary.

## Privacy — the constraint above all others

This repo is **public**. The payloads carry minors' full names, schools, grades, plates and
finish times.

- Nothing derived from the corpus gets committed or posted to an issue with a real name in it.
  Pseudonymize first — the established form is `«RIDER-A»`, stable across a document.
- No GitHub Actions schedule that fetches, while this repo is public.
- If you are unsure whether something is safe to commit, it is not. Escalate.
