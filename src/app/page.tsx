import { redirect } from 'next/navigation';
import { auth } from '@/auth.ts';
import { appDb } from '@/app/db.ts';
import { Banner } from '@/components/Banner.tsx';
import { SignOutButton } from '@/components/SignOutButton.tsx';
import { resolveCurrentSeason } from './[season]/query.ts';

/**
 * `/` is not a page of its own — it resolves the current season (the latest
 * year on record) and hands off to `/[season]`, the wall's route (issue #88).
 * Season is the ambient frame every view sits inside (CONTEXT.md), so there is
 * nothing to render at the bare root once a season exists.
 *
 * Before anything has been fetched or normalized there is no season to hand
 * off to, and that is a legitimate bootstrap state rather than a not-found —
 * the same call `races/page.tsx` makes for "nothing ingested yet".
 */
export const dynamic = 'force-dynamic';

export default async function Home() {
  const season = await resolveCurrentSeason(appDb());

  if (season === null) {
    const session = await auth();
    return (
      <>
        <Banner>
          {session?.user?.email ? <span>{session.user.email}</span> : null}
          <SignOutButton />
        </Banner>
        <main className="mx-auto max-w-5xl px-6 py-10">
          <h1 className="font-display text-4xl tracking-wide uppercase">Descenders</h1>
          <p className="text-muted mt-3 max-w-2xl">
            Nothing ingested yet. Archive a season with <code>pnpm fetch</code>, then{' '}
            <code>pnpm normalize</code>.
          </p>
        </main>
      </>
    );
  }

  redirect(`/${season.year}`);
}
