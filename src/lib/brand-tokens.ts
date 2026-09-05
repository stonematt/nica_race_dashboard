/**
 * Comparing the vendored brand tokens against their upstream source.
 *
 * `src/app/globals.css` holds a hand copy of the `:root` block in
 * `../scd-brand/DESIGN.md`. `scd-brand` is private and this repo is public, so
 * a submodule cannot fetch and CI cannot check — the copy is the only workable
 * transport, and this comparison is what keeps it honest. Issue #13; reasoning
 * and the reskin procedure in `docs/brand.md`.
 *
 * The filesystem half lives in `bin/brand-check.ts`. Everything here is pure so
 * it can be tested without the sibling repo present, which is the whole point:
 * a drift check nobody has proven can *detect* drift is decoration.
 */

/** DESIGN.md's bare token names, mapped to the Tailwind 4 namespace this repo uses. */
const NAMESPACE: Record<string, string> = {
  bg: 'color',
  surface: 'color',
  fg: 'color',
  muted: 'color',
  border: 'color',
  accent: 'color',
  blue: 'color',
  aqua: 'color',
  navy: 'color',
  brown: 'color',
  success: 'color',
  warn: 'color',
  danger: 'color',
};

/** The vendored name for one of DESIGN.md's bare token names. */
export function vendoredName(upstreamName: string): string {
  const ns = NAMESPACE[upstreamName];
  return ns ? `${ns}-${upstreamName}` : upstreamName;
}

/**
 * Reduce a declaration to the value it actually asserts.
 *
 * Comparison is by normalized value, never by character: Prettier reformats
 * this repo's copy and DESIGN.md is hand-aligned, so textual identity is not a
 * property the copy can hold. Three rewrites are absorbed as formatting rather
 * than reported as drift:
 *
 * - trailing zeros in decimals — DESIGN.md's `oklch(58% 0.20 28)` is Prettier's
 *   `oklch(58% 0.2 28)`;
 * - whitespace, including DESIGN.md's column alignment and Prettier's wrapping
 *   of a long font stack across two lines;
 * - the `var(--font-*-face), ` prefix that `layout.tsx`'s self-hosted faces
 *   prepend to the two font stacks — that prefix is this repo's addition, not
 *   a divergence from upstream.
 */
export function normalize(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*var\(--font-[a-z-]+-face\)\s*,\s*/, '')
    .replace(/(\d+)\.(\d*?)0+(?=\D|$)/g, (_m, whole, frac) => (frac ? `${whole}.${frac}` : whole))
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ',')
    .trim();
}

/** Parse every `--name: value;` declaration out of a CSS block body. */
export function parseDeclarations(block: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const [, name, value] of block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(name, normalize(value));
  }
  return out;
}

/**
 * Slice out the body of a brace-delimited block introduced by `opener`.
 *
 * Throws rather than returning empty: a silently empty block would compare zero
 * tokens and report success, which is the one failure this check must not have.
 */
export function extractBlock(source: string, opener: RegExp, label: string): string {
  const start = source.match(opener);
  if (start?.index === undefined) {
    throw new Error(`Could not find the ${label} block — has its shape changed?`);
  }
  const from = source.indexOf('{', start.index);
  const to = source.indexOf('}', from);
  if (from === -1 || to === -1) {
    throw new Error(`The ${label} block is not brace-delimited — has its shape changed?`);
  }
  return source.slice(from + 1, to);
}

export type Drift =
  | { kind: 'missing'; token: string; upstream: string }
  | { kind: 'drifted'; token: string; upstream: string; vendored: string };

/**
 * Every way the vendored copy fails to assert what upstream asserts.
 *
 * Deliberately one-directional: a token this repo adds and DESIGN.md does not
 * have is not drift. The app is free to declare its own tokens (`@theme` is
 * also where a reskin lands); what it may not do is silently disagree with the
 * brand about a token they share.
 */
export function findDrift(upstream: Map<string, string>, vendored: Map<string, string>): Drift[] {
  const drift: Drift[] = [];

  for (const [name, upstreamValue] of upstream) {
    const token = vendoredName(name);
    const vendoredValue = vendored.get(token);

    if (vendoredValue === undefined) {
      drift.push({ kind: 'missing', token, upstream: upstreamValue });
    } else if (vendoredValue !== upstreamValue) {
      drift.push({ kind: 'drifted', token, upstream: upstreamValue, vendored: vendoredValue });
    }
  }

  return drift;
}

/** One human-readable line per drift, for the CLI. */
export function describeDrift(drift: Drift): string {
  return drift.kind === 'missing'
    ? `missing   --${drift.token}: DESIGN.md has \`${drift.upstream}\`, globals.css has no such token`
    : `drifted   --${drift.token}: DESIGN.md \`${drift.upstream}\` vs globals.css \`${drift.vendored}\``;
}
