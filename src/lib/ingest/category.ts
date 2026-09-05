/**
 * The published category string, and the canonical one beside it.
 *
 * The source publishes a category as a `data` group key — `#3_HS2 Boys - North`
 * — and it is not clean. Across the 2025 season there are 43 distinct strings
 * for 14 logical categories: conference events suffix ` - North` / ` - South`,
 * State Champs suffixes nothing, and two spelling defects are stable at every
 * South-carrying event (`HS2 Boys- South`, missing the space before the dash,
 * and `HS2 Girl - South`, singular). Seven of eight apparent mid-season
 * upgrades league-wide turned out to be this drift rather than a real upgrade.
 *
 * So the raw string is stored verbatim and never keyed on, and the canonical
 * form is stored beside it. **An unrecognized category is fatal** — the whole
 * point of normalizing here is that a new spelling defect must announce itself
 * rather than quietly split a peer group in two.
 *
 * A note on the column names, because they read oddly. `individual_result`
 * calls these `category_level`, `category_grade_band` and `category_gender`,
 * and `v_individual_result` — which is the app's read path and is frozen —
 * does `coalesce(ir.category_level, <the conference-stripped raw string>)` and
 * aliases the result `category`. That fixes the meaning: `category_level`
 * holds the whole canonical category (`HS2 Girls`), not a level token. Writing
 * `HS` there would make the view partition HS1, HS2 and HS3 into one bucket.
 * The level/gender split lives in the other two columns.
 */

import { IngestError } from './errors.ts';
import { stripGroupOrdinal } from './rows.ts';

/** A category string that does not resolve to one of the fourteen. */
export class CategoryError extends IngestError {}

/** The seven bands, in the order the league ranks them. */
export const GRADE_BANDS = ['MS1', 'MS2', 'MS3', 'HS1', 'HS2', 'HS3', 'Varsity'] as const;
export type GradeBand = (typeof GRADE_BANDS)[number];

export const GENDERS = ['Boys', 'Girls'] as const;
export type Gender = (typeof GENDERS)[number];

export type Conference = 'North' | 'South';

export interface NormalizedCategory {
  /** The group key with its `#N_` ordinal prefix removed, otherwise verbatim. */
  raw: string;
  /** The canonical category — `HS2 Girls`. What `v_individual_result` reads. */
  canonical: string;
  gradeBand: GradeBand;
  gender: Gender;
  /** Null at State Champs, which suffixes nothing. */
  conference: Conference | null;
}

/**
 * Split a published category into its canonical parts.
 *
 * The conference pattern tolerates the missing space (`Boys- South`) on
 * purpose: that is a published defect, not an input to guess at. `Girl` is
 * repaired to `Girls` only as a whole trailing word, so a future `Girlz` fails
 * loudly instead of being silently absorbed.
 */
export function normalizeCategory(groupKey: string): NormalizedCategory {
  const raw = stripGroupOrdinal(groupKey);

  const suffix = /\s*-\s*(North|South)\s*$/.exec(raw);
  const conference = (suffix?.[1] ?? null) as Conference | null;
  const base = (suffix ? raw.slice(0, suffix.index) : raw).trim().replace(/\bGirl$/, 'Girls');

  const parts = base.split(/\s+/);
  const gradeBand = parts[0] as GradeBand;
  const gender = parts[1] as Gender;

  if (parts.length !== 2 || !GRADE_BANDS.includes(gradeBand) || !GENDERS.includes(gender)) {
    throw new CategoryError(
      `"${groupKey}" does not resolve to one of the ${GRADE_BANDS.length * GENDERS.length} published categories ` +
        `(${GRADE_BANDS.join('/')} × ${GENDERS.join('/')}, optionally suffixed - North or - South). ` +
        'A new spelling defect must be added here deliberately, never absorbed.',
    );
  }

  return { raw, canonical: `${gradeBand} ${gender}`, gradeBand, gender, conference };
}
