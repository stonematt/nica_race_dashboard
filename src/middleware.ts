/**
 * Every route behind auth — no unauthenticated view of anything, including
 * aggregate views (issue #7, amending #3).
 *
 * This file MUST live at src/middleware.ts, not the repo root. Next resolves
 * middleware relative to the app directory's parent, so with the app at
 * src/app the only path it scans is src/. At the repo root the file is never
 * loaded and every route is public, silently — the gate looks present in the
 * tree and does nothing.
 *
 * Uses the edge-safe half of the config; the adapter never reaches the Edge
 * runtime. See src/auth.config.ts.
 */

import NextAuth from 'next-auth';
import { authConfig } from './auth.config.ts';

export const { auth: middleware } = NextAuth(authConfig);
export default middleware;

export const config = {
  matcher: [
    /*
     * Everything except next-auth's own routes, the sign-in page, and static
     * assets. Each alternative is anchored: an unanchored `api/auth` also
     * excludes `/api/authorize`, and an unanchored `signin` also excludes
     * `/signin-preview`, handing an attacker a route outside the gate for the
     * price of a prefix.
     */
    '/((?!api/auth/|signin$|_next/static/|_next/image/|favicon\\.ico$|robots\\.txt$).*)',
  ],
};
