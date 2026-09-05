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
import { NO_AXIS_REASON } from './field-strip.ts';
import { RiderCardView, SquadSection, UnmappedWarning } from './RaceDetail.tsx';
import { buildSquadCard, categoryMarks, type RaceResultRow } from './race-detail.ts';

function row(over: Partial<RaceResultRow> = {}): RaceResultRow {
  return {
    plate: '974',
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

/*
 * Issue #60. The corpus prologue is a time trial, so `v_race_result` publishes
 * no percent back for anyone in the category — the whole field is unplaceable
 * at once. The strip drew its frame anyway, labelled with the axis floor, on
 * every one of the event's 25 cards.
 *
 * The data layer already asserted the field was all-null and was right to. This
 * is the other half of that seam: what a coach is shown once it is.
 */
describe('a race that published no gap to the winner', () => {
  const timeTrial = row({
    pctBack: null,
    place: '69',
    fieldSize: 135,
    fieldTopPct: 29,
    timeRaw: '53:28.25',
    lapSplits: [],
    lapSeconds: [],
  });

  function renderTimeTrial(): string {
    const field = [timeTrial, row({ plate: '820', pctBack: null, place: '72' })];
    const squad = buildSquadCard(
      'Descenders',
      [{ row: timeTrial, name: '«RIDER-N»' }],
      new Map([[timeTrial.category, field]]),
    );
    const rider = squad.riders[0]!;
    return renderToStaticMarkup(<RiderCardView card={rider.card} field={rider.field} />);
  }

  it('draws no strip, because there is nothing to plot', () => {
    const markup = renderTimeTrial();
    expect(markup).not.toContain('<svg');
    expect(markup).not.toContain('<circle');
  });

  it('shows no axis percentage, which was the floor and measured nothing', () => {
    // The axis ceiling is the only `+N%` the card can carry; the percentile is
    // written `top N%` and is a different claim. Match the ceiling's own form
    // so unrelated future copy cannot fail this.
    expect(renderTimeTrial()).not.toMatch(/\+\d+(\.\d+)?%/);
  });

  it('says why there is no strip, in terms that do not assume the word prologue', () => {
    expect(renderTimeTrial()).toContain(NO_AXIS_REASON);
  });

  it('keeps every cell the coach came for, not only the ones the strip replaced', () => {
    // Read as a person reads it: tags out, text left, so a bare `69` in a class
    // name cannot stand in for the place. All five criteria of issue #60's
    // untouched-content rule, asserted where they are actually labelled.
    const text = renderTimeTrial().replace(/<[^>]*>/g, '|');

    expect(text).toContain('|Place||69 / 135|');
    expect(text).toContain('|Time||53:28.25|');
    expect(text).toContain('|Points||500|');
    expect(text).toContain('|Field||top 29%|');
    expect(text).toContain('|69||of 135|');
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

  it('stands on its own at md, and sits inside a card at sm', () => {
    // Race detail only ever asks for `sm`. `md` is what rider detail and
    // club-vs-league will stack, so it is drawn here rather than left to be
    // discovered broken by the view that first needs it.
    const marks = [
      { pct: 0, ours: false },
      { pct: 12, ours: true, label: '«RIDER-A»' },
    ];
    const md = renderToStaticMarkup(<FieldStrip marks={marks} size="md" />);
    const sm = renderToStaticMarkup(<FieldStrip marks={marks} size="sm" />);

    expect(md).toContain('height="56"');
    expect(sm).toContain('height="34"');
    // Both draw the same two riders; only the geometry changes.
    expect(md.match(/<circle/g)).toHaveLength(2);
    expect(sm.match(/<circle/g)).toHaveLength(2);
  });

  it('marks every club member when a view passes more than one', () => {
    const markup = renderToStaticMarkup(
      <FieldStrip
        size="md"
        marks={[
          { pct: 0, ours: false },
          { pct: 4, ours: true, label: '«RIDER-A»' },
          { pct: 22, ours: true, label: '«RIDER-B»' },
        ]}
      />,
    );
    expect(markup.match(/fill-accent/g)).toHaveLength(2);
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
