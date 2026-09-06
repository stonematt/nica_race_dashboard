import { notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth.ts';
import { appDb } from '@/app/db.ts';
import { SquadSection, UnmappedWarning } from '@/components/RaceDetail.tsx';
import { loadRaceDetail, type RaceDetail } from '@/app/races/[eventId]/query.ts';
import { resolveSeasonByYear } from '../../query.ts';
import { listRoundEvents, resolveRound, type RoundEvent } from './query.ts';

/**
 * A Round, as a navigable place — `/<year>/round/<ordinal>` (issue #35).
 *
 * The load-bearing fact: a Round is not an Event. The league publishes one
 * Event per Conference — or a single Event when the whole league rides
 * together, at the Prologue and State Champs (`CONTEXT.md`, Round). So this
 * page does not have its own idea of what a field looks like:
 *
 *   - One Event: the existing race-detail rendering (`loadRaceDetail`,
 *     `SquadSection`, `UnmappedWarning` — all from `src/components/RaceDetail.tsx`
 *     and `src/app/races/[eventId]/query.ts`) is reused as-is, per Event.
 *   - More than one Event: each Event's field is rendered in its own section,
 *     and the page states in words that the Round was raced as separate
 *     Conference events — never a silent concatenation into one field.
 *
 * The season segment above already guards an unknown year
 * (`src/app/[season]/layout.tsx`); the re-check here is defensive, matching
 * `[season]/page.tsx`. An ordinal that names no Round in this Season is a
 * real not-found — there is no partial rendering of "no such round".
 *
 * `force-dynamic` for the same reason as the race-detail and season pages: it
 * reads a database and a session per request, and nothing in front of it may
 * cache a response shaped around one coach's session (issue #3).
 */
export const dynamic = 'force-dynamic';

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  if (words.length === 2) return `${words[0]} and ${words[1]}`;
  return `${words.slice(0, -1).join(', ')}, and ${words[words.length - 1]}`;
}

/** One Event's field, drawn with the same components the race-detail page uses. */
function EventSection({
  event,
  detail,
  split,
}: {
  event: RoundEvent;
  detail: RaceDetail;
  split: boolean;
}) {
  const raced = detail.squads.reduce((n, squad) => n + squad.riders.length, 0);

  return (
    <section className="mt-8">
      {split ? (
        <>
          <h2 className="font-display text-2xl tracking-wide uppercase">
            {event.conference ? `${event.conference} conference` : event.name}
          </h2>
          {event.conference ? <p className="text-muted text-xs">{event.name}</p> : null}
        </>
      ) : null}

      <p className="text-muted mt-1 text-sm">
        {detail.starters} started · {raced} from {detail.club?.name ?? 'the club'}
      </p>

      <UnmappedWarning riders={detail.unmapped} />

      {detail.club === null ? (
        <p className="border-border bg-surface text-muted mt-8 rounded-lg border p-5 text-sm">
          Your account is not linked to a club, and there is more than one to choose from. Add a
          coach profile for this address and reload.
        </p>
      ) : detail.squads.length === 0 ? (
        <p className="border-border bg-surface text-muted mt-8 rounded-lg border p-5 text-sm">
          No squads are configured for {detail.club.name}. Squads come from{' '}
          <code>config/club-seed.json</code> and land with <code>pnpm seed</code>.
        </p>
      ) : (
        detail.squads.map((squad) => <SquadSection key={squad.name} squad={squad} />)
      )}
    </section>
  );
}

export default async function RoundPage({
  params,
}: {
  params: Promise<{ season: string; ordinal: string }>;
}) {
  const { season: seasonSegment, ordinal } = await params;
  const db = appDb();

  const season = await resolveSeasonByYear(db, seasonSegment);
  if (season === null) notFound();

  const round = await resolveRound(db, season.id, ordinal);
  if (round === null) notFound();

  const session = await auth();
  const events = await listRoundEvents(db, round.id);
  const details = await Promise.all(
    events.map((evt) => loadRaceDetail(db, evt.sourceEventId, session?.user?.id ?? null)),
  );

  const split = events.length > 1;
  const conferences = events.map((evt) => evt.conference).filter((c): c is string => c !== null);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <p className="text-muted text-xs font-bold tracking-wider uppercase">
        <Link href={`/${season.year}`} className="hover:text-accent underline">
          {season.year} season
        </Link>
      </p>
      <h1 className="font-display mt-1 text-4xl tracking-wide uppercase">{round.name}</h1>
      {!split && events.length === 1 ? (
        <p className="text-muted mt-1 text-sm">{events[0]!.name}</p>
      ) : null}

      {events.length === 0 ? (
        <p className="border-border bg-surface text-muted mt-8 rounded-lg border p-5 text-sm">
          Nothing ingested yet for this round.
        </p>
      ) : split ? (
        <p className="border-border bg-surface text-muted mt-4 max-w-2xl rounded-lg border p-4 text-sm">
          This round was raced as {events.length} separate conference events
          {conferences.length === events.length ? <> — {joinWords(conferences)}</> : null}. Each is
          shown below with its own field, not combined into one.
        </p>
      ) : null}

      {events.map((evt, i) => {
        const detail = details[i];
        if (detail === null || detail === undefined) {
          return (
            <p
              key={evt.sourceEventId}
              className="border-border bg-surface text-muted mt-8 rounded-lg border p-5 text-sm"
            >
              {evt.name} has not been ingested yet.
            </p>
          );
        }
        return <EventSection key={evt.sourceEventId} event={evt} detail={detail} split={split} />;
      })}
    </main>
  );
}
