# bike_race_results

An analytics environment for interscholastic mountain bike race results, built for the **Salem Composite Descenders** in the Oregon Interscholastic Cycling League (NICA).

It ingests what the league published, normalizes it across races and seasons, and lets a coach drill in two directions the official results pages don't support: **who** — conference, scoring team, club, squad, rider — and **when** — one round, a season, a career.

The done-condition: _a race posts on a Sunday night and a coach opens the app to see how their riders did._

**What this is not: team management.** Messaging, calendars, practice plans and volunteer coordination belong to a separate project. This repo is the read model of record for what happened on course; results flow out to that project, and roster or scheduling data never flows in here as truth.

## The shape of the domain

The domain looks like one hierarchy and is not. There are **two trees, joined at scoring team**:

```
League tree (theirs, read-only)      Club tree (ours, editable)
  league                               club
    conference                           squad
      scoring team  <--- joined --->  scoring team
        rider                              rider
```

A club spans several scoring teams, and which ones changes each season — so club cannot sit inside the league's tree without becoming season-scoped and breaking every cross-season view. Two words that look interchangeable are not: **conference** is the league's geographic split (North/South), while **division** is NICA's team-scoring bracket, an attribute of a team's result rather than a level of anything.

Crossed with time, every view in the app is a cell in one grid:

|            | one round       | season to date  | across seasons |
| ---------- | --------------- | --------------- | -------------- |
| conference | field context   | standings       | —              |
| club       | the club's day  | the club's arc  | —              |
| squad      | the squad's day | the squad's arc | —              |
| rider      | the ride        | progression     | career         |

Season is the **frame**, not a filter — club membership is season-keyed, so "all seasons at once" is not a well-defined club. The unit on the time axis is the **round**, not the event: one round can be two events when the conferences race separately.

## Ground rules

**NICA is the scoring authority, and the line is description versus adjudication.** We derive what is recomputable from the published rows and carries no consequence — percent back, lapped, field size, start count, percentile. We never produce what the league decides and acts on — points, place, category, State Champs eligibility. So the app will tell you a rider started three of four rounds, and will never tell you whether that makes them eligible. Where the published numbers look wrong, the app shows the published numbers.

**Two orientations, both first-class.** Some riders measure a season in places and podiums; others measure it in starts and finishes. Both are well represented, and the split does not follow middle school versus high school — there are high schoolers whose season is finishing a lap. So it can never be a filter or a segment: a view that renders only place serves half the roster. This is why a result has three states rather than two — positioned, started without a comparable position (a DNF, a lapped rider, a time trial), and did not start at all.

**There is no public half.** Race payloads carry the names of minors, so every route sits behind auth, and `next.config.ts` sends `noindex, nofollow, noarchive`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store` on every path.

## Status

Early scaffolding — pre-MVP. What works today:

- schema, migrations, and the five domain views
- the auth gate — every route behind it, and admission re-decided on every request, not just at sign-in
- the `migrate` and `seed` CLIs
- the authenticated shell, plus the race list and a race-detail page reading the domain views — squad cards and the field strip
- live fetching in `bin/fetch.ts`, and decoding the archive into the normalized tables
- unit suites over the admission rules, the provider wiring and the brand-token check, and integration suites over seeding and the domain views against a real in-memory Postgres

What doesn't exist yet: a way to _act_ on the unmapped-rider queue (the race page warns; nothing resolves it), any view above a single race — no rider progression, no squad page, no club-vs-field, no season — no navigation between views, and the hosted-database path. The append-only raw layer is real — `node bin/normalize.ts --load-fixtures` archives the local fixture corpus into it without touching the network. Planning is charted on the issue tracker — `gh issue list --label "wayfinder:map"` finds the map, and the map holds the destination, the domain vocabulary, and the standing decisions.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Drizzle ORM · PGlite (WASM Postgres) · NextAuth v5 · Tailwind v4 · Vitest

Node >= 24 and pnpm 10. The `bin/` scripts run as `.ts` directly under Node's native type stripping — there is no build step for them.

## Getting started

```bash
nvm use                 # Node 24
pnpm install
cp .env.example .env.local
```

Fill in `.env.local`. At minimum you need three things:

| Variable              | What to put there                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `AUTH_SECRET`         | Generate one: `npx auth secret`                                                              |
| `AUTH_ALLOWED_EMAILS` | Your own address. Comma-separated; this is the gate for magic-link sign-in, and for seeding. |
| `AUTH_DEV_LOGIN`      | `1`, to sign in locally without a mail server. Development only — see Auth.                  |

Then bring up the database, seed the club and yourself, and load the archived race payloads:

```bash
pnpm db:migrate
node bin/seed.ts --club-config --email you@example.org
node bin/normalize.ts --load-fixtures   # archive the corpus into raw_fetch
node bin/normalize.ts                   # decode it into the result tables
pnpm dev
```

`--club-config` is what fills the club, its scoring teams, the roster, the plate mappings and the squads from `config/club-seed.json`; without it you get a coach on a club with nobody in it. The club's **name** comes from that file too, so there is nothing to type and nothing to keep in step — one invocation puts the coach and the roster on the same club row.

The two `normalize` runs are two different jobs and both are needed. `--load-fixtures` archives payloads into `raw_fetch` and decodes nothing; the bare run decodes that archive into the result tables. The first prints a cheerful "archived 60 payloads" whether or not you run the second, so it is easy to stop early and find every result table empty. On a checkout with no `fixtures/` corpus, skip both — see [`docs/fixtures.md`](docs/fixtures.md).

The `bin/` scripts read `.env.local` themselves, whether you run them as `pnpm seed` or as `node bin/seed.ts` — the file is resolved from the repo root, not from the directory you happen to be in. A variable already set in your shell beats the file, so `DATABASE_URL=... pnpm db:migrate` still points somewhere else for one run. Having no `.env.local` at all is fine: `DATABASE_URL` falls back to `./.pglite`, and nothing else is needed to migrate.

`seed.ts` is idempotent, and it refuses any address that isn't on `AUTH_ALLOWED_EMAILS` — the allowlist gates seeding too, not just sign-in.

`pnpm dev` binds `127.0.0.1` rather than every interface, and that is load-bearing rather than tidy — see Auth. Don't drop the `--hostname` flag from the script.

## Auth

`AUTH_ALLOWED_EMAILS` is a comma-separated, case-insensitive list, and on any deployment it is the single gate. An empty list admits nobody; the failure mode is closed.

The list is checked in three places: the `signIn` callback, the `authorized` callback on every request (so striking an address evicts that session immediately, even under JWT), and `seedAdmin`. The first two ask one function — `admits()` in `src/lib/admission.ts` — which is where the single exception below lives. `seedAdmin` calls `isAllowed()` straight, and has no exception at all: there is no way to seed an unlisted address.

Two providers exist. A Nodemailer magic link, which loads only when `AUTH_EMAIL_SERVER` is set, is the only production path, and it runs the allowlist. A development credentials shim, which loads only when `NODE_ENV=development` **and** `AUTH_DEV_LOGIN=1`, is the one bypass: it signs in **any** address you type, with no mail server, no allowlist, and nothing proving you control it.

So in that mode the thing standing in front of the rider names is not the shim — it is the loopback bind. `pnpm dev` binds `127.0.0.1`, so the instance the shim admits people to is reachable from nowhere but the machine running it. The bind and the bypass are one decision and land together.

The bypass is unreachable from a deployment, and not on a token's word: `admits()` re-reads the environment before honouring the shim's provider claim, so `NODE_ENV=production` turns the branch off whatever a cookie carries. A leaked or reused `AUTH_SECRET` cannot be replayed into an allowlist bypass on a hosted instance.

The middleware must stay at `src/middleware.ts`. Move it to the repo root and Next silently stops loading it, which fails open.

## Database

PGlite locally — a WASM Postgres that writes to a `.pglite/` **directory**, not a file, and is gitignored. `DATABASE_URL` defaults to `./.pglite`. Neon is the intended hosted target, but that path isn't wired up yet: `createDb()` currently throws on a `postgres://` URL.

Schema lives in `src/lib/db/schema.ts`; migrations in `src/lib/db/migrations/`. The five domain views — `v_individual_result`, `v_race_result`, `v_rider_result`, `v_club_result`, and `v_unmapped_rider` — are hand-written SQL in `0001_domain_views.sql`. Drizzle generates the tables, but the views are maintained by hand, so edit that file directly rather than expecting `db:generate` to produce them.

## Scripts

| Command                             | What it does                                                       |
| ----------------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                          | Next dev server, bound to `127.0.0.1`                              |
| `pnpm build` / `pnpm start`         | Production build and serve                                         |
| `pnpm test`                         | Vitest, once                                                       |
| `pnpm test:local`                   | The local-only lane, which reads the corpus                        |
| `pnpm privacy:check`                | Fail if payload-shaped data is committed                           |
| `pnpm test:watch`                   | Vitest, watching                                                   |
| `pnpm typecheck`                    | `tsc --noEmit`                                                     |
| `pnpm lint`                         | ESLint                                                             |
| `pnpm format` / `pnpm format:check` | Prettier                                                           |
| `pnpm brand:check`                  | Diff the vendored brand tokens against source                      |
| `pnpm db:generate`                  | Generate a migration from the schema                               |
| `pnpm db:migrate`                   | Apply migrations                                                   |
| `pnpm db:studio`                    | Drizzle Studio                                                     |
| `pnpm seed`                         | Seed the club config and the first admin                           |
| `pnpm fetch`                        | Pull from RaceResult — live network, read `docs/fixtures.md` first |
| `pnpm normalize --load-fixtures`    | Archive the local corpus into `raw_fetch`                          |
| `pnpm normalize`                    | Decode that archive into the result tables                         |

## Testing

Tests sit beside the source they cover, as `*.test.ts`. `src/lib/db/testing.ts` exports `createTestDb()`, which boots a fresh, fully-migrated in-memory PGlite per suite — real Postgres, no mocks, which is why the timeouts are 60s.

```bash
pnpm test
```

There are **two lanes, split by what a test reads.** `pnpm test` reads only code and
synthetic data, so it is safe to run anywhere. A test named `*.local.test.ts` reads the
real RaceResult fixture corpus — minors' names, schools, grades and finish times — and
runs only under `pnpm test:local`, never in CI. See
[`docs/fixtures.md`](docs/fixtures.md) for the corpus, and for the pre-commit hook that
`pnpm install` arms to stop those payloads ever being committed.

## CI

`.github/workflows/ci.yml` runs on every pull request into `dev` and `main`: the privacy
guard first, then `typecheck`, `lint`, `format:check` and `test`, then a migration-drift
check and a fresh-database migration. Node comes from `.nvmrc` — one line, deliberately
not a matrix, because this app runs on one runtime.

CI never runs `pnpm test:local`, `pnpm fetch`, `pnpm normalize` or `pnpm seed`, and
**scheduled ingest must never be added while this repo is public**: `bin/fetch.ts` pulls
minors' names from a live API. The workflow says so at the top of the file, and
`scripts/ci-workflow.test.ts` holds it.

## Contributing

Branching runs feature → `dev` → `main`. Feature branches (`feat/*`, `fix/*`) cut from `dev` and PR back into it; `dev` PRs into `main` for a release. Nothing lands on `main` directly.

Work is tracked as GitHub issues on `stonematt/bike_race_results`. The triage vocabulary and the agent conventions are documented in `docs/agents/`.

Before designing anything, read three files. [`CONTEXT.md`](CONTEXT.md) is the glossary and is authoritative on domain words — get `conference` and `division` wrong and the model goes with it. [`docs/adr/`](docs/adr/) holds the decisions that are expensive to reverse. [`docs/ux/moments.md`](docs/ux/moments.md) carries the who-by-when frame, the seven moments a coach moves through, and the job stories each view answers. The wayfinder map (`gh issue list --label "wayfinder:map"`) holds what is still foggy.

Read [`docs/brand.md`](docs/brand.md) before building any UI. It holds the rules that constrain code — ink on orange and never white, orange as a highlight rather than a field, navy ground for the banner — plus the fonts, the asset policy, and how to reskin the app for another club. The tokens themselves are vendored into the `@theme` block of `src/app/globals.css` and covered by unit tests, so everything you need is in this repo; `pnpm brand:check` diffs the copy against the upstream design system for whoever has it, and exits 0 for everyone who doesn't.

## License

MIT. See [LICENSE](LICENSE).
