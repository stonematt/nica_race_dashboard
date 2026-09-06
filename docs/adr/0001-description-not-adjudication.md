# Description, not adjudication

The app already derives percent back, lapped-ness and a field percentile, so "NICA is the
scoring authority, never recompute" needed a real edge rather than a slogan. The line we
drew: we compute **description** — anything recomputable from the published rows that
carries no consequence (percent back, lapped, field size, start count, percentile) — and
we never produce **adjudication** — anything the league decides and acts on (season
points, season place, category assignment, DQ, State Champs eligibility). Adjudication is
read verbatim or not shown.

The case that forced it is State Champs eligibility, which turns on starts rather than
placings. We show the start count, because counting rows a rider appears in is
description. We do not show "eligible", because the threshold is the league's policy, it
changes between seasons, and being wrong tells a child they cannot race.

`v_race_result` already suppresses the percentile below ten starters. That was the same
instinct before it had a name.
