/**
 * The persistent selector's whole contract, stated as data rather than as a
 * hook: rewrite the leading `[season]` segment of the current path and leave
 * everything after it alone. Split out of `SeasonSelector.tsx` the way
 * `field-strip.ts` sits beside `FieldStrip.tsx` — this half has no framework
 * hooks in it, so it runs under plain vitest with nothing to mock.
 */

/**
 * `pathname` is a Next `usePathname()` value: always leading-slash, never a
 * query string or hash. Replaces its first segment with `nextYear` and keeps
 * the rest verbatim, including a trailing slash if one was there.
 */
export function rewriteSeasonSegment(pathname: string, nextYear: string): string {
  const segments = pathname.split('/');
  // segments[0] is always '' for a leading-slash path; segments[1] is the
  // season. A bare "/" splits to ['', ''] and still has a slot to fill.
  if (segments.length < 2) return `/${nextYear}`;
  segments[1] = nextYear;
  return segments.join('/');
}
