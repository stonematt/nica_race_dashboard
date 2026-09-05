/**
 * The email allowlist. Per-coach accounts, not a shared password — the exact
 * mechanism the privacy review (issue #3) specified.
 *
 * A provider proving someone controls an address does not admit them; being on
 * this list does. There is no bypass token, no demo account, and no share link,
 * by decision.
 *
 * One exception exists and it is not reachable from a deployment: the
 * development shim skips this list entirely (issue #33). It registers only
 * under NODE_ENV=development with AUTH_DEV_LOGIN=1, and `pnpm dev` binds
 * loopback, so what it admits people to is reachable from nowhere but the
 * machine running it. src/lib/admission.ts owns that branch — this file knows
 * nothing about it, and nothing here should grow a second one.
 *
 * Kept free of imports on purpose: it runs in the Edge runtime from
 * src/auth.config.ts, in Node from src/auth.ts, and under vitest with an
 * injected env. Anything pulled in here has to survive all three.
 */

/**
 * An environment to read the list from. Deliberately an index signature rather
 * than `{ AUTH_ALLOWED_EMAILS?: string }` — Node's `ProcessEnv` declares no
 * properties of its own, so the narrower shape trips TypeScript's weak-type
 * check and `process.env` will not assign to it.
 */
export type AllowlistEnv = Record<string, string | undefined>;

/** Addresses compare case-insensitively and ignore surrounding whitespace. */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function allowedEmails(env: AllowlistEnv = process.env): string[] {
  return (env.AUTH_ALLOWED_EMAILS ?? '').split(',').map(normalizeEmail).filter(Boolean);
}

export function isAllowed(
  email: string | null | undefined,
  env: AllowlistEnv = process.env,
): boolean {
  if (!email) return false;
  const list = allowedEmails(env);
  // An empty allowlist admits nobody. Failing closed matters more here than
  // convenience: the app renders minors' names.
  if (list.length === 0) return false;
  return list.includes(normalizeEmail(email));
}
