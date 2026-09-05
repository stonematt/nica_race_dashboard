/**
 * Edge-safe auth config. Middleware runs in the Edge runtime and cannot import
 * the database (PGlite is a WASM Node module), so the adapter and providers
 * live in src/auth.ts and only this half is shared with middleware.
 *
 * src/lib/admission.ts is pure — it reads process.env and nothing else — so it
 * is safe to pull into the Edge bundle, and that is what lets the gate run on
 * every request instead of only at sign-in.
 */

import type { NextAuthConfig } from 'next-auth';
import { admits } from './lib/admission.ts';

declare module 'next-auth' {
  interface Session {
    /**
     * Which provider established this session. The route gate needs it and a
     * decoded token is all it gets — see the jwt and session callbacks below.
     */
    provider?: string;
  }
}

export const authConfig = {
  pages: { signIn: '/signin' },
  session: { strategy: 'jwt' },
  callbacks: {
    /**
     * Stamp the provider at sign-in. `account` is only populated on the request
     * that establishes the session, so this is the one chance to record how
     * someone got in; every later call just carries the claim forward.
     *
     * The claim is not trusted on its own. src/lib/admission.ts re-reads the
     * environment before honouring it, so a token minted by a development shim
     * is inert against a deployment that registers no shim.
     */
    jwt({ token, account }) {
      if (account) token.provider = account.provider;
      return token;
    },

    /**
     * Carry the claim onto the session, which is all `authorized` below sees.
     *
     * Narrowed rather than cast. A JWT's own fields are `unknown` — the token
     * is decoded from whatever was in the cookie, so this is the boundary
     * between a claim and a value, and a cast would paper over exactly the case
     * that matters: a token carrying something other than a provider string.
     */
    session({ session, token }) {
      session.provider = typeof token.provider === 'string' ? token.provider : undefined;
      return session;
    },

    /**
     * Every route is behind auth, including aggregate views — stricter than the
     * original privacy review, and decided in issue #7. There is no public half
     * of this app to carve out.
     *
     * This re-checks admission on every request rather than trusting the token.
     * Under the jwt strategy there is no session row to delete, so a
     * sign-in-time-only check means removing an address from
     * AUTH_ALLOWED_EMAILS does not evict its holder — they keep reading minors'
     * names until the token expires, up to 30 days later. Revoking access has
     * to take effect on the next request, so the check belongs here.
     *
     * The development shim is the one session this admits without the allowlist,
     * and it has to be honoured here too: the shim signs in an address that is
     * not on the list, so re-checking the list would bounce that user straight
     * back to /signin and the shim would sign nobody in. That is why the
     * provider is stamped above — so this exempts the shim's own sessions and
     * nothing else. See src/lib/admission.ts.
     */
    authorized({ auth }) {
      return admits(auth?.provider, auth?.user);
    },
  },
  providers: [],
} satisfies NextAuthConfig;
