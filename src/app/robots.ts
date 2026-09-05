import type { MetadataRoute } from 'next';

/**
 * Nothing here is for a crawler. The app renders minors' names behind auth, so
 * the whole tree is disallowed regardless of what the gate is doing — issue #3.
 * `/robots.txt` is one of the few paths the middleware matcher exempts, so this
 * route serves to an anonymous request by design.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', disallow: '/' },
  };
}
