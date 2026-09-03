import type { Metadata } from 'next';
import { Anton, Nunito } from 'next/font/google';
import './globals.css';

/*
 * Faces are self-hosted, not linked from a CDN. `next/font/google` downloads
 * them at build time and serves them from this app's own origin, so a page load
 * makes no third-party request and needs no network at all.
 *
 * That is an operational requirement before it is a privacy one: this app is
 * opened at race venues on shared wifi, bound to loopback (issue #33). A
 * `fonts.gstatic.com` link would hang or flash fallback text on a page whose
 * whole job is being readable in a parking lot. Privacy agrees — issue #3's
 * posture is `noindex` and no third-party requests, and a CDN font would send
 * every coach's IP and referer to Google on every page view.
 *
 * The cost: a cold-cache `pnpm build` needs the network once per machine.
 *
 * Anton ships one weight. Nunito is variable, so no weight list is given.
 * Both bind to the `--font-*` custom properties `globals.css` already declares,
 * which keeps the `@theme` block the single place a face is named. See
 * `docs/brand.md`.
 */
const anton = Anton({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-display-face',
});

const nunito = Nunito({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body-face',
});

/**
 * `noindex` is asserted twice on purpose: here in the document, and as an
 * `X-Robots-Tag` header in next.config.ts. The header covers responses a
 * crawler reads without parsing HTML; the meta tag covers the rest. Issue #3.
 */
export const metadata: Metadata = {
  title: 'Descenders Race Dashboard',
  description: 'Oregon league race results for the Salem Composite Descenders.',
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${anton.variable} ${nunito.variable}`}>
      <body className="bg-bg text-fg font-body min-h-dvh antialiased">{children}</body>
    </html>
  );
}
