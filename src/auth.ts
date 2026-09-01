/**
 * next-auth v5. Per-coach accounts, email-allowlisted (issue #3).
 *
 * Two providers, and only one of them ever runs in production:
 *   - Nodemailer magic link, active when AUTH_EMAIL_SERVER is configured.
 *   - A development credentials shim, which refuses to load unless NODE_ENV is
 *     development AND AUTH_DEV_LOGIN=1. It still checks the allowlist, so it is
 *     a convenience for local work, not a way past the gate.
 */

import { DrizzleAdapter } from '@auth/drizzle-adapter';
import NextAuth from 'next-auth';
import type { Provider } from 'next-auth/providers';
import Credentials from 'next-auth/providers/credentials';
import Nodemailer from 'next-auth/providers/nodemailer';
import { authConfig } from './auth.config.ts';
import { createDb, schema } from './lib/db/index.ts';
import { isAllowed } from './lib/allowlist.ts';

const isDevLogin = process.env.NODE_ENV === 'development' && process.env.AUTH_DEV_LOGIN === '1';

function providers(): Provider[] {
  const list: Provider[] = [];

  if (process.env.AUTH_EMAIL_SERVER) {
    list.push(
      Nodemailer({
        server: process.env.AUTH_EMAIL_SERVER,
        from: process.env.AUTH_EMAIL_FROM,
      }),
    );
  }

  if (isDevLogin) {
    list.push(
      Credentials({
        id: 'dev',
        name: 'Development sign-in',
        credentials: { email: { label: 'Email', type: 'email' } },
        authorize(credentials) {
          const email = typeof credentials?.email === 'string' ? credentials.email : null;
          // The allowlist still applies. This shim skips the mail server, not the gate.
          if (!isAllowed(email)) return null;
          return { id: email!, email: email!, name: email! };
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
