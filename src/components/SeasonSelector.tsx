'use client';

import { usePathname, useRouter } from 'next/navigation';
import { rewriteSeasonSegment } from './season-selector.ts';

/**
 * The persistent season selector (issue #88): rewrites the URL's `[season]`
 * segment and preserves the rest of the path, rather than filtering a page in
 * place. Season is the ambient frame every view sits inside (CONTEXT.md), so
 * moving between seasons has to be a navigation, not a re-render.
 *
 * Lives in `src/app/[season]/layout.tsx` so it persists across every route
 * under the segment, present and future.
 */
export function SeasonSelector({
  currentYear,
  seasonYears,
}: {
  currentYear: number;
  seasonYears: number[];
}) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-sm text-white/80">
      <span className="sr-only">Season</span>
      <select
        value={String(currentYear)}
        onChange={(event) => router.push(rewriteSeasonSegment(pathname, event.target.value))}
        className="border-border bg-surface text-fg rounded border px-2 py-1 font-semibold"
      >
        {seasonYears.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
    </label>
  );
}
