import { auth } from '@/auth.ts';
import { Banner } from '@/components/Banner.tsx';
import { SignOutButton } from '@/components/SignOutButton.tsx';

/**
 * The authenticated shell. Nothing reads the database yet — the views hang off
 * race detail, which is issue #24, and it in turn waits on the raw archive and
 * the flat-list decode. What this page proves is the frame: the gate holds, the
 * brand renders, and every later slice has somewhere to land.
 */

/** The four views the map names. Each links out to the ticket that builds it. */
const VIEWS = [
  {
    name: 'Race detail',
    note: 'Squad cards, field strip, percent back. The spine — everything else hangs off it.',
    issue: 24,
  },
  {
    name: 'Rider detail',
    note: 'One rider across a season: a field strip per race they started.',
    issue: 17,
  },
  {
    name: 'Club vs league',
    note: 'One strip per category, every club member marked.',
    issue: 18,
  },
  {
    name: 'Roster and squads',
    note: 'The only write surface in the app. Deferred until the read path proves out.',
    issue: null,
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
        <h1 className="font-display text-4xl tracking-wide uppercase">Nothing ingested yet</h1>
        <p className="text-muted mt-3 max-w-2xl">
          The schema is migrated and the gate is up. Results arrive once the raw archive is
          populated and the flat individual list is decoded.
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
                {view.issue ? (
                  <span className="bg-accent on-accent rounded px-2 py-0.5 font-semibold">
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
