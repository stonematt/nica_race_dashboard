/** @jsxRuntime automatic */
/** @jsxImportSource react */
/*
 * The guards at the render boundary.
 *
 * `race-detail.test.ts` proves the rules; this proves the markup obeys them,
 * which is the half a model test cannot reach. Two of the ticket's criteria are
 * negative claims about what a coach sees — a lapped rider must show *no*
 * percentage, a single split must *not* be a bar — and a negative claim is only
 * really held by looking at the output.
 *
 * Rendered with `renderToStaticMarkup` rather than Testing Library: these are
 * server components with no state and no events, so there is nothing to drive,
 * and static markup runs in the `node` environment both lanes already use.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FieldStrip } from './FieldStrip.tsx';
import { RiderCardView, SquadSection, UnmappedWarning } from './RaceDetail.tsx';
import { buildSquadCard, categoryMarks, type RaceResultRow } from './race-detail.ts';

function row(over: Partial<RaceResultRow> = {}): RaceResultRow {
  return {
    plate: '974',
    displayName: '«RIDER-A»',
    category: 'HS1 Boys',
    place: '1',
    status: 'finished',
    timeRaw: '47:09.83',
    points: 500,
    isLapped: false,
    lapsDown: 0,
    pctBack: 0,
    fieldSize: 24,
    fieldTopPct: 4,
    scored: true,
    ptsLeader: false,
    grade: 9,
    lapSplits: ['15:42.11', '15:39.02', '15:48.70'],
    lapSeconds: [942.11, 939.02, 948.7],
    ...over,
  };
}

const lapped = row({
  plate: '204',
  place: '65',
  isLapped: true,
  lapsDown: 1,
  pctBack: null,
  fieldTopPct: 90,
  timeRaw: '49:10.82',
  points: 120,
  lapSplits: ['24:35.10', '24:35.72'],
  lapSeconds: [1475.1, 1475.72],
});

const dnf = row({
  plate: '928',
  place: '*',
  status: 'dnf',
  timeRaw: 'DNF',
  pctBack: null,
  isLapped: false,
  lapsDown: null,
  fieldTopPct: null,
  points: 80,
  scored: false,
  lapSplits: ['16:02.44'],
  lapSeconds: [962.44],
});

const FIELD = [row(), row({ plate: '886', pctBack: 19.6 }), lapped, dnf];

function renderCard(source: RaceResultRow, name: string): string {
  const squad = buildSquadCard(
    'Descenders',
    [{ row: source, name }],
    new Map([[source.category, FIELD]]),
  );
  const rider = squad.riders[0]!;
  return renderToStaticMarkup(<RiderCardView card={rider.card} field={rider.field} />);
}

describe('a lapped rider', () => {
  it('shows the lap deficit', () => {
    expect(renderCard(lapped, '«RIDER-B»')).toContain('−1 lap');
  });

  it('shows no percentage of their own, anywhere on the card', () => {
    // Read as a person reads it: tags out, text left. The only percentages that
    // may survive are the axis ceiling and the description that names it, both
    // of which are written `+N%` and are facts about the field rather than
    // about this rider. Take those out and no percent sign may remain — a
    // lapped rider's clock time is not comparable to the winner's, so any
    // percentage here would be the inversion this guard exists to prevent.
    const text = renderCard(lapped, '«RIDER-B»')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\+\d+(\.\d+)?%/g, '');
    expect(text).not.toContain('%');
    expect(text).toContain('−1 lap');
  });

  it('names them beside the strip rather than on it', () => {
    expect(renderCard(lapped, '«RIDER-B»')).toContain('«RIDER-B» — −1 lap · 65 of 24');
  });
});

describe('a DNF', () => {
  it('leads with DNF and keeps its published points', () => {
    const markup = renderCard(dnf, '«RIDER-C»');
    expect(markup).toContain('DNF');
    expect(markup).toContain('80');
  });

  it('imputes no place and no time', () => {
    // Three em-dashes: place, time and field position, all genuinely absent.
    const markup = renderCard(dnf, '«RIDER-C»');
    expect(markup.match(/—/g)?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('lap splits', () => {
  it('draws a bar per split when there is more than one', () => {
    const markup = renderCard(row(), '«RIDER-A»');
    expect(markup.match(/style="height:/g)).toHaveLength(3);
  });

  it('renders a single split as a value, not a full-width bar', () => {
    const markup = renderCard(dnf, '«RIDER-C»');
    expect(markup).toContain('16:02.44');
    expect(markup).not.toContain('style="height:');
  });
});

describe('a field with fewer than ten starters', () => {
  it('says how many started instead of showing a percentile', () => {
    const small = row({ fieldSize: 7, fieldTopPct: null, place: '3' });
    const markup = renderCard(small, '«RIDER-D»');
    expect(markup).toContain('7 started, too few to rank');
    expect(markup).not.toContain('top ');
  });
});

describe('the field strip', () => {
  it('draws one dot per placeable rider and none for the rest', () => {
    const markup = renderToStaticMarkup(
      <FieldStrip marks={categoryMarks(FIELD, new Set(['886']))} />,
    );
    // Four starters, two of them unplaceable.
    expect(markup.match(/<circle/g)).toHaveLength(2);
  });

  it('carries a text description for a reader that cannot see it', () => {
    const markup = renderToStaticMarkup(
      <FieldStrip
        marks={[
          { pct: 0, ours: false },
          { pct: 19.6, ours: true, label: '«RIDER-A»' },
        ]}
      />,
    );
    expect(markup).toContain('role="img"');
    expect(markup).toContain('«RIDER-A» at +19.6% back');
  });
});

describe('the squad frame', () => {
  it('heads the section with the squad and its own counts', () => {
    const squad = buildSquadCard(
      'Descenders',
      [
        { row: row(), name: '«RIDER-A»' },
        { row: lapped, name: '«RIDER-B»' },
        { row: dnf, name: '«RIDER-C»' },
      ],
      new Map([['HS1 Boys', FIELD]]),
    );
    const markup = renderToStaticMarkup(<SquadSection squad={squad} />);
    expect(markup).toContain('Descenders');
    expect(markup).toContain('3 raced · 2 scored · 1 DNF');
  });

  it('says so when nobody from a squad started', () => {
    const squad = buildSquadCard('Descenders', [], new Map());
    expect(renderToStaticMarkup(<SquadSection squad={squad} />)).toContain(
      'Nobody from this squad started this race',
    );
  });
});

describe('the unmapped-rider warning', () => {
  it('is a real element naming the riders it found', () => {
    const markup = renderToStaticMarkup(
      <UnmappedWarning
        riders={[
          { plate: '905', name: '«RIDER-E»', scoringTeam: 'Sprague High School Descenders' },
        ]}
      />,
    );
    expect(markup).toContain('1 rider not on the roster');
    expect(markup).toContain('plate 905');
    expect(markup).toContain('«RIDER-E»');
  });

  it('renders nothing at all when every plate is mapped', () => {
    expect(renderToStaticMarkup(<UnmappedWarning riders={[]} />)).toBe('');
  });
});
