# nica_race_dashboard

A race dashboard for the **Salem Composite Descenders**, an Oregon Interscholastic Cycling League (NICA) composite team.

It pulls race results from the RaceResult timing API, normalizes them across races and seasons, and gives coaches the views the official results pages don't: how one rider has progressed, how the club stacks up against the league, and what a squad did on a given Sunday.

The done-condition: _a race posts on a Sunday night and a coach opens the app to see how their riders did._

## Ground rules

**NICA is the scoring authority.** Points, places, ranks, and season totals are ingested verbatim and displayed as published. This app never computes or re-ranks a score. Where the published numbers look wrong, the app shows the published numbers.

**There is no public half.** Race payloads carry the names of minors, so every route sits behind auth, and `next.config.ts` sends `noindex, nofollow, noarchive`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store` on every path.

## Status

Early scaffolding — pre-MVP. What works today:

- schema, migrations, and the domain views
- the auth gate (allowlist enforced on every request)
- the `migrate` and `seed` CLIs
- four test suites against a real in-memory Postgres

What doesn't exist yet: any UI page, live fetching (`bin/fetch.ts` is a stub), normalization (`bin/normalize.ts` is a stub), and the hosted-database path. Planning is charted on the issue tracker — `gh issue list --label "wayfinder:map"` finds the map, and the map holds the destination, the domain vocabulary, and the standing decisions.

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

| Variable              | What to put there                                              |
| --------------------- | -------------------------------------------------------------- |
| `AUTH_SECRET`         | Generate one: `npx auth secret`                                |
| `AUTH_ALLOWED_EMAILS` | Your own address. Comma-separated; this list is the only gate. |
| `AUTH_DEV_LOGIN`      | `1`, to sign in locally without a mail server.                 |

Then bring up the database and seed yourself an account:

```bash
pnpm db:migrate
node bin/seed.ts --email you@example.org --club "Salem Composite Descenders"
pnpm dev
```

`seed.ts` is idempotent, and it refuses any address that isn't already on `AUTH_ALLOWED_EMAILS` — the allowlist gates seeding too, not just sign-in.

## Auth

`AUTH_ALLOWED_EMAILS` is a comma-separated, case-insensitive list, and it is the single gate. An empty list admits nobody; the failure mode is closed.

It is checked in three places: the `signIn` callback, the `authorized` callback on every request (so striking an address evicts that session immediately, even under JWT), and `seedAdmin`. Two providers exist — a Nodemailer magic link, which loads only when `AUTH_EMAIL_SERVER` is set, and a development credentials shim, which loads only when `NODE_ENV=development` **and** `AUTH_DEV_LOGIN=1`. The dev shim still enforces the allowlist, and it refuses to load in production.

The middleware must stay at `src/middleware.ts`. Move it to the repo root and Next silently stops loading it, which fails open.

## Database

PGlite locally — a WASM Postgres that writes to a `.pglite/` **directory**, not a file, and is gitignored. `DATABASE_URL` defaults to `./.pglite`. Neon is the intended hosted target, but that path isn't wired up yet: `createDb()` currently throws on a `postgres://` URL.

Schema lives in `src/lib/db/schema.ts`; migrations in `src/lib/db/migrations/`. The domain views (`v_individual_result`, `v_race_result`, `v_unmapped_rider`) are hand-written SQL in `0001_domain_views.sql` — Drizzle generates the tables, but the views are maintained by hand, so edit that file directly rather than expecting `db:generate` to produce them.

## Scripts

| Command                             | What it does                                    |
| ----------------------------------- | ----------------------------------------------- |
| `pnpm dev`                          | Next dev server                                 |
| `pnpm build` / `pnpm start`         | Production build and serve                      |
| `pnpm test`                         | Vitest, once                                    |
| `pnpm test:watch`                   | Vitest, watching                                |
| `pnpm typecheck`                    | `tsc --noEmit`                                  |
| `pnpm lint`                         | ESLint _(no config file yet — see the tracker)_ |
| `pnpm format` / `pnpm format:check` | Prettier                                        |
| `pnpm db:generate`                  | Generate a migration from the schema            |
| `pnpm db:migrate`                   | Apply migrations                                |
| `pnpm db:studio`                    | Drizzle Studio                                  |
| `pnpm seed`                         | Seed the first admin (see above)                |
| `pnpm fetch`                        | Pull from RaceResult _(stub)_                   |
| `pnpm normalize`                    | Normalize raw payloads _(stub)_                 |

## Testing

Tests sit beside the source they cover, as `*.test.ts`. `src/lib/db/testing.ts` exports `createTestDb()`, which boots a fresh, fully-migrated in-memory PGlite per suite — real Postgres, no mocks, which is why the timeouts are 60s.

```bash
pnpm test
```

## Contributing

Branching runs feature → `dev` → `main`. Feature branches (`feat/*`, `fix/*`) cut from `dev` and PR back into it; `dev` PRs into `main` for a release. Nothing lands on `main` directly.

Work is tracked as GitHub issues on `stonematt/nica_race_dashboard`. The triage vocabulary and the agent conventions are documented in `docs/agents/`.

The design system, logo, and voice live in a sibling repo, `../scd-brand` — read `scd-brand/DESIGN.md` before building any UI. It is deliberately not vendored here.

## License

MIT. See [LICENSE](LICENSE).
