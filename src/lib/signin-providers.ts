/**
 * Which sign-in methods this deployment actually offers.
 *
 * One function, two callers: src/auth.ts registers providers from it, and the
 * sign-in page renders forms from it. They were duplicated logic at first, and
 * duplicated logic here fails in the worst direction — a page offering a form
 * for a provider that was never registered, or worse, hiding one that was.
 *
 * Kept import-free for the same reason as src/lib/allowlist.ts: it is read from
 * a server component, from Node, and from vitest with an injected env.
 */

export type ProviderEnv = Record<string, string | undefined>;

export interface AvailableProviders {
  /** Nodemailer magic link. The only production path. */
  email: boolean;
  /**
   * The development credentials shim. Two conditions, both required, because
   * either one alone has been enough to ship a second sign-in path by accident.
   * It still runs the allowlist — it skips the mail server, not the gate.
   */
  dev: boolean;
}

export function availableProviders(env: ProviderEnv = process.env): AvailableProviders {
  return {
    email: Boolean(env.AUTH_EMAIL_SERVER),
    dev: env.NODE_ENV === 'development' && env.AUTH_DEV_LOGIN === '1',
  };
}
