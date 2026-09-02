import { describe, expect, it } from 'vitest';
import { availableProviders } from './signin-providers.ts';

describe('availableProviders', () => {
  it('offers nothing when nothing is configured', () => {
    expect(availableProviders({})).toEqual({ email: false, dev: false });
  });

  it('offers the magic link when a mail server is set', () => {
    expect(availableProviders({ AUTH_EMAIL_SERVER: 'smtp://localhost:1025' }).email).toBe(true);
  });

  it('refuses the dev shim in production even when AUTH_DEV_LOGIN is set', () => {
    // The failure this guards: a .env copied from a laptop to a server. The
    // shim signs in with an address and no proof of controlling it, so a
    // production build must not register it whatever the env says.
    expect(availableProviders({ NODE_ENV: 'production', AUTH_DEV_LOGIN: '1' }).dev).toBe(false);
    expect(availableProviders({ NODE_ENV: 'test', AUTH_DEV_LOGIN: '1' }).dev).toBe(false);
  });

  it('refuses the dev shim in development unless it is switched on deliberately', () => {
    expect(availableProviders({ NODE_ENV: 'development' }).dev).toBe(false);
    expect(availableProviders({ NODE_ENV: 'development', AUTH_DEV_LOGIN: '0' }).dev).toBe(false);
    expect(availableProviders({ NODE_ENV: 'development', AUTH_DEV_LOGIN: 'true' }).dev).toBe(false);
  });

  it('offers the dev shim when both conditions hold', () => {
    expect(availableProviders({ NODE_ENV: 'development', AUTH_DEV_LOGIN: '1' }).dev).toBe(true);
  });
});
