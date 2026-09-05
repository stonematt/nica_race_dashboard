# nica_race_dashboard

A race dashboard for the **Salem Composite Descenders**, an Oregon Interscholastic Cycling League (NICA) composite team.

It pulls race results from the RaceResult timing API, normalizes them across races and seasons, and gives coaches the views the official results pages don't: how one rider has progressed, how the club stacks up against the league, and what a squad did on a given Sunday.

The done-condition: _a race posts on a Sunday night and a coach opens the app to see how their riders did._

## Ground rules

**NICA is the scoring authority.** Points, places, ranks, and season totals are ingested verbatim and displayed as published. This app never computes or re-ranks a score. Where the published numbers look wrong, the app shows the published numbers.

**There is no public half.** Race payloads carry the names of minors, so every route sits behind auth, and `next.config.ts` sends `noindex, nofollow, noarchive`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store` on every path.

## Status

Early scaffolding — pre-MVP. What works today:

- schema, migrations, and the five domain views
- the auth gate — every route behind it, and admission re-decided on every request, not just at sign-in
- the `migrate` and `seed` CLIs
- the authenticated shell: a signed-in landing page and a sign-in page, on the vendored brand tokens
- unit suites over the admission rules, the provider wiring and the brand-token check, and integration suites over seeding and the domain views against a real in-memory Postgres

What doesn't exist yet: any page that reads the database, live fetching (`bin/fetch.ts` is a stub), normalization (`bin/normalize.ts` is a stub), and the hosted-database path. Planning is charted on the issue tracker — `gh issue list --label "wayfinder:map"` finds the map, and the map holds the destination, the domain vocabulary, and the standing decisions.

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

Then bring up the database and seed yourself an account:

```bash
pnpm db:migrate
AUTH_ALLOWED_EMAILS=you@example.org \
  node bin/seed.ts --email you@example.org --club "Salem Composite Descenders"
pnpm dev
```

Next loads `.env.local` itself; the `bin/` scripts do not. They run under plain Node, which reads no dotenv file, so anything they need goes on the command line or in the environment — hence the inline variable above. `DATABASE_URL` is the exception only because it defaults to `./.pglite` when unset.

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

| Command                             | What it does                                  |
| ----------------------------------- | --------------------------------------------- |
| `pnpm dev`                          | Next dev server, bound to `127.0.0.1`         |
| `pnpm build` / `pnpm start`         | Production build and serve                    |
| `pnpm test`                         | Vitest, once                                  |
| `pnpm test:local`                   | The local-only lane, which reads the corpus   |
| `pnpm test:watch`                   | Vitest, watching                              |
| `pnpm typecheck`                    | `tsc --noEmit`                                |
| `pnpm lint`                         | ESLint                                        |
| `pnpm format` / `pnpm format:check` | Prettier                                      |
| `pnpm brand:check`                  | Diff the vendored brand tokens against source |
| `pnpm db:generate`                  | Generate a migration from the schema          |
| `pnpm db:migrate`                   | Apply migrations                              |
| `pnpm db:studio`                    | Drizzle Studio                                |
| `pnpm seed`                         | Seed the first admin (see above)              |
| `pnpm fetch`                        | Pull from RaceResult _(stub)_                 |
| `pnpm normalize`                    | Normalize raw payloads _(stub)_               |

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

## Contributing

Branching runs feature → `dev` → `main`. Feature branches (`feat/*`, `fix/*`) cut from `dev` and PR back into it; `dev` PRs into `main` for a release. Nothing lands on `main` directly.

Work is tracked as GitHub issues on `stonematt/nica_race_dashboard`. The triage vocabulary and the agent conventions are documented in `docs/agents/`.

Read [`docs/brand.md`](docs/brand.md) before building any UI. It holds the rules that constrain code — ink on orange and never white, orange as a highlight rather than a field, navy ground for the banner — plus the fonts, the asset policy, and how to reskin the app for another club. The tokens themselves are vendored into the `@theme` block of `src/app/globals.css` and covered by unit tests, so everything you need is in this repo; `pnpm brand:check` diffs the copy against the upstream design system for whoever has it, and exits 0 for everyone who doesn't.

## License

MIT. See [LICENSE](LICENSE).
