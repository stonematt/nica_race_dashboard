/**
 * The allowlist is the single gate in front of minors' race results, so it is
 * tested for what it REFUSES, not for what it admits. Issue #20 asked for these
 * first; they were written last, which is how the sign-in-time-only hole in
 * src/auth.config.ts survived review.
 *
 * env is injected rather than mutated globally — these assertions are about the
 * function, and a stubbed process.env leaking between suites is its own bug.
 */

import { describe, expect, it } from 'vitest';
import { allowedEmails, isAllowed } from './allowlist.ts';

describe('isAllowed', () => {
  it('fails closed: an empty allowlist admits nobody', () => {
    // The inversion that matters. A list-membership check written the obvious
    // way ("no list configured, so no restriction") admits everybody here.
    expect(isAllowed('coach@example.org', { AUTH_ALLOWED_EMAILS: '' })).toBe(false);
    expect(isAllowed('coach@example.org', {})).toBe(false);
    expect(isAllowed('coach@example.org', { AUTH_ALLOWED_EMAILS: '   ,  , ' })).toBe(false);
  });

  it('refuses an address the provider proved but the list does not carry', () => {
    // next-auth has already verified this person controls this mailbox. That
    // proves identity, not authorization, and the gate is authorization.
    const env = { AUTH_ALLOWED_EMAILS: 'coach@example.org' };
    expect(isAllowed('stranger@example.org', env)).toBe(false);
    expect(isAllowed('coach@example.org.evil.test', env)).toBe(false);
    expect(isAllowed('coach@example.or', env)).toBe(false);
  });

  it('refuses a missing address', () => {
    const env = { AUTH_ALLOWED_EMAILS: 'coach@example.org' };
    expect(isAllowed(null, env)).toBe(false);
    expect(isAllowed(undefined, env)).toBe(false);
    expect(isAllowed('', env)).toBe(false);
  });

  it('admits a listed address regardless of case or padding', () => {
    const env = { AUTH_ALLOWED_EMAILS: ' Coach@Example.org , second@example.org ' };
    expect(isAllowed('coach@example.org', env)).toBe(true);
    expect(isAllowed('  COACH@EXAMPLE.ORG  ', env)).toBe(true);
    expect(isAllowed('second@example.org', env)).toBe(true);
  });
});

describe('allowedEmails', () => {
  it('normalizes and drops empty entries', () => {
    expect(allowedEmails({ AUTH_ALLOWED_EMAILS: ' A@b.org ,, C@d.org, ' })).toEqual([
      'a@b.org',
      'c@d.org',
    ]);
  });

  it('is empty when unset', () => {
    expect(allowedEmails({})).toEqual([]);
  });
});
