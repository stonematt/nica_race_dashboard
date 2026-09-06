# One write path: plate attach

The product reads. The single thing it writes is the attachment of a plate to a Rider —
the join that turns a per-event `BIB` into a person the club knows by name. Everything
else on every surface is published league data or hand-maintained config seeded from
outside the app.

The case that forced the decision was "Discussion". A per-Round note, a per-athlete log
and a read-receipt were each examined during the coach-flow session and each declined.
Discussion is not a surface here; it is a shape constraint on the rider frame, which has
to survive being said aloud. That is a stronger requirement than a comment box, and it
costs no schema.

What the decision buys is the largest privacy simplification available to a product with
twenty volunteer coaches and a roster of minors: no audit trail, no moderation, no edit
history, no role system beyond queue scoping, and no coach-authored text about a minor
anywhere in the database. None of those have to be designed, because none of them have
anything to guard.

What it costs is that nothing carries between September and November except what a coach
holds in their head. That cost is real and it is the signal to revisit: when someone says
"I wish I had written down what we agreed in September", this decision is what they are
running into. The answer then is probably a tool built for it rather than this one.

Recorded as a decision rather than left as an absence, because an absence gets filled in
by whoever touches the schema next.
