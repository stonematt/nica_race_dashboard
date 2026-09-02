/**
 * next-auth v5. Per-coach accounts, email-allowlisted (issue #3).
 *
 * Two providers — a Nodemailer magic link and a development credentials shim —
 * and only the first ever runs in production. Which of them is switched on is
 * not decided here: src/lib/signin-providers.ts owns that, because the sign-in
 * page has to render exactly the providers this file registers. Do not restate
 * the conditions here; a second copy of them is the thing that goes stale.
 *
 * The shim skips the mail server, not the gate — it still runs the allowlist.
 */

import { DrizzleAdapter } from '@auth/drizzle-adapter';
import NextAuth from 'next-auth';
import type { Provider } from 'next-auth/providers';
import Credentials from 'next-auth/providers/credentials';
import Nodemailer from 'next-auth/providers/nodemailer';
import { authConfig } from './auth.config.ts';
import { createDb, schema } from './lib/db/index.ts';
import { isAllowed } from './lib/allowlist.ts';
import { availableProviders } from './lib/signin-providers.ts';

function providers(): Provider[] {
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
        id: 'dev',
        name: 'Development sign-in',
        credentials: { email: { label: 'Email', type: 'email' } },
        authorize(credentials) {
          const claimed = typeof credentials?.email === 'string' ? credentials.email : null;
          // The allowlist still applies. This shim skips the mail server, not
          // the gate: it proves nothing about who controls the address, so the
          // list is the only thing standing between it and the rider names.
          if (!isAllowed(claimed)) return null;
          return { id: claimed!, email: claimed!, name: claimed! };
        },
      }),
    );
  }

  return list;
}

const db = createDb();

export const { handlers, auth, signIn, signOut } = NextAuth({
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
    /** Last line of defence: a provider can prove an address, only this admits it. */
    signIn({ user }) {
      return isAllowed(user?.email);
    },
  },
});
