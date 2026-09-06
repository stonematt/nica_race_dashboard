import { FieldStrip } from './FieldStrip.tsx';
import type { Chip, LapDisplay, RiderCard, SquadCard, UnmappedRider } from './race-detail.ts';
import type { FieldMark } from './field-strip.ts';

/**
 * Squad cards and the field strip — the report shape the prototype settled
 * (issue #8) and the map records: **squad is the frame, not a filter.** The
 * page is grouped by squad, one card per rider, and a rider's card carries the
 * strip for their own category's field.
 *
 * Every string on a card comes from the view model in `race-detail.ts`. Nothing
 * here decides what a number means; this file decides where it sits.
 */

const CHIP_TONE: Record<Chip['tone'], string> = {
  dnf: 'bg-fg text-bg',
  lapped: 'bg-navy text-white',
  // Orange is a highlight, never a field — and ink on orange, never white.
  good: 'bg-accent on-accent',
};

function Chips({ chips }: { chips: readonly Chip[] }) {
  if (chips.length === 0) return null;
  return (
    <ul className="mt-3 flex list-none flex-wrap gap-1.5 p-0">
      {chips.map((chip) => (
        <li
          key={chip.text}
          className={`rounded px-2 py-0.5 text-[11px] font-semibold ${CHIP_TONE[chip.tone]}`}
        >
          {chip.text}
        </li>
      ))}
    </ul>
  );
}

/**
 * Lap splits, per rider.
 *
 * A single split renders as a value rather than a full-width bar — a lone bar
 * has nothing to compare itself to. The model decides which case this is; the
 * component only draws it.
 */
function Laps({ laps }: { laps: LapDisplay }) {
  if (laps.kind === 'none') return null;

  if (laps.kind === 'value') {
    return (
      <p className="text-muted mt-3 text-xs">
        <span className="font-bold tracking-wider uppercase">{laps.label}</span>{' '}
        <span className="text-fg tabular-nums">{laps.value}</span>
      </p>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex h-10 items-end gap-1" aria-hidden="true">
        {laps.bars.map((bar, i) => (
          <div
            key={`${bar.label}-${i}`}
            style={{ height: `${bar.height}%` }}
            className={`min-h-[3px] flex-1 rounded-t-sm ${bar.best ? 'bg-accent' : 'bg-navy'}`}
          />
        ))}
      </div>
      <div className="text-muted mt-1 flex gap-1 text-[9px] tabular-nums">
        {laps.bars.map((bar, i) => (
          <span key={`${bar.label}-${i}`} className="flex-1 text-center">
            {bar.label}
          </span>
        ))}
      </div>
      <p className="sr-only">
        Lap splits: {laps.bars.map((bar) => bar.label).join(', ')}. Fastest lap{' '}
        {laps.bars.find((bar) => bar.best)?.label}.
      </p>
    </div>
  );
}

/**
 * The headline number.
 *
 * Orange only for percent back — it is the spine metric, and orange marks the
 * number that matters. A lap deficit, a place and a DNF are quiet: they are
 * facts about the race rather than a comparison the rider won.
 */
function Headline({ card }: { card: RiderCard }) {
  const orange = card.headline.kind === 'pct-back';
  return (
    <div className="text-right">
      <div
        className={`font-display text-3xl leading-none ${orange ? 'text-accent' : 'text-muted'}`}
      >
        {card.headline.value}
      </div>
      {card.headline.caption ? (
        <div className="text-muted text-[11px]">{card.headline.caption}</div>
      ) : null}
    </div>
  );
}

export function RiderCardView({ card, field }: { card: RiderCard; field: readonly FieldMark[] }) {
  return (
    <li
      className={`border-border bg-surface rounded-lg border border-t-4 p-4 shadow-sm ${
        card.isDnf ? 'border-t-fg' : 'border-t-navy'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg leading-tight tracking-wide uppercase">
            {card.name}
          </h3>
          <p className="text-muted text-xs">{card.subline}</p>
        </div>
        <Headline card={card} />
      </div>

      <div className="mt-3">
        <FieldStrip
          marks={field}
          outside={card.outside ? [card.outside] : []}
          size="sm"
          caption={`${field.length} started · ${card.category}`}
        />
      </div>

      <dl className="mt-3 grid grid-cols-4 gap-2 text-xs">
        {card.stats.map((stat) => (
          <div key={stat.label}>
            <dt className="text-muted text-[10px] font-bold tracking-wider uppercase">
              {stat.label}
            </dt>
            <dd className="tabular-nums">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <Laps laps={card.laps} />
      <Chips chips={card.chips} />
    </li>
  );
}

export function SquadSection({ squad }: { squad: SquadCard }) {
  return (
    <section className="mt-8">
      <div className="border-fg flex flex-wrap items-baseline justify-between gap-x-4 border-b-[3px] pb-1">
        <h2 className="font-display text-2xl tracking-wide uppercase">{squad.name}</h2>
        <p className="text-muted text-sm">{squad.summary}</p>
      </div>

      {squad.riders.length === 0 ? (
        <p className="text-muted mt-4 text-sm">Nobody from this squad started this race.</p>
      ) : (
        <ul className="mt-4 grid list-none gap-4 p-0 sm:grid-cols-2">
          {squad.riders.map((rider) => (
            <RiderCardView key={rider.card.plate} card={rider.card} field={rider.field} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The unmapped-rider warning, driven by `v_unmapped_rider`.
 *
 * A real UI element rather than a log line: a rider racing for one of the
 * club's scoring teams with no plate mapping is counted in the field but
 * tracked nowhere, and the fix is a config edit somebody has to be told to
 * make. The view resolves this live against config, so it goes quiet on its own
 * once the mapping lands — no re-ingest, no cache to clear.
 */
export function UnmappedWarning({ riders }: { riders: readonly UnmappedRider[] }) {
  if (riders.length === 0) return null;

  return (
    <aside
      className="border-border border-l-warn bg-surface mt-8 rounded-md border border-l-[6px] p-4"
      aria-labelledby="unmapped-heading"
    >
      <h2 id="unmapped-heading" className="font-display text-base tracking-wide uppercase">
        {riders.length} rider{riders.length === 1 ? '' : 's'} not on the roster
      </h2>
      <p className="text-muted mt-1 text-sm">
        They raced for a Descenders scoring team but no plate mapping exists, so they are counted in
        the field and tracked nowhere. Add them to <code>config/club-seed.json</code> and re-seed.
      </p>
      <ul className="mt-2 list-none p-0 text-sm">
        {riders.map((rider) => (
          <li key={rider.plate} className="tabular-nums">
            plate {rider.plate} — <span className="font-semibold">{rider.name}</span>{' '}
            <span className="text-muted">· {rider.scoringTeam}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
