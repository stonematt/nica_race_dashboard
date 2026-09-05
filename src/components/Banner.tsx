/**
 * The app banner. Navy ground, orange highlight — the palette decision on the
 * wayfinder map (issue #1): full-bleed orange is too intense to read against,
 * so navy #405C80 carries the band and orange takes the wordmark, the rule, and
 * the marks that matter. This is the logo's own primary colorway.
 */
export function Banner({ children }: { children?: React.ReactNode }) {
  return (
    <header className="bg-navy border-accent border-b-4">
      <div className="mx-auto flex max-w-5xl flex-wrap items-baseline gap-x-4 gap-y-1 px-6 py-5">
        <span className="text-accent font-display text-3xl leading-none tracking-wide uppercase">
          Descenders
        </span>
        <span className="font-body text-sm text-white/80">Race Dashboard</span>
        <div className="ml-auto flex items-baseline gap-4 text-sm text-white/80">{children}</div>
      </div>
    </header>
  );
}
