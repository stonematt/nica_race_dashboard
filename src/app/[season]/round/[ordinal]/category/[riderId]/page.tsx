import { notFound } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/auth.ts';
import { appDb } from '@/app/db.ts';
import { CategoryView } from '@/components/CategoryView.tsx';
import { loadCategoryField } from '@/lib/db/category-query.ts';
import { resolveDefaultSquad, resolveSeasonByYear } from '@/app/[season]/query.ts';
import { resolveRound } from '@/app/[season]/round/[ordinal]/query.ts';

/**
 * The crossing's destination (ADR-0002, issue #92): the single door from the
 * club tree into the league tree — `/<year>/round/<ordinal>/category/<riderId>`,
 * one level under the Round page it identifies, the way `[ordinal]` sits
 * under `[season]`.
 *
 * Only ever reached with meaning from a wall cell that started
 * (`RosterWall.tsx`'s `categoryHref`); a Rider with no result at this Round
 * has no Category to open, so `loadCategoryField` returning null is a real
 * not-found here, the same as an unknown season or Round segment.
 *
 * The Squad resolved below is only for tinting squad-mates in the field
 * (`isSquadMate`); a coach who reaches this page with no default Squad still
 * gets the full ranked list, just with nobody tinted.
 *
 * `force-dynamic` for the same reason as every other route under `[season]`:
 * it reads a database and a session per request (issue #3).
 */
export const dynamic = 'force-dynamic';

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ season: string; ordinal: string; riderId: string }>;
}) {
  const { season: seasonSegment, ordinal, riderId: riderIdSegment } = await params;
  const db = appDb();

  const season = await resolveSeasonByYear(db, seasonSegment);
  if (season === null) notFound();

  const round = await resolveRound(db, season.id, ordinal);
  if (round === null) notFound();

  if (!/^\d+$/.test(riderIdSegment)) notFound();
  const riderId = Number(riderIdSegment);

  const session = await auth();
  const squad = await resolveDefaultSquad(db, session?.user?.id ?? null, season.id);

  // No result at this Round is a real not-found: there is no Category to
  // open for a non-start, the same invariant the wall cell already enforced
  // by not linking a did-not-start cell in the first place.
  const field = await loadCategoryField(db, riderId, round.id, squad?.id ?? 0);
  if (field === null) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-8">
      <p className="text-muted text-xs font-bold tracking-wider uppercase">
        <Link href={`/${season.year}`} className="hover:text-accent underline">
          {season.year} season
        </Link>{' '}
        ·{' '}
        <Link
          href={`/${season.year}/round/${round.ordinal}`}
          className="hover:text-accent underline"
        >
          {round.name}
        </Link>
      </p>
      <CategoryView field={field} riderId={riderId} />
    </main>
  );
}
