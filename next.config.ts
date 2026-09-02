import type { NextConfig } from 'next';

const config: NextConfig = {
  /*
   * PGlite ships a WASM build and reads its own files with `fs` and a `URL`.
   * Bundled by Next, that read throws ERR_INVALID_ARG_TYPE the moment the
   * module is imported — during page-data collection, before any request. Left
   * external, Node resolves it and the driver works. Drizzle's Neon path will
   * want the same treatment when hosting lands (issue #6).
   */
  serverExternalPackages: ['@electric-sql/pglite'],

  // The whole app renders minors' names behind auth. Nothing here should be
  // indexed, cached by an intermediary, or embedded elsewhere. See issue #3.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
    ];
  },
};

export default config;
