# Swarm profile — bike_race_results

Filled 2026-09-04, gates and blast radius re-measured 2026-09-05 at `98c69a4`. Re-run the gates
and the blast-radius probe every swarm; those two rows are the run's, not the repo's. Everything
else is the repo's until the repo changes.

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

**Node 24 is not advisory — select it explicitly.** A shell defaulting to a newer Node makes
`pnpm lint` fail with `ESLint couldn't find the plugin "eslint-plugin-react-hooks"`. That is a
resolution artifact of the Node version, not a repo fault: the plugin is a transitive dep of
`eslint-config-next` and lives only in pnpm's hidden hoist dir. Measured 2026-09-05 — red under
Node 26.8.1, clean under 24.16.0 at the same commit, with CI green throughout. Run
`eval "$(fnm env --shell bash)"; fnm use 24` before the first gate, and do not re-diagnose it.

## Gates

In this order, all green before anything opens. Baseline at `98c69a4`, under Node 24.16.0:

| gate | command | baseline at `98c69a4` |
| --- | --- | --- |
| types | `pnpm typecheck` | clean, exit 0, no output |
| lint | `pnpm lint` | clean, exit 0, no output |
| format | `pnpm format:check` | `All matched files use Prettier code style!` |
| tests | `pnpm test` | `Test Files 40 passed (40)` · `Tests 587 passed (587)` |
| tests (local lane) | `pnpm test:local` | `Test Files 7 passed (7)` · `Tests 81 passed (81)` |
| privacy | `pnpm privacy:check` | `privacy guard: clean (200 tracked files)` |

Beat or match those counts. A test count that went *down* is a deleted test, not a win.

## Blast radius

Probes planted at `$TMPDIR`, `~/.local/share/bike_race_results/`,
`~/.local/share/bike_race_results/fixtures/`, `~/.config/`, the repo root and `.pglite/`;
the full gate set run at `98c69a4` (re-measured 2026-09-05, same result as `fb8a51f`).

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

## A fresh worktree has no `fixtures/` — copy it, never symlink it

The corpus is gitignored and never committed, so a new worktree starts without it and
`pnpm test:local` dies with 19 of:

```
No fixture corpus at /path/to/worktree/fixtures
```

That is setup, not a broken branch — two lanes lost time to it as a false red on 2026-09-05.
Fix it with a copy, before the first gate:

```
cp -R /Users/mstone/src/github.com/scd/bike_race_results/fixtures <worktree>/fixtures
```

**Copy, do not symlink**, and note the reason is *not* that a symlink trips the payload guard —
it does not, and a lane that tests that will find it clean and argue the rule away. Verified on
the merged #58 code: both layers read only what git holds (`git ls-files -s` and
`git diff --cached`), so an untracked link produces no finding and no rejection. Being untracked
is what makes it safe; the `fixtures` line in `.git/info/exclude` only stops a stray `git add .`,
leaving `git add -f` as the one way in — where the guard does fire, on the path name for
`fixtures` and on the resolved target for any other name.

The reasons that do hold, ranked:

1. **Asymmetry.** A copy costs a second and 1.7M. The corpus is the only copy and re-fetching
   means crawling a volunteer nonprofit's timing vendor, which this profile forbids. Precisely:
   `rm -rf <worktree>` does *not* follow a symlink, so teardown is safe — what is unsafe is
   anything writing *through* the link (`rm -rf fixtures/` with the trailing slash, or a future
   step opening `fixtures/<path>` for writing). Nothing in the suite does that today. This
   guards against the agent at the keyboard, not against the tests.
2. **It protects this profile's own blast-radius probe.** The probe plants a marker at
   `~/.local/share/bike_race_results/fixtures/` and reads its survival as the sandbox evidence.
   A symlinked lane that writes kills the next swarm's probe, and it would surface a run later
   as a mystery.
3. **`.git/info/exclude` is shared by every linked worktree.** The symlink route needs a line
   appended there — a cross-lane shared-mutable write, which is the exact thing the file fence
   exists to prevent. In the 2026-09-05 run one lane had to be told not to remove that line
   because another lane's worktree still depended on it. Copying needs no shared state.

`docs/fixtures.md` prescribes the symlink-plus-exclude route, and that is not a contradiction to
resolve by editing it: the doc advises one human in one worktree, this profile governs N
unattended agents sharing one `.git`.

## Frozen files

Everything under `src/lib/db/migrations/` is **frozen for every swarm**. `src/lib/db/schema.ts`
is frozen *by default* and unfrozen only when a lane brief hands it to that lane by name — the
2026-09-05 run gives it to the lane holding #49, comment-only, no migration. All 23 tables and all 5 views (`v_individual_result`, `v_race_result`,
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

- **Feature PR into `dev`: the lane reaches readiness, the orchestrator runs `gh pr merge`.**
  The auto-mode classifier denies that call from a subagent and allows it from the main session —
  confirmed repeatedly, and no rewording of the brief changes it. A lane that tries it stalls.
  Take the merge verb as far as readiness, hand the orchestrator the PR number, gate numbers,
  review outcome and the verbatim command; it merges and replies with the SHA, and the lane
  resumes its own cleanup. This supersedes the earlier self-merge policy.
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
- After merging: remove the worktree **first** (a local branch delete fails while a worktree
  holds it), then delete the branch local **and** remote, then `git fetch origin --prune`. A
  stale `origin/*` ref makes the next lane's cleanup look skipped.
- **Verify the remote delete with `git ls-remote`, not `git branch -a`.** Lane E hit
  `gh pr merge --delete-branch` reporting success while the remote ref stayed live on GitHub,
  2026-09-05; a prune plus `git branch -a` did not reveal it, and
  `git ls-remote --heads origin <branch>` returning nothing did. Three later lanes ran
  `git push origin --delete <branch>` explicitly and none was refused by the classifier.

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
