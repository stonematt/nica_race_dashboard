import Link from 'next/link';
import { auth } from '@/auth.ts';
import { Banner } from '@/components/Banner.tsx';
import { SignOutButton } from '@/components/SignOutButton.tsx';

/**
 * The authenticated shell. Race detail now reads the database (issue #24) and
 * the other three views hang off it. What this page proves is the frame: the
 * gate holds, the brand renders, and every later slice has somewhere to land.
 */

/** The four views the map names. Built ones link to themselves; the rest to their ticket. */
const VIEWS = [
  {
    name: 'Race detail',
    note: 'Squad cards, field strip, percent back. The spine — everything else hangs off it.',
    issue: null,
    href: '/races',
  },
  {
    name: 'Rider detail',
    note: 'One rider across a season: a field strip per race they started.',
    issue: 17,
    href: null,
  },
  {
    name: 'Club vs league',
    note: 'One strip per category, every club member marked.',
    issue: 18,
    href: null,
  },
  {
    name: 'Roster and squads',
    note: 'The only write surface in the app. Deferred until the read path proves out.',
    issue: null,
    href: null,
  },
] as const;

export default async function Home() {
  // The middleware already refused an anonymous request; this reads the session
  // for display, and does not stand in for the gate.
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
          The schema is migrated, the gate is up, and race detail reads the database.{' '}
          <Link href="/races" className="text-fg hover:text-accent font-semibold underline">
            Open a race
          </Link>
          .
        </p>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {VIEWS.map((view) => (
            <li
              key={view.name}
              className="border-border bg-surface rounded-lg border p-5 shadow-sm"
            >
              <h2 className="font-display text-accent text-xl tracking-wide uppercase">
                {view.name}
              </h2>
              <p className="text-muted mt-2 text-sm">{view.note}</p>
              <p className="mt-3 text-xs">
                {view.href ? (
                  <Link
                    href={view.href}
                    className="bg-accent on-accent rounded px-2 py-0.5 font-semibold"
                  >
                    open
                  </Link>
                ) : view.issue ? (
                  <span className="border-border text-muted rounded border px-2 py-0.5 font-semibold">
                    issue #{view.issue}
                  </span>
                ) : (
                  <span className="text-muted">not yet specified</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
