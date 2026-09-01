CREATE TABLE "account" (
	"userId" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"refresh_token" text,
	"access_token" text,
	"expires_at" integer,
	"token_type" text,
	"scope" text,
	"id_token" text,
	"session_state" text,
	CONSTRAINT "account_provider_providerAccountId_pk" PRIMARY KEY("provider","providerAccountId")
);
--> statement-breakpoint
CREATE TABLE "club" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "club_scoring_team" (
	"club_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"scoring_team" text NOT NULL,
	CONSTRAINT "club_scoring_team_club_id_season_id_scoring_team_pk" PRIMARY KEY("club_id","season_id","scoring_team")
);
--> statement-breakpoint
CREATE TABLE "coach" (
	"user_id" text PRIMARY KEY NOT NULL,
	"club_id" integer NOT NULL,
	"display_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event" (
	"id" serial PRIMARY KEY NOT NULL,
	"round_id" integer NOT NULL,
	"source_event_id" text NOT NULL,
	"conference" text,
	"name" text NOT NULL,
	"date" date
);
--> statement-breakpoint
CREATE TABLE "individual_result" (
	"event_id" integer NOT NULL,
	"plate" text NOT NULL,
	"source_row_id" text,
	"display_name" text NOT NULL,
	"scoring_team" text NOT NULL,
	"category_raw" text NOT NULL,
	"category_level" text,
	"category_grade_band" text,
	"category_gender" text,
	"conference" text,
	"place" text NOT NULL,
	"status" text NOT NULL,
	"time_raw" text NOT NULL,
	"time_seconds" numeric,
	"points" integer,
	"laps" integer,
	"lap1" text,
	"lap2" text,
	"lap3" text,
	"lap4" text,
	"penalty" text,
	"pts_leader" boolean DEFAULT false NOT NULL,
	CONSTRAINT "individual_result_event_id_plate_pk" PRIMARY KEY("event_id","plate")
);
--> statement-breakpoint
CREATE TABLE "individual_result_by_team" (
	"event_id" integer NOT NULL,
	"plate" text NOT NULL,
	"source_row_id" text,
	"display_name" text NOT NULL,
	"team_place" text,
	"place" text,
	"category_raw" text,
	"gender" text,
	"grade" text,
	"points" integer,
	"lap1" text,
	"lap2" text,
	"lap3" text,
	"lap4" text,
	"lap5" text,
	"penalty" text,
	"time_raw" text,
	"scored" boolean DEFAULT false NOT NULL,
	CONSTRAINT "individual_result_by_team_event_id_plate_pk" PRIMARY KEY("event_id","plate")
);
--> statement-breakpoint
CREATE TABLE "raw_fetch" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"season" integer NOT NULL,
	"event_id" text NOT NULL,
	"list_id" text,
	"list_name" text NOT NULL,
	"url" text NOT NULL,
	"http_status" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rider" (
	"id" serial PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "rider_plate" (
	"id" serial PRIMARY KEY NOT NULL,
	"rider_id" integer NOT NULL,
	"season_id" integer NOT NULL,
	"plate" text NOT NULL,
	"from_round_ordinal" integer,
	"to_round_ordinal" integer
);
--> statement-breakpoint
CREATE TABLE "round" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"ordinal" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season" (
	"id" serial PRIMARY KEY NOT NULL,
	"year" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season_individual_race_points" (
	"standing_id" integer NOT NULL,
	"round_ordinal" integer NOT NULL,
	"points" text,
	"is_dropped" boolean DEFAULT false NOT NULL,
	"is_upgrade" boolean DEFAULT false NOT NULL,
	CONSTRAINT "season_individual_race_points_standing_id_round_ordinal_pk" PRIMARY KEY("standing_id","round_ordinal")
);
--> statement-breakpoint
CREATE TABLE "season_individual_standing" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"conference" text,
	"plate" text NOT NULL,
	"display_name" text NOT NULL,
	"scoring_team" text,
	"category_raw" text,
	"season_place" text,
	"best_of" text,
	"low_score" integer,
	"bonus_total" integer,
	"final" integer,
	"source_event_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "season_team_standing" (
	"season_id" integer NOT NULL,
	"conference" text,
	"scoring_team" text NOT NULL,
	"division" text,
	"place" text,
	"race_points" jsonb,
	"season_total" integer,
	"source_event_id" text NOT NULL,
	CONSTRAINT "season_team_standing_season_id_conference_scoring_team_pk" PRIMARY KEY("season_id","conference","scoring_team")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"sessionToken" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"expires" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "squad" (
	"id" serial PRIMARY KEY NOT NULL,
	"club_id" integer NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "squad_coach" (
	"squad_id" integer NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "squad_coach_squad_id_user_id_pk" PRIMARY KEY("squad_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "squad_member" (
	"squad_id" integer NOT NULL,
	"rider_id" integer NOT NULL,
	CONSTRAINT "squad_member_squad_id_rider_id_pk" PRIMARY KEY("squad_id","rider_id")
);
--> statement-breakpoint
CREATE TABLE "team_race_counter" (
	"event_id" integer NOT NULL,
	"plate" text NOT NULL,
	"level" text,
	"division" text,
	"scoring_team" text NOT NULL,
	"team_place" text,
	"team_points" integer,
	"team_penalty_points" integer,
	"display_name" text,
	"individual_points" integer,
	"gender" text,
	"type" text,
	"category_raw" text,
	CONSTRAINT "team_race_counter_event_id_plate_pk" PRIMARY KEY("event_id","plate")
);
--> statement-breakpoint
CREATE TABLE "team_race_result" (
	"event_id" integer NOT NULL,
	"scoring_team" text NOT NULL,
	"division" text,
	"place" text,
	"penalty_points" integer,
	"points" integer,
	CONSTRAINT "team_race_result_event_id_scoring_team_pk" PRIMARY KEY("event_id","scoring_team")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"emailVerified" timestamp,
	"image" text
);
--> statement-breakpoint
CREATE TABLE "verificationToken" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp NOT NULL,
	CONSTRAINT "verificationToken_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_scoring_team" ADD CONSTRAINT "club_scoring_team_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "club_scoring_team" ADD CONSTRAINT "club_scoring_team_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach" ADD CONSTRAINT "coach_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event" ADD CONSTRAINT "event_round_id_round_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."round"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "individual_result" ADD CONSTRAINT "individual_result_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "individual_result_by_team" ADD CONSTRAINT "individual_result_by_team_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_plate" ADD CONSTRAINT "rider_plate_rider_id_rider_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."rider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rider_plate" ADD CONSTRAINT "rider_plate_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "round" ADD CONSTRAINT "round_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_individual_race_points" ADD CONSTRAINT "season_individual_race_points_standing_id_season_individual_standing_id_fk" FOREIGN KEY ("standing_id") REFERENCES "public"."season_individual_standing"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_individual_standing" ADD CONSTRAINT "season_individual_standing_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_team_standing" ADD CONSTRAINT "season_team_standing_season_id_season_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."season"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad" ADD CONSTRAINT "squad_club_id_club_id_fk" FOREIGN KEY ("club_id") REFERENCES "public"."club"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_coach" ADD CONSTRAINT "squad_coach_squad_id_squad_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squad"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_member" ADD CONSTRAINT "squad_member_squad_id_squad_id_fk" FOREIGN KEY ("squad_id") REFERENCES "public"."squad"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "squad_member" ADD CONSTRAINT "squad_member_rider_id_rider_id_fk" FOREIGN KEY ("rider_id") REFERENCES "public"."rider"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_race_counter" ADD CONSTRAINT "team_race_counter_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_race_result" ADD CONSTRAINT "team_race_result_event_id_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."event"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "club_name_key" ON "club" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "event_source_event_id_key" ON "event" USING btree ("source_event_id");--> statement-breakpoint
CREATE INDEX "individual_result_scoring_team_idx" ON "individual_result" USING btree ("scoring_team");--> statement-breakpoint
CREATE INDEX "individual_result_category_idx" ON "individual_result" USING btree ("event_id","category_raw");--> statement-breakpoint
CREATE INDEX "raw_fetch_lookup_idx" ON "raw_fetch" USING btree ("event_id","list_id","fetched_at");--> statement-breakpoint
CREATE INDEX "rider_plate_lookup_idx" ON "rider_plate" USING btree ("season_id","plate");--> statement-breakpoint
CREATE UNIQUE INDEX "round_season_ordinal_key" ON "round" USING btree ("season_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "season_year_key" ON "season" USING btree ("year");--> statement-breakpoint
CREATE UNIQUE INDEX "season_standing_key" ON "season_individual_standing" USING btree ("season_id","conference","plate");