import { notFound } from 'next/navigation';
import { auth } from '@/auth.ts';
import { appDb } from '@/app/db.ts';
import { resolveDefaultSquad, resolveSeasonByYear } from './query.ts';

/**
 * The wall's route: `/[season]`, scoped to the signed-in coach's default
 * squad. This is a placeholder for issue #88 — it names the season and squad
 * this coach has landed on, in words, and stops there. The Roster Wall itself
 * (`src/lib/roster-wall.ts`, `src/components/RosterWall.tsx`) is a separate
 * lane's build.
 *
 * The layout above already turned an unknown or malformed segment into a real
 * not-found before this ever renders; the check below is defensive, not the
 * primary gate — see `src/app/[season]/layout.tsx`.
 */
export const dynamic = 'force-dynamic';

export default async function SeasonHomePage({ params }: { params: Promise<{ season: string }> }) {
  const { season: seasonSegment } = await params;
  const db = appDb();

  const season = await resolveSeasonByYear(db, seasonSegment);
  if (season === null) notFound();

  const session = await auth();
  const squad = await resolveDefaultSquad(db, session?.user?.id ?? null, season.id);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="font-display text-4xl tracking-wide uppercase">{season.year} season</h1>
      <p className="text-muted mt-3 max-w-2xl">
        {squad ? (
          <>
            You&rsquo;re looking at the <strong className="text-fg">{squad.name}</strong> squad.
          </>
        ) : (
          <>You&rsquo;re not coaching a squad in the {season.year} season.</>
        )}
      </p>
      <p className="text-muted mt-6 max-w-2xl text-sm">
        The Roster Wall lands here next — riders as rows, Rounds as columns.
      </p>
    </main>
  );
}
