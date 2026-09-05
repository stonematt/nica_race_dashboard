import { notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth.ts';
import { appDb } from '@/app/db.ts';
import { Banner } from '@/components/Banner.tsx';
import { SignOutButton } from '@/components/SignOutButton.tsx';
import { SquadSection, UnmappedWarning } from '@/components/RaceDetail.tsx';
import { loadRaceDetail } from './query.ts';

/**
 * One race, read out of the database.
 *
 * The tracer bullet closes here: auth, config, raw, normalize, view and UI on
 * one path for a real archived race. Everything after this widens the path
 * rather than extending it.
 *
 * Behind auth like everything else — `src/middleware.ts` refuses an anonymous
 * request before this file runs, and the session read below is for display and
 * for resolving which coach is asking, not a second gate.
 *
 * `no-store` because the page renders minors' names: nothing about it should
 * sit in a cache, here or in front of it (issue #3, and the headers in
 * `next.config.ts` say the same thing at the response).
 */
export const dynamic = 'force-dynamic';

export default async function RacePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const session = await auth();
  const detail = await loadRaceDetail(appDb(), eventId, session?.user?.id ?? null);

  if (detail === null) notFound();

  const raced = detail.squads.reduce((n, squad) => n + squad.riders.length, 0);

  return (
    <>
      <Banner>
        {session?.user?.email ? <span>{session.user.email}</span> : null}
        <SignOutButton />
      </Banner>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <p className="text-muted text-xs font-bold tracking-wider uppercase">
          <Link href="/races" className="hover:text-accent underline">
            Races
          </Link>{' '}
          · {detail.race.seasonYear} · round {detail.race.roundOrdinal}
        </p>
        <h1 className="font-display mt-1 text-4xl tracking-wide uppercase">{detail.race.name}</h1>
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
      </main>
    </>
  );
}
