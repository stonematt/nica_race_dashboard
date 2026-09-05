/**
 * The wiring, not the policy. src/lib/admission.test.ts proves what `admits`
 * decides; nothing there proves this file asks it the right question.
 *
 * The gap that motivated these: drop `account` from the `signIn` destructure
 * and the shim's branch becomes unreachable — every admission test stays green
 * while the shim admits nobody. Same for the credentials provider quietly
 * regaining an allowlist check. Both are one-token edits to a security gate.
 *
 * The database is mocked because importing this module constructs one at load:
 * `createDb()` boots a WASM Postgres, and the adapter it feeds is never touched
 * by a callback test.
 */

import type { Provider } from 'next-auth/providers';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The adapter validates its db argument on construction, and neither it nor
// the database participates in a callback decision.
vi.mock('@auth/drizzle-adapter', () => ({ DrizzleAdapter: () => ({}) }));

vi.mock('./lib/db/index.ts', () => ({
  createDb: () => ({}),
  schema: { users: {}, accounts: {}, sessions: {}, verificationTokens: {} },
}));

const { authOptions, providers } = await import('./auth.ts');
const { DEV_PROVIDER_ID } = await import('./lib/admission.ts');

const LISTED = 'coach@example.org';
const STRANGER = 'anyone@example.test';

/** next-auth types these callbacks loosely; both only read what is named here. */
const signIn = authOptions.callbacks.signIn as (arg: {
  user: { email?: string | null };
  account: { provider?: string } | null;
}) => boolean;

const jwt = authOptions.callbacks.jwt as (arg: {
  token: Record<string, unknown>;
  account: { provider?: string } | null;
}) => Record<string, unknown>;

function devEnv() {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('AUTH_DEV_LOGIN', '1');
  vi.stubEnv('AUTH_ALLOWED_EMAILS', LISTED);
}

/**
 * The dev shim's own config, dug out of the registered provider.
 *
 * `Credentials(config)` does not return `config`. It returns a fixed skeleton —
 * `{ id: "credentials", name: "Credentials", authorize: () => null, options:
 * config }` — and next-auth merges `options` over that skeleton when it
 * normalises providers at request time. So the `id: DEV_PROVIDER_ID` and the
 * `authorize` written in src/auth.ts live under `.options` here, and looking for
 * `p.id === 'dev'` finds nothing at this layer. The merged id is real: the
 * running app answers on /api/auth/callback/dev.
 */
interface DevShim {
  id?: string;
  authorize: (credentials: Record<string, unknown>) => unknown;
}

function findDevShim(): DevShim | undefined {
  const found = providers().find((p: Provider) => {
    const options = (p as { options?: { id?: string } }).options;
    return typeof p === 'object' && options?.id === DEV_PROVIDER_ID;
  });
  return (found as { options?: DevShim } | undefined)?.options;
}

function devProvider(): DevShim {
  const shim = findDevShim();
  if (!shim) throw new Error('the dev provider was not registered');
  return shim;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the signIn callback', () => {
  it('forwards the provider, so the shim branch is actually reachable', () => {
    devEnv();
    // Cut `account` out of the destructure and this is the assertion that goes
    // red. STRANGER is not on the allowlist, so only the provider can admit it.
    expect(signIn({ user: { email: STRANGER }, account: { provider: DEV_PROVIDER_ID } })).toBe(
      true,
    );
  });

  it('still runs the allowlist for every other provider', () => {
    devEnv();
    expect(signIn({ user: { email: STRANGER }, account: { provider: 'nodemailer' } })).toBe(false);
    expect(signIn({ user: { email: LISTED }, account: { provider: 'nodemailer' } })).toBe(true);
    expect(signIn({ user: { email: STRANGER }, account: null })).toBe(false);
  });
});

describe('the jwt callback', () => {
  it('stamps the provider at sign-in and carries it afterwards', () => {
    // Without the stamp the route gate has nothing to branch on, and the shim's
    // user is evicted on their next request.
    expect(jwt({ token: {}, account: { provider: DEV_PROVIDER_ID } }).provider).toBe(
      DEV_PROVIDER_ID,
    );
    // account is null on every request after the first; the claim must survive.
    expect(jwt({ token: { provider: DEV_PROVIDER_ID }, account: null }).provider).toBe(
      DEV_PROVIDER_ID,
    );
  });
});

describe('the dev credentials provider', () => {
  it('admits an address that is not on the allowlist', () => {
    devEnv();
    expect(devProvider().authorize({ email: STRANGER })).toMatchObject({ email: STRANGER });
  });

  it('normalises the address it hands back', () => {
    devEnv();
    // Two casings would otherwise leave two user rows behind the adapter.
    expect(devProvider().authorize({ email: '  Coach@Example.ORG ' })).toMatchObject({
      email: LISTED,
      id: LISTED,
    });
  });

  it('refuses an empty or non-string address', () => {
    devEnv();
    expect(devProvider().authorize({ email: '   ' })).toBeNull();
    expect(devProvider().authorize({ email: undefined })).toBeNull();
    expect(devProvider().authorize({})).toBeNull();
  });

  it('is not registered at all unless both gates are set', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('AUTH_DEV_LOGIN', '1');
    expect(findDevShim()).toBeUndefined();

    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('AUTH_DEV_LOGIN', '');
    expect(findDevShim()).toBeUndefined();
  });
});
