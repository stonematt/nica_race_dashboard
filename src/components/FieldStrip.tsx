/** @jsxRuntime automatic */
/** @jsxImportSource react */
/*
 * The two pragmas above are for the test runner, not for Next.
 *
 * `tsconfig.json` sets `jsx: "preserve"` (Next compiles JSX itself) and the
 * vitest configs register no React plugin, so esbuild falls back to the classic
 * `React.createElement` transform and a component under test dies with
 * "React is not defined". The pragmas switch this file to the automatic runtime
 * for esbuild; SWC already uses it, so they change nothing about the build.
 *
 * Stated per file rather than fixed centrally because `vitest.shared.ts` and
 * both configs are owned elsewhere this cycle. If a config gains
 * `@vitejs/plugin-react`, delete these two lines.
 */

import { buildFieldStrip, type FieldMark, type OutsideMark } from './field-strip.ts';

/**
 * The app's core chart. One rider — or several — placed against a whole field
 * by percent back from the winner.
 *
 * Race detail draws one per rider, rider detail one per race started, and
 * club-vs-league one per category. The component knows about none of that: it
 * takes marks and draws them, and `field-strip.ts` holds the contract and the
 * invariant that a rider with no comparable time gets no position on the axis.
 */
export type FieldStripProps = {
  marks: readonly FieldMark[];
  /** Riders the axis cannot hold. Rendered beneath it, never on it. */
  outside?: readonly OutsideMark[];
  /** `sm` sits inside a rider card; `md` stands on its own. */
  size?: 'sm' | 'md';
  caption?: string;
  /** Axis ceiling in percent back. Defaults to the slowest placed rider. */
  max?: number;
};

/** Geometry per size, in px. The SVG has no viewBox, so these are real pixels. */
const GEOMETRY = {
  sm: { height: 34, axisY: 17, dot: 3.5, ours: 6 },
  md: { height: 56, axisY: 28, dot: 4.5, ours: 7.5 },
} as const;

/**
 * Marks are positioned with percentage `cx`, inset 4% at each end so a rider on
 * the winner's time or at the axis ceiling still draws a whole dot. Radii stay
 * in pixels, so the dots are round at every width.
 */
const inset = (x: number) => `${(4 + x * 92).toFixed(3)}%`;

export function FieldStrip({ marks, outside = [], size = 'md', caption, max }: FieldStripProps) {
  const model = buildFieldStrip(marks, outside, max);
  const g = GEOMETRY[size];

  return (
    <figure className="m-0">
      {caption ? (
        <figcaption className="text-muted mb-1 text-[11px] font-bold tracking-wider uppercase">
          {caption}
        </figcaption>
      ) : null}

      <svg
        role="img"
        aria-label={model.description}
        width="100%"
        height={g.height}
        className="border-border bg-surface block rounded-md border"
      >
        <title>{model.description}</title>
        <line
          x1="0"
          x2="100%"
          y1={g.axisY}
          y2={g.axisY}
          className="stroke-border"
          strokeWidth={1}
        />
        {model.dots.map((dot, i) =>
          dot.ours ? (
            // Orange is the highlight and the ink ring carries the contrast, so
            // the mark is not distinguished by colour alone (docs/brand.md).
            <circle
              key={`ours-${i}`}
              cx={inset(dot.x)}
              cy={g.axisY}
              r={g.ours}
              className="fill-accent stroke-fg"
              strokeWidth={2}
            />
          ) : (
            <circle
              key={`field-${i}`}
              cx={inset(dot.x)}
              cy={g.axisY}
              r={g.dot}
              className="fill-muted/40"
            />
          ),
        )}
      </svg>

      <div className="text-muted mt-0.5 flex justify-between text-[10px] font-bold">
        <span className="text-fg">winner</span>
        <span>+{Math.round(model.max)}%</span>
      </div>

      {model.outside.length > 0 ? (
        <ul className="mt-1.5 flex list-none flex-wrap gap-1.5 p-0">
          {model.outside.map((mark) => (
            <li
              key={mark.text}
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                mark.kind === 'dnf' ? 'bg-fg text-bg' : 'bg-navy text-white'
              }`}
            >
              {mark.text}
            </li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}
