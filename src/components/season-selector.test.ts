/**
 * The persistent selector's whole contract, isolated from the hooks that make
 * it persistent: rewrite the leading `[season]` segment, keep the rest of the
 * path (issue #88).
 */

import { describe, expect, it } from 'vitest';
import { rewriteSeasonSegment } from './season-selector.ts';

describe('rewriting the season segment', () => {
  it('replaces the season at the wall route itself', () => {
    expect(rewriteSeasonSegment('/2025', '2026')).toBe('/2026');
  });

  it('preserves everything after the season segment', () => {
    expect(rewriteSeasonSegment('/2025/round-3/squad/wolf-pack', '2026')).toBe(
      '/2026/round-3/squad/wolf-pack',
    );
  });

  it('preserves a trailing slash rather than dropping it', () => {
    expect(rewriteSeasonSegment('/2025/', '2026')).toBe('/2026/');
  });

  it('fills in a segment for the bare root', () => {
    expect(rewriteSeasonSegment('/', '2026')).toBe('/2026');
  });

  it('rewrites by position, so a later year-shaped segment is left alone', () => {
    // The season slot is index 1 and nothing else is inspected. A squad or a
    // Round whose slug happens to look like a year must survive the switch
    // untouched — pattern-matching for a year instead of taking the first
    // segment is the bug this pins.
    expect(rewriteSeasonSegment('/2025/squad/2025', '2026')).toBe('/2026/squad/2025');
  });
});
