import { notFound } from 'next/navigation';
import { auth } from '@/auth.ts';
import { appDb } from '@/app/db.ts';
import { RosterWall } from '@/components/RosterWall.tsx';
import { buildRosterWall } from '@/lib/roster-wall.ts';
import { loadRosterWallInputs } from '@/lib/db/roster-wall-query.ts';
import { resolveDefaultSquad, resolveSeasonByYear } from './query.ts';

/**
 * The wall's route: `/[season]` — home, scoped to the signed-in coach's
 * default squad (issue #88). Riders are rows, Rounds of the Season are
 * columns; the wall itself is built by `buildRosterWall`
 * (`src/lib/roster-wall.ts`) from the one read that owns it,
 * `loadRosterWallInputs` (`src/lib/db/roster-wall-query.ts`), and drawn by
 * `RosterWall` (`src/components/RosterWall.tsx`), which touches no database.
 *
 * A coach with no default squad in this season gets the same words this page
 * showed before the wall existed — there is nothing to build a wall out of.
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

  const wall =
    squad === null
      ? null
      : await loadRosterWallInputs(db, squad.id, season.id).then(({ riders, rounds, results }) => ({
          rounds,
          rows: buildRosterWall(riders, rounds, results),
        }));

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

      {wall ? <RosterWall seasonYear={season.year} rounds={wall.rounds} rows={wall.rows} /> : null}
    </main>
  );
}
