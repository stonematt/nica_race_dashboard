# Fixture corpus

The ingest work is backed by a complete local corpus of RaceResult payloads: the whole
2025 Oregon League season plus the 2026 opener. Fetching it took a deliberately slow,
polite crawl of a volunteer-run nonprofit's timing vendor — **do not re-fetch what is
already here.**

## Where it lives

In the tree, at `fixtures/`, ignored by git and blocked by a pre-commit hook.

```
fixtures/
├── 2025/    62 files — 8 events, every published list, plus decode summaries
└── 2026/     2 files — event 418436 (Race 1 Old Oak Prologue, 08/30/2026)
```

It is **not** committed and never will be. `.gitignore` lists `fixtures/`; the hook
described below is what makes that stick.

Two things stayed outside the tree, because nothing in the repo reads them
programmatically:

```
~/.local/share/nica_race_dashboard/
├── refs/        Oregon NICA Handbook + 2026 Category Placement Table (PDF + text)
└── analysis/    Full resolution write-ups for the closed wayfinder tickets
```

That directory also still holds the original `fixtures/`. The in-tree copy was copied, not
moved, and either one is fine to copy from.

### Reaching it from code

`src/lib/fixtures.ts`. It resolves the corpus from its own module location, so there is no
environment variable to export and no path to hunt for:

```ts
import { corpusPath, requireCorpus } from '@/lib/fixtures.ts';

requireCorpus(); // throws a message pointing here if the corpus is absent
const config = corpusPath('2026', 'config-418436.json');
```

`corpusPath()` refuses a path that climbs out of `fixtures/`. Do not add an environment
override — reintroducing machine-local configuration is exactly what
[#30](https://github.com/stonematt/nica_race_dashboard/issues/30) removed.

### Getting a copy

Copy `fixtures/` from another checkout of yours, or from
`~/.local/share/nica_race_dashboard/fixtures/`. Without it, `pnpm test` still passes in
full; only `pnpm test:local` needs it.

## Why it is ignored rather than committed

**This repository is public and the payloads contain minors' full names, schools, grades
and finish times.** The privacy ceiling set in
[#3](https://github.com/stonematt/nica_race_dashboard/issues/3) is that named data is
never rendered without auth and never leaves a local file without an explicit decision.

The corpus used to live outside the working tree entirely, which made an accidental
`git add` impossible as a matter of physics. It moved in-tree because that cost every
session a path hunt, did not survive a laptop rebuild alongside the code, and made the
fidelity suite depend on machine-local configuration. The physical guarantee was replaced
with a mechanical one, not with discipline:

- `.gitignore` carries `fixtures/`, which stops an ordinary `git add`
- `scripts/git-hooks/pre-commit` reads the **index** and rejects any commit that stages a
  path under `fixtures/`. Because it reads the index, `git add -f` does not get past it
- `pnpm install` runs `scripts/install-git-hooks.mjs`, which points `core.hooksPath` at
  `scripts/git-hooks`. A fresh clone is armed by its first install, with no setup step

If you already have a `core.hooksPath` of your own, the installer says so and leaves it
alone — the block is then **not** active, and you should chain
`scripts/git-hooks/pre-commit` from your own hook.

Anything derived from these payloads that _does_ get committed — schema notes, worked
examples, test fixtures — must have rider names redacted first. The pattern used in the
issue threads is stable pseudonyms (`«RIDER-A»`), which keeps worked calculations
verifiable while carrying no identity.

## Tests: two lanes, split by what they read

| lane       | command           | reads                        | runs in CI |
| ---------- | ----------------- | ---------------------------- | ---------- |
| default    | `pnpm test`       | code and synthetic data only | yes        |
| local-only | `pnpm test:local` | the real corpus              | **never**  |

A test file named `*.local.test.ts` is in the local lane. The default config excludes that
glob by name and `vitest.local.config.ts` is the only thing that includes it, so a
fidelity test lands outside the default suite by construction rather than by someone
remembering. `scripts/test-lanes.test.ts` asks vitest which files each lane collects and
fails if that ever stops being true.

The split, and the decision not to run fidelity tests in CI at all, is
[#29](https://github.com/stonematt/nica_race_dashboard/issues/29). Encrypted fixtures with
a CI secret were considered and rejected: full coverage is not worth putting minors' data
one leaked secret away from a public repo. Drift detection runs in CI instead, against a
committed shape corpus with no rows in it
([#31](https://github.com/stonematt/nica_race_dashboard/issues/31)).

## If payloads ever get committed

Treat it as a data disclosure, not a bad commit. **A credential can be rotated; a
fourteen-year-old's name and school cannot.** Assume anything pushed to a public repo was
fetched, mirrored and indexed within minutes.

1. **Stop.** Do not push anything else, and do not open a public issue describing the
   problem — the issue tracker is public too.
2. **Get it out of history**, not just out of `HEAD`. A revert commit leaves the payload
   fully readable in the parent. Rewrite with
   `git filter-repo --path fixtures/ --invert-paths`, force-push every affected branch, and
   rewrite any tag that carries it.
3. **Ask GitHub to purge what a rewrite leaves behind.** The old objects stay reachable by
   SHA and served by the API, and any fork keeps its own copy. Contact GitHub Support to
   have the stale refs and forks removed; this is the step people skip.
4. **Tell the league.** The data belongs to the riders and their families, and the Oregon
   league is who has a relationship with them. That call is the coach's to make, with the
   facts you can give: which events, which lists, and how long it was public.
5. **Then fix the hole.** Find out how it got past the hook — bypassed with `--no-verify`,
   never installed because `core.hooksPath` was taken, or a path the hook does not guard —
   and close that specific gap.

Note what is _not_ on this list: rotating a secret. There is nothing to rotate.

## Re-fetching

Two GETs per event; see
[#2](https://github.com/stonematt/nica_race_dashboard/issues/2) and its 2026 addendum for
the exact sequence. **Note that 2025 and 2026 use different paths** — the 2026 config
endpoint moved, and the list catalog moved inside the config. Be polite: serial requests,
real User-Agent, 3s spacing, back off on any non-200.
