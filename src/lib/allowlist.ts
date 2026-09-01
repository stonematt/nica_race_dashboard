/**
 * The email allowlist. Per-coach accounts, not a shared password — the exact
 * mechanism the privacy review (issue #3) specified.
 *
 * This is the single gate. A provider proving someone controls an address does
 * not admit them; being on this list does. There is no bypass token, no demo
 * account, and no share link, by decision.
 */

export function allowedEmails(env = process.env): string[] {
  return (env.AUTH_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAllowed(email: string | null | undefined, env = process.env): boolean {
  if (!email) return false;
  const list = allowedEmails(env);
  // An empty allowlist admits nobody. Failing closed matters more here than
  // convenience: the app renders minors' names.
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}
