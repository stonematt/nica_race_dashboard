/**
 * The race-detail view model: `v_race_result` rows in, renderable cards out.
 *
 * Every rule the page has to get right lives here as a pure function, because
 * each of these five is a real defect in the real data rather than a matter of
 * taste, and a rule you can call in a test is a rule that stays true:
 *
 *   1. A lapped rider renders `−1 lap` and **never a percentage**. At 2025 Race
 *      4 North a naive percent-back puts five 2-lap HS1 Boys ahead of the
 *      actual winner, because NICA pulls them at the line and scores them with
 *      a valid — and faster — clock time.
 *   2. A category with fewer than ten starters shows **no percentile**. HS2
 *      Girls fielded 7 at that event, and Varsity Girls fielded ONE at Race 2
 *      North; "100th percentile" over n=1 reads as an achievement.
 *   3. A percentile appears **only in the top half** of a field. Below the
 *      median the raw place says the same thing without flattering it.
 *   4. A **DNF** renders as the source marks it — no imputed time, no imputed
 *      place — and its **points are still shown**, because they were published.
 *   5. A rider on a club scoring team with **no plate mapping** appears in the
 *      warning, not silently among the cards.
 *
 * The one thing this module never does is arithmetic on a result. Percent back,
 * the percentile, the lap deficit and the lapped flag all arrive computed from
 * `v_race_result`; place, time and points are the source's own strings. **NICA
 * is the scoring authority** (issue #1) — this file decides what is shown, not
 * what is true.
 */

import type { FieldMark, OutsideMark } from './field-strip.ts';

/**
 * One row of `v_race_result`, narrowed to what the page reads.
 *
 * `lapSeconds` is parsed upstream, in the query layer, so nothing under
 * `src/components/` has to import the ingest decoder to draw a bar.
 */
export type RaceResultRow = {
  plate: string;
  category: string;
  /** Verbatim. `*` or `DNF` for a non-finisher — never rewritten. */
  place: string;
  status: 'finished' | 'dnf';
  /** Verbatim, `DNF` included. */
  timeRaw: string;
  points: number | null;
  isLapped: boolean;
  lapsDown: number | null;
  pctBack: number | null;
  fieldSize: number;
  fieldTopPct: number | null;
  scored: boolean;
  ptsLeader: boolean;
  grade: number | null;
  /** The published split strings, in order, only those the list carried. */
  lapSplits: string[];
  /** Those same splits in seconds. Same length as `lapSplits`, or empty. */
  lapSeconds: number[];
};

/** The big number on a card. Exactly one of three kinds — never a percentage
 *  for a rider whose time is not comparable. */
export type Headline =
  | { kind: 'pct-back'; value: string; caption: string }
  | { kind: 'laps-down'; value: string; caption: string }
  | { kind: 'place'; value: string; caption: string }
  | { kind: 'dnf'; value: string; caption: null };

export type Stat = { label: string; value: string };

export type LapDisplay =
  | { kind: 'none' }
  | { kind: 'value'; label: string; value: string }
  | { kind: 'bars'; bars: { label: string; seconds: number; height: number; best: boolean }[] };

export type Chip = { text: string; tone: 'lapped' | 'dnf' | 'good' };

export type RiderCard = {
  plate: string;
  name: string;
  category: string;
  subline: string;
  headline: Headline;
  stats: Stat[];
  laps: LapDisplay;
  chips: Chip[];
  isDnf: boolean;
  /** This rider's own mark, for the strip drawn on their card. */
  mark: FieldMark;
  /** Their entry beside the strip, when the axis cannot hold them. */
  outside: OutsideMark | null;
};

/** A rider's card together with the field their strip draws. */
export type PlacedRider = { card: RiderCard; field: FieldMark[] };

export type SquadCard = {
  name: string;
  summary: string;
  riders: PlacedRider[];
};

export type UnmappedRider = { plate: string; name: string; scoringTeam: string };

/** The minus sign is U+2212, not a hyphen. A lap deficit is a number, not a dash. */
export function lapsDownText(lapsDown: number): string {
  return `−${lapsDown} lap${lapsDown === 1 ? '' : 's'}`;
}

/**
 * The "Field" cell, and guards 2 and 3 in four lines.
 *
 * `v_race_result` already suppresses `field_top_pct` below ten starters; this
 * restates the reason in the text a coach reads, rather than showing an empty
 * cell they have to interpret. Above the median the percentile is the better
 * number; below it, it is a worse way of saying the place.
 */
export function fieldPosition(row: RaceResultRow): string | null {
  if (row.status === 'dnf') return null;
  if (row.fieldTopPct === null) return `${row.fieldSize} started, too few to rank`;
  if (row.fieldTopPct <= 50) return `top ${row.fieldTopPct}%`;
  return `${row.place} of ${row.fieldSize}`;
}

/**
 * Guard 1, and the reason this function exists at all.
 *
 * A percentage is offered only to a rider whose time is comparable to the
 * winner's. `pctBack` is null for everyone else — a DNF, a lapped rider, and
 * every rider in a time trial — and a null here becomes a different kind of
 * headline rather than a blank or a zero.
 */
export function headline(row: RaceResultRow): Headline {
  if (row.status === 'dnf') return { kind: 'dnf', value: 'DNF', caption: null };
  if (row.isLapped && row.lapsDown !== null) {
    return {
      kind: 'laps-down',
      value: lapsDownText(row.lapsDown),
      caption: `${row.place} of ${row.fieldSize}`,
    };
  }
  if (row.pctBack === null) {
    // Either a time trial — no lap count published anywhere in the list, so no
    // rider has a percent-back axis to sit on (issue #48) — or a row whose lap
    // count the view could not compare. Place carries the race either way, and
    // inventing a lap deficit to fill the space would be worse than not having
    // one.
    return { kind: 'place', value: row.place, caption: `of ${row.fieldSize}` };
  }
  return { kind: 'pct-back', value: `${row.pctBack}%`, caption: 'back' };
}

/**
 * Guard 4. Place, time and points exactly as published.
 *
 * A DNF has no place and no finish time, so both read `—`. Its **points are
 * shown**: NICA published them, a DNF is a normal outcome rather than an
 * anomaly (issue #1), and blanking the cell would lose a real fact.
 */
export function stats(row: RaceResultRow): Stat[] {
  const dnf = row.status === 'dnf';
  return [
    { label: 'Place', value: dnf ? '—' : `${row.place} / ${row.fieldSize}` },
    { label: 'Time', value: dnf ? '—' : row.timeRaw },
    { label: 'Points', value: row.points === null ? '—' : String(row.points) },
    { label: 'Field', value: fieldPosition(row) ?? '—' },
  ];
}

/**
 * Lap splits, drawn per rider.
 *
 * **One split is a value, not a chart.** A single full-width bar says nothing a
 * bar can say — there is nothing to compare it to — so it renders as the time
 * itself. Two or more get bars, with the fastest marked.
 *
 * The prototype decided this twice, in two places, on two different fields
 * (`lap_splits.length === 1` for the chip and `lap_secs.length > 1` for the
 * chart) and they agreed only by luck. One function decides it here.
 */
export function lapDisplay(row: RaceResultRow): LapDisplay {
  const splits = row.lapSplits;
  if (splits.length === 0) return { kind: 'none' };
  if (splits.length === 1) return { kind: 'value', label: 'Lap 1', value: splits[0]! };

  const seconds = row.lapSeconds;
  if (seconds.length !== splits.length || seconds.some((s) => !(s > 0))) {
    // A split we could not read is not a bar of height zero. Fall back to the
    // published strings, which are the fact; the chart is the interpretation.
    return { kind: 'value', label: 'Laps', value: splits.join(' · ') };
  }

  const slowest = Math.max(...seconds);
  const fastest = Math.min(...seconds);
  return {
    kind: 'bars',
    bars: seconds.map((s, i) => ({
      label: splits[i]!,
      seconds: s,
      height: Math.round((s / slowest) * 100),
      best: s === fastest,
    })),
  };
}

export function chips(row: RaceResultRow): Chip[] {
  const out: Chip[] = [];
  if (row.status === 'dnf') out.push({ text: 'DNF', tone: 'dnf' });
  else if (row.isLapped && row.lapsDown !== null) {
    out.push({ text: lapsDownText(row.lapsDown), tone: 'lapped' });
  }
  if (row.scored) out.push({ text: 'scored', tone: 'good' });
  if (row.ptsLeader) out.push({ text: 'pts leader', tone: 'good' });
  return out;
}

/** The strip mark for one rider. Null `pct` is the invariant, carried through. */
export function markFor(row: RaceResultRow, name: string): FieldMark {
  return { pct: row.pctBack, ours: true, label: name };
}

/** Their line beside the strip, when the axis has no place for them. */
export function outsideFor(row: RaceResultRow, name: string): OutsideMark | null {
  if (row.status === 'dnf') return { text: `${name} — DNF`, kind: 'dnf' };
  if (row.isLapped && row.lapsDown !== null) {
    return {
      text: `${name} — ${lapsDownText(row.lapsDown)} · ${row.place} of ${row.fieldSize}`,
      kind: 'lapped',
    };
  }
  return null;
}

export function riderCard(row: RaceResultRow, name: string): RiderCard {
  const grade = row.grade === null ? '' : ` · grade ${row.grade}`;
  return {
    plate: row.plate,
    name,
    category: row.category,
    subline: `${row.category}${grade} · plate ${row.plate}`,
    headline: headline(row),
    stats: stats(row),
    laps: lapDisplay(row),
    chips: chips(row),
    isDnf: row.status === 'dnf',
    mark: markFor(row, name),
    outside: outsideFor(row, name),
  };
}

/**
 * A squad's header line.
 *
 * Squad is the frame, not a filter (issue #1) — so the count that leads is how
 * many of this squad raced, not how many of the field are ours.
 */
export function squadSummary(rows: readonly RaceResultRow[]): string {
  const scored = rows.filter((r) => r.scored).length;
  const dnf = rows.filter((r) => r.status === 'dnf').length;
  const raced = `${rows.length} raced · ${scored} scored`;
  return dnf === 0 ? raced : `${raced} · ${dnf} DNF`;
}

/**
 * The whole field of one category, with the named riders highlighted.
 *
 * Every starter is passed through, lapped and DNF included, and the strip drops
 * the ones it cannot place. That is deliberate: filtering here would put the
 * invariant back in the caller, where two later views would each have to
 * remember it.
 */
export function categoryMarks(
  field: readonly RaceResultRow[],
  ourPlates: ReadonlySet<string>,
): FieldMark[] {
  return field.map((row) => ({ pct: row.pctBack, ours: ourPlates.has(row.plate) }));
}

/** One squad's result rows, paired with the fields their strips draw against. */
export function buildSquadCard(
  name: string,
  entries: readonly { row: RaceResultRow; name: string }[],
  fieldByCategory: ReadonlyMap<string, readonly RaceResultRow[]>,
): SquadCard {
  return {
    name,
    summary: squadSummary(entries.map((entry) => entry.row)),
    riders: entries.map((entry) => ({
      card: riderCard(entry.row, entry.name),
      // A category with no field rows should not happen — the rider's own row
      // is in it — but an empty strip is a better failure than a crash on a
      // page a coach opened at a race venue.
      field: categoryMarks(
        fieldByCategory.get(entry.row.category) ?? [entry.row],
        new Set([entry.row.plate]),
      ),
    })),
  };
}

/** Every starter, grouped by the category they raced. */
export function fieldsByCategory(rows: readonly RaceResultRow[]): Map<string, RaceResultRow[]> {
  const out = new Map<string, RaceResultRow[]>();
  for (const row of rows) {
    const field = out.get(row.category);
    if (field) field.push(row);
    else out.set(row.category, [row]);
  }
  return out;
}
