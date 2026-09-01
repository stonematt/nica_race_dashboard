/**
 * Every route behind auth — no unauthenticated view of anything, including
 * aggregate views (issue #7, amending #3).
 *
 * Uses the edge-safe half of the config; the adapter never reaches the Edge
 * runtime. See src/auth.config.ts.
 */

import NextAuth from 'next-auth';
import { authConfig } from './src/auth.config.ts';

export const { auth: middleware } = NextAuth(authConfig);
export default middleware;

export const config = {
  matcher: [
    // Everything except next-auth's own routes, the sign-in page, and static assets.
    '/((?!api/auth|signin|_next/static|_next/image|favicon.ico|robots.txt).*)',
  ],
};
