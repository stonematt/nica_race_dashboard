# nica_race_dashboard

## Agent skills

### Issue tracker

Issues live as GitHub issues on `stonematt/nica_race_dashboard`, via the `gh` CLI. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical label vocabulary, unmodified — `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` + `docs/adr/` at repo root. See `docs/agents/domain.md`.

## Brand

Read `docs/brand.md` before building any UI. It holds the rules that constrain code, the asset policy for this public repo, and the reskin procedure. Tokens are vendored into `src/app/globals.css`; `pnpm brand:check` diffs them against upstream.

The source design system is `stonematt/scd-brand` (`DESIGN.md`, status APPROVED), which is **private** — do not point a contributor at it.

## Wayfinder

Planning for this project is charted as a wayfinder map on the issue tracker: `gh issue list --label "wayfinder:map"`. Read the map before starting work; it holds the destination, domain vocabulary, and standing decisions.
