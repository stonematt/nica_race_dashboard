/**
 * Edge-safe auth config. Middleware runs in the Edge runtime and cannot import
 * the database (PGlite is a WASM Node module), so the adapter and providers
 * live in src/auth.ts and only this half is shared with middleware.
 */

import type { NextAuthConfig } from 'next-auth';

export const authConfig = {
  pages: { signIn: '/signin' },
  session: { strategy: 'jwt' },
  callbacks: {
    /**
     * Every route is behind auth, including aggregate views — stricter than the
     * original privacy review, and decided in issue #7. There is no public half
     * of this app to carve out.
     */
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
