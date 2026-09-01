# Fixture corpus

The ingest work is backed by a complete local corpus of RaceResult payloads: the whole
2025 Oregon League season plus the 2026 opener. Fetching it took a deliberately slow,
polite crawl of a volunteer-run nonprofit's timing vendor — **do not re-fetch what is
already here.**

## Where it lives, and why it is not in this repo

```
~/.local/share/nica_race_dashboard/
├── fixtures/2025/    62 files — 8 events, every published list, plus decode summaries
├── fixtures/2026/     2 files — event 418436 (Race 1 Old Oak Prologue, 08/30/2026)
├── refs/              Oregon NICA Handbook + 2026 Category Placement Table (PDF + text)
└── analysis/          Full resolution write-ups for the closed wayfinder tickets
```

**This repository is public and the payloads contain minors' full names, schools, grades
and finish times.** The privacy ceiling set in
[#3](https://github.com/stonematt/nica_race_dashboard/issues/3) is that named data is
never rendered without auth and never leaves a local file without an explicit decision.
Storing the corpus outside the working tree makes an accidental `git add` impossible,
rather than relying on `.gitignore` holding the line on a public repo.

Anything derived from these payloads that _does_ get committed — schema notes, worked
examples, test fixtures — must have rider names redacted first. The pattern used in the
issue threads is stable pseudonyms (`«RIDER-A»`), which keeps worked calculations
verifiable while carrying no identity.

## Re-fetching

Two GETs per event; see
[#2](https://github.com/stonematt/nica_race_dashboard/issues/2) and its 2026 addendum for
the exact sequence. **Note that 2025 and 2026 use different paths** — the 2026 config
endpoint moved, and the list catalog moved inside the config. Be polite: serial requests,
real User-Agent, 3s spacing, back off on any non-200.
