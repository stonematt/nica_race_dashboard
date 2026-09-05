import Link from 'next/link';
import { auth } from '@/auth.ts';
import { appDb } from '@/app/db.ts';
import { Banner } from '@/components/Banner.tsx';
import { SignOutButton } from '@/components/SignOutButton.tsx';
import { listRaces } from './[eventId]/query.ts';

/**
 * The races there are to open.
 *
 * Deliberately thin: it exists so "a coach opens a race" is a thing a coach can
 * actually do. The season view that will eventually live at this address is
 * rider detail's and club-vs-league's business, not this ticket's.
 */
export const dynamic = 'force-dynamic';

export default async function RacesPage() {
  const session = await auth();
  const races = await listRaces(appDb());

  return (
    <>
      <Banner>
        {session?.user?.email ? <span>{session.user.email}</span> : null}
        <SignOutButton />
      </Banner>

      <main className="mx-auto max-w-4xl px-6 py-8">
        <h1 className="font-display text-4xl tracking-wide uppercase">Races</h1>

        {races.length === 0 ? (
          <p className="text-muted mt-3 max-w-2xl">
            Nothing ingested yet. Archive a season with <code>pnpm fetch</code>, then{' '}
            <code>pnpm normalize</code>.
          </p>
        ) : (
          <ul className="mt-6 grid list-none gap-3 p-0">
            {races.map((race) => (
              <li key={race.sourceEventId}>
                <Link
                  href={`/races/${race.sourceEventId}`}
                  className="border-border bg-surface hover:border-accent flex flex-wrap items-baseline gap-x-3 rounded-lg border p-4 shadow-sm"
                >
                  <span className="font-display text-lg tracking-wide uppercase">{race.name}</span>
                  <span className="text-muted text-xs">
                    {race.seasonYear} · round {race.roundOrdinal}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
