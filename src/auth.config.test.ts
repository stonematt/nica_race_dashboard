/**
 * The route gate: who `authorized` lets through, which paths the matcher
 * covers, and where the middleware file lives.
 *
 * All three failed at once before this existed. The file was at the repo root
 * where Next never loads it, the matcher's alternatives were unanchored, and
 * `authorized` returned `!!auth?.user` — so the gate was absent, leaky, and
 * checking the wrong thing, while the tree looked correct.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { authConfig } from './auth.config.ts';
import { config as middlewareConfig } from './middleware.ts';

const repoRoot = path.join(import.meta.dirname, '..');

/** next-auth types these loosely; each callback only reads what is named here. */
const authorized = authConfig.callbacks.authorized as (arg: {
  auth: { user?: { email?: string | null }; provider?: string } | null;
}) => boolean;

// Two-step cast: next-auth's session callback declares an adapter-shaped
// argument this one never reads, so the narrow shape is not directly comparable.
const session = authConfig.callbacks.session as unknown as (arg: {
  session: { provider?: string; user?: { id?: string } };
  token: Record<string, unknown>;
}) => { provider?: string; user?: { id?: string } };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('authorized', () => {
  it('refuses an anonymous request', () => {
    vi.stubEnv('AUTH_ALLOWED_EMAILS', 'coach@example.org');
    expect(authorized({ auth: null })).toBe(false);
    expect(authorized({ auth: {} })).toBe(false);
    expect(authorized({ auth: { user: {} } })).toBe(false);
  });

  it('re-checks the allowlist on every request, not just at sign-in', () => {
    // The revocation case. Under `strategy: 'jwt'` there is no session row to
    // delete, so if this callback trusted the token alone, striking an address
    // from AUTH_ALLOWED_EMAILS would leave its holder reading rider names until
    // the token expired — up to 30 days.
    const signedIn = { auth: { user: { email: 'coach@example.org' } } };

    vi.stubEnv('AUTH_ALLOWED_EMAILS', 'coach@example.org');
    expect(authorized(signedIn)).toBe(true);

    vi.stubEnv('AUTH_ALLOWED_EMAILS', 'someone-else@example.org');
    expect(authorized(signedIn)).toBe(false);
  });

  it('fails closed when the allowlist is empty', () => {
    vi.stubEnv('AUTH_ALLOWED_EMAILS', '');
    expect(authorized({ auth: { user: { email: 'coach@example.org' } } })).toBe(false);
  });
});

describe('authorized, with the development shim switched on', () => {
  /*
   * These stub NODE_ENV deliberately. The suite above runs under
   * NODE_ENV=test, which means the shim is off and its branch is never
   * exercised — the tests passed for a reason unrelated to what they assert,
   * and would have flipped if the vitest config ever set NODE_ENV=development.
   */
  const shimOn = () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_DEV_LOGIN', '1');
    vi.stubEnv('AUTH_ALLOWED_EMAILS', 'coach@example.org');
  };

  it('keeps a shim session alive instead of evicting it one request later', () => {
    shimOn();
    expect(authorized({ auth: { user: { email: 'anyone@example.test' }, provider: 'dev' } })).toBe(
      true,
    );
  });

  it('still allowlists a magic-link session in the same process', () => {
    // The bug this locks down: branching on the shim being AVAILABLE rather
    // than on the session having come through it dropped the allowlist for
    // every session at once, revocation included.
    shimOn();
    expect(
      authorized({ auth: { user: { email: 'anyone@example.test' }, provider: 'nodemailer' } }),
    ).toBe(false);
    expect(
      authorized({ auth: { user: { email: 'coach@example.org' }, provider: 'nodemailer' } }),
    ).toBe(true);
  });

  it('refuses a session with no provider claim and no listed address', () => {
    // A token minted before the claim existed, or one stripped of it.
    shimOn();
    expect(authorized({ auth: { user: { email: 'anyone@example.test' } } })).toBe(false);
  });

  it('still refuses an anonymous request', () => {
    shimOn();
    expect(authorized({ auth: null })).toBe(false);
    expect(authorized({ auth: { provider: 'dev' } })).toBe(false);
  });
});

describe('the session callback', () => {
  it('carries the provider claim through to the route gate', () => {
    expect(session({ session: {}, token: { provider: 'dev' } }).provider).toBe('dev');
  });

  it('drops a claim that is not a string', () => {
    // The token is decoded from a cookie, so its fields are unknown until
    // checked. A non-string here must not reach the gate as one.
    expect(session({ session: {}, token: { provider: 42 } }).provider).toBeUndefined();
    expect(session({ session: {}, token: {} }).provider).toBeUndefined();
  });

  it('carries the signed-in id onto the session', () => {
    // Under the jwt strategy nothing does this for us, and without it every
    // query keyed on a coach receives null instead of an id.
    const out = session({ session: { user: {} }, token: { sub: 'coach-1' } });
    expect(out.user?.id).toBe('coach-1');
  });

  it('leaves the id alone when the token carries none, or is not a string', () => {
    expect(session({ session: { user: {} }, token: {} }).user?.id).toBeUndefined();
    expect(session({ session: { user: {} }, token: { sub: 7 } }).user?.id).toBeUndefined();
    // A session with no user at all must not throw on the way through.
    expect(() => session({ session: {}, token: { sub: 'coach-1' } })).not.toThrow();
  });
});

describe('the middleware matcher', () => {
  /*
   * Approximates how Next compiles a matcher string. This is asserting our own
   * negative lookahead, not Next's compiler — the bug it guards was entirely in
   * the lookahead.
   */
  const pattern = new RegExp(`^${middlewareConfig.matcher[0]}$`);
  const gated = (pathname: string) => pattern.test(pathname);

  it('covers every route, including aggregate ones', () => {
    expect(gated('/')).toBe(true);
    expect(gated('/races')).toBe(true);
    expect(gated('/races/363499')).toBe(true);
    expect(gated('/riders/974')).toBe(true);
    // Aggregate and club-wide views are gated too — issue #7 amended #3 to
    // remove the public half of this app entirely.
    expect(gated('/standings')).toBe(true);
    expect(gated('/club/compare')).toBe(true);
    expect(gated('/api/results')).toBe(true);
  });

  it('exempts only the exact sign-in surface and static assets', () => {
    expect(gated('/api/auth/session')).toBe(false);
    expect(gated('/api/auth/callback/nodemailer')).toBe(false);
    expect(gated('/signin')).toBe(false);
    expect(gated('/_next/static/chunk.js')).toBe(false);
    expect(gated('/_next/image/x.png')).toBe(false);
    expect(gated('/favicon.ico')).toBe(false);
    // The app icon. Rendered on the sign-in page, which is itself anonymous,
    // so gating it would leave the one public page without one.
    expect(gated('/icon.svg')).toBe(false);
    expect(gated('/robots.txt')).toBe(false);
  });

  it('does not let a prefix of an exempt path escape the gate', () => {
    // Each of these slipped through when the alternatives were unanchored.
    expect(gated('/api/authorize')).toBe(true);
    expect(gated('/api/authenticate/steal')).toBe(true);
    expect(gated('/signin-preview')).toBe(true);
    expect(gated('/signinner')).toBe(true);
    expect(gated('/robots.txt.bak')).toBe(true);
    expect(gated('/icon.svg.map')).toBe(true);
    expect(gated('/favicon.ico.map')).toBe(true);
    expect(gated('/_next/staticky')).toBe(true);
  });
});

describe('the middleware file location', () => {
  it('lives at src/middleware.ts, where Next actually looks', () => {
    // Next resolves middleware relative to the app directory's parent:
    // `path.join(pagesDir || appDir, '..')`. With the app at src/app that is
    // src/. A middleware.ts at the repo root is never loaded, no error is
    // raised, and every route serves unauthenticated.
    expect(fs.existsSync(path.join(repoRoot, 'src', 'app'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'src', 'middleware.ts'))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, 'middleware.ts'))).toBe(false);
  });
});
