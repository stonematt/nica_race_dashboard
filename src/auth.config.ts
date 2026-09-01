/**
 * Edge-safe auth config. Middleware runs in the Edge runtime and cannot import
 * the database (PGlite is a WASM Node module), so the adapter and providers
 * live in src/auth.ts and only this half is shared with middleware.
 *
 * src/lib/allowlist.ts is pure — it reads process.env and nothing else — so it
 * is safe to pull into the Edge bundle, and that is what lets the gate run on
 * every request instead of only at sign-in.
 */

import type { NextAuthConfig } from 'next-auth';
import { isAllowed } from './lib/allowlist.ts';

export const authConfig = {
  pages: { signIn: '/signin' },
  session: { strategy: 'jwt' },
  callbacks: {
    /**
     * Every route is behind auth, including aggregate views — stricter than the
     * original privacy review, and decided in issue #7. There is no public half
     * of this app to carve out.
     *
     * This re-checks the allowlist on every request rather than trusting the
     * token. Under the jwt strategy there is no session row to delete, so a
     * sign-in-time-only check means removing an address from
     * AUTH_ALLOWED_EMAILS does not evict its holder — they keep reading minors'
     * names until the token expires, up to 30 days later. Revoking access has
     * to take effect on the next request, so the check belongs here.
     */
    authorized({ auth }) {
      return isAllowed(auth?.user?.email);
    },
  },
  providers: [],
} satisfies NextAuthConfig;
