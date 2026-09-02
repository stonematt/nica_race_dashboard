import { signIn } from '@/auth.ts';
import { Banner } from '@/components/Banner.tsx';
import { availableProviders } from '@/lib/signin-providers.ts';

/**
 * The one route outside the gate, and the only one. It offers exactly the
 * providers src/auth.ts actually registered: the magic link when a mail server
 * is configured, and the development shim when it is explicitly switched on.
 * Both still run through the allowlist — this page renders a door, not a key.
 */

/**
 * next-auth reports a failed sign-in by redirecting back here with `?error=`.
 * Every refusal reads the same, whatever caused it: an address off the
 * allowlist and an address that simply failed must not be distinguishable, or
 * this page becomes a way to ask whether a given coach is in the league.
 *
 * It is not a complete answer — a successful magic-link send still looks
 * different from a refusal. Closing that gap is a render-layer decision and
 * belongs to issue #9, not here.
 */
const REFUSED =
  'That sign-in was refused. Access to this app is per address — ask your league admin if yours should be on the list.';

const MESSAGES: Record<string, string> = {
  Verification: 'That sign-in link has expired or was already used. Request a new one.',
};

export default async function SignIn({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}) {
  const { error, callbackUrl } = await searchParams;
  const redirectTo = callbackUrl ?? '/';
  const { email, dev } = availableProviders();

  return (
    <>
      <Banner />
      <main className="mx-auto max-w-md px-6 py-12">
        <h1 className="font-display text-3xl tracking-wide uppercase">Sign in</h1>
        <p className="text-muted mt-3 text-sm">
          Coaches only. This app shows minors&rsquo; names, so there is no public view and no shared
          password — access is per address.
        </p>

        {error ? (
          <p className="border-danger text-danger mt-6 rounded border-l-4 bg-white px-4 py-3 text-sm">
            {MESSAGES[error] ?? REFUSED}
          </p>
        ) : null}

        {email ? (
          <form
            action={async (formData: FormData) => {
              'use server';
              await signIn('nodemailer', {
                email: formData.get('email'),
                redirectTo,
              });
            }}
            className="mt-8"
          >
            <label htmlFor="email" className="block text-sm font-semibold">
              Email address
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              className="border-border bg-surface mt-2 w-full rounded border px-3 py-2"
            />
            <button
              type="submit"
              className="bg-accent on-accent font-display mt-4 w-full cursor-pointer rounded px-4 py-2 text-lg tracking-wide uppercase"
            >
              Email me a link
            </button>
          </form>
        ) : null}

        {dev ? (
          <form
            action={async (formData: FormData) => {
              'use server';
              await signIn('dev', { email: formData.get('email'), redirectTo });
            }}
            className="border-border mt-8 border-t pt-8"
          >
            <label htmlFor="dev-email" className="block text-sm font-semibold">
              Development sign-in
            </label>
            <p className="text-muted mt-1 text-xs">No mail server. The allowlist still applies.</p>
            <input
              id="dev-email"
              name="email"
              type="email"
              required
              className="border-border bg-surface mt-2 w-full rounded border px-3 py-2"
            />
            <button
              type="submit"
              className="border-navy text-navy mt-3 w-full cursor-pointer rounded border px-4 py-2 text-sm font-semibold"
            >
              Sign in
            </button>
          </form>
        ) : null}

        {!email && !dev ? (
          <p className="border-warn mt-8 rounded border-l-4 bg-white px-4 py-3 text-sm">
            No sign-in method is configured. Set <code>AUTH_EMAIL_SERVER</code>, or{' '}
            <code>AUTH_DEV_LOGIN=1</code> in development. See <code>.env.example</code>.
          </p>
        ) : null}
      </main>
    </>
  );
}
