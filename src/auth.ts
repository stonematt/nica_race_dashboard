/**
 * next-auth v5. Per-coach accounts, email-allowlisted (issue #3).
 *
 * Two providers — a Nodemailer magic link and a development credentials shim —
 * and only the first ever runs in production. Which of them is switched on is
 * not decided here: src/lib/signin-providers.ts owns that, because the sign-in
 * page has to render exactly the providers this file registers. Do not restate
 * the conditions here; a second copy of them is the thing that goes stale.
 *
 * The shim skips both the mail server and the allowlist. That is only safe
 * because `pnpm dev` binds loopback, so the instance it admits people to is
 * reachable from nowhere but this machine; the two land together (issue #33).
 * src/lib/admission.ts owns that branch — this file only registers providers.
 */

import { cache } from 'react';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import NextAuth, { type NextAuthConfig } from 'next-auth';
import type { Provider } from 'next-auth/providers';
import Credentials from 'next-auth/providers/credentials';
import Nodemailer from 'next-auth/providers/nodemailer';
import { authConfig } from './auth.config.ts';
import { createDb, schema } from './lib/db/index.ts';
import { admits, DEV_PROVIDER_ID } from './lib/admission.ts';
import { availableProviders } from './lib/signin-providers.ts';

export function providers(): Provider[] {
  const list: Provider[] = [];
  // The sign-in page renders its forms from this same function, so a form can
  // never be offered for a provider that was not registered here.
  const { email, dev } = availableProviders();

  if (email) {
    list.push(
      Nodemailer({
        server: process.env.AUTH_EMAIL_SERVER,
        from: process.env.AUTH_EMAIL_FROM,
      }),
    );
  }

  if (dev) {
    list.push(
      Credentials({
        id: DEV_PROVIDER_ID,
        name: 'Development sign-in',
        credentials: { email: { label: 'Email', type: 'email' } },
        authorize(credentials) {
          // Any address, no allowlist and no proof of controlling it. What
          // stands in front of the rider names here is the loopback bind, not
          // this function — see src/lib/admission.ts. Registration is still
          // double-gated on NODE_ENV and AUTH_DEV_LOGIN above.
          // Normalised the same way the allowlist normalises, so signing in
          // as Coach@x and coach@x does not leave two user rows behind.
          const claimed =
            typeof credentials?.email === 'string' ? credentials.email.trim().toLowerCase() : '';
          if (!claimed) return null;
          return { id: claimed, email: claimed, name: claimed };
        },
      }),
    );
  }

  return list;
}

const db = createDb();

/**
 * Exported so the callbacks can be tested against the real object rather than a
 * copy of it. The wiring is the load-bearing part — `signIn` forwarding
 * `account` is what makes the shim's branch reachable at all, and a test that
 * only exercises src/lib/admission.ts stays green when that wire is cut.
 */
export const authOptions = {
  ...authConfig,
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
  }),
  providers: providers(),
  callbacks: {
    ...authConfig.callbacks,
    /**
     * Last line of defence: a provider can prove an address, only this admits
     * it — with exactly one branch, the development shim, which is admitted on
     * the provider's identity instead. Every other provider runs the allowlist.
     */
    signIn({ user, account }) {
      return admits(account?.provider, user);
    },
  },
} satisfies NextAuthConfig;

const { handlers, auth: uncachedAuth, signIn, signOut } = NextAuth(authOptions);

/**
 * `SeasonLayout` and every page beneath `/[season]` resolve the session
 * independently — the App Router gives a layout no way to pass props down to
 * its children — so a single request can call this more than once. `cache()`
 * dedupes those calls within one request; outside of a request (a test, a
 * script) it is a no-op passthrough, since there is no request-scoped cache
 * to key into.
 */
const auth = cache(uncachedAuth);

export { handlers, auth, signIn, signOut };
