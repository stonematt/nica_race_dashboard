# Two trees, joined at scoring team

The domain looks like one hierarchy and is not. The league's tree — league, conference,
scoring team, rider — is published, authoritative and read-only here. The club's tree —
club, squad, rider — is ours, edited by coaches, and deliberately cuts across the other:
a squad spans scoring teams by design, and `club -> scoring_team` is one-to-many and
season-keyed, because the composite-subdivision rule (5+ riders from one school forces a
split the next year) makes those strings unstable across seasons.

We keep them as two trees joined at scoring team rather than forcing club under
conference. Forcing one hierarchy would make club season-scoped, which breaks every
cross-season view, and it would merge read-only truth with editable config into tables
that then have to lie for each other.

Two consequences worth stating. Navigation is really two who-axes, and the coach's most
important move — from "my squad" to "versus the field" — is the crossing at scoring team.
And `division` is not a level in either tree: it is NICA's team-scoring bracket, an
attribute of a team's result at an event, sitting beside place and points.
