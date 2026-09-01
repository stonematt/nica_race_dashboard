# nica_race_dashboard

## Agent skills

### Issue tracker

Issues live as GitHub issues on `stonematt/nica_race_dashboard`, via the `gh` CLI. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical label vocabulary, unmodified — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.

## Brand

Design system, logo, and voice live in the sibling repo `../scd-brand` (`scd-brand/DESIGN.md`, status APPROVED). Orange `#FF8000` leads and is used liberally; ink on orange, never white. Anton display / Nunito body. Mascot Milo. Read `DESIGN.md` before building any UI — it is not vendored into this repo.

## Wayfinder

Planning for this project is charted as a wayfinder map on the issue tracker: `gh issue list --label "wayfinder:map"`. Read the map before starting work; it holds the destination, domain vocabulary, and standing decisions.
