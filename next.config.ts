import type { NextConfig } from 'next';

const config: NextConfig = {
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
