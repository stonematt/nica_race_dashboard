import type { Metadata } from 'next';
import './globals.css';

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
    <html lang="en">
      <body className="bg-bg text-fg font-body min-h-dvh antialiased">{children}</body>
    </html>
  );
}
