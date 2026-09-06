-- Season-key the club roster and the squads. (#81)
--
-- Club membership was reachable only as `squad_member -> squad -> club`, and
-- both hops were current-state. So "how did the Descenders do in 2022" answered
-- with *today's* roster: a rider who has since graduated vanished from their own
-- seasons, and a rider who joined this year appeared in races they never rode.
--
-- Two changes, no view touches either. `club_scoring_team` already season-keys
-- the league's name for a club; nothing season-keyed who the club *was*:
--
--   club  --season-keyed-->  scoring_team   (already existed)
--   club  --season-keyed-->  rider          (club_member, new here)
--   squad --season-keyed-->  rider          (via squad.season_id)
--
-- `club` itself stays season-independent. Making it season-scoped is the thing
-- ADR-0002 explicitly refuses, because it breaks every cross-season view. Only
-- membership carries the year.
--
-- No view is replaced. `v_club_result` and `v_unmapped_rider` resolve a club
-- through `club_scoring_team`, never through squads, so the five domain views in
-- 0001/0002 are untouched by this. Reads over the new roster arrive with #82 and
-- #18; writes with #79.

--------------------------------------------------------------------------------
-- club_member — the season-keyed roster
--
-- The key is (club, season, rider) rather than (season, rider), so a rider may
-- hold rows for two clubs in one season. That is a mid-season transfer, and both
-- reads need it: the club a rider left reads by (club, season) and still sees
-- them in the years they rode; the club they joined reads by rider and gets
-- their whole career.
--------------------------------------------------------------------------------
CREATE TABLE "club_member" (
	"club_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"rider_id" integer NOT NULL,
	CONSTRAINT "club_member_club_id_season_id_rider_id_pk" PRIMARY KEY("club_id","season_id","rider_id")
);
--> statement-breakpoint
ALTER TABLE "club_member" ADD CONSTRAINT "club_member_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_member" ADD CONSTRAINT "club_member_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_member" ADD CONSTRAINT "club_member_rider_id_rider_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."rider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- The by-rider read: a rider's club history, including across a transfer.
CREATE INDEX "club_member_rider_idx" ON "club_member" USING btree ("rider_id");--> statement-breakpoint

--------------------------------------------------------------------------------
-- squad.season_id — added in three steps, not one
--
-- drizzle-kit generates a single `ADD COLUMN ... NOT NULL`, which aborts against
-- any database that already has squads — which is every seeded dev database. Add
-- it nullable, backfill, then constrain.
--
-- The backfill is not a guess. `seed_club_config` writes a club's scoring teams
-- and its squads in one transaction from one config file, and a config file
-- carries exactly one season, so the latest season a club has scoring teams for
-- is the season its existing squads were written under. Where a club has none —
-- reachable only by hand-inserting a squad, never by seeding — fall back to the
-- latest season on record.
--
-- Deliberately no `coalesce(..., <invented season>)`: if a squad resolves to no
-- season at all, SET NOT NULL fails and says so. A squad implies a seeded club
-- implies a season, so that failure is real corruption and should not be papered
-- over with a default.
--------------------------------------------------------------------------------
ALTER TABLE "squad" ADD COLUMN "season_id" integer;--> statement-breakpoint
UPDATE "squad" s SET "season_id" = coalesce(
	(select max(cst."season_id") from "club_scoring_team" cst where cst."club_id" = s."club_id"),
	(select max("id") from "season")
);--> statement-breakpoint
ALTER TABLE "squad" ALTER COLUMN "season_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "squad" ADD CONSTRAINT "squad_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- New: nothing previously stopped two squads sharing a name in one club. Seed's
-- select-then-insert did, by convention only.
CREATE UNIQUE INDEX "squad_club_season_name_key" ON "squad" USING btree ("club_id","season_id","name");
