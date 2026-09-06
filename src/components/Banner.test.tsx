/**
 * Trivial render proof for issue #56: no `@jsxRuntime` pragma anywhere in this
 * file. If the vitest config ever stops registering `@vitejs/plugin-react`,
 * this is the test that goes red with `React is not defined` — pointing
 * straight at the config rather than at Banner.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Banner } from './Banner.tsx';

describe('Banner', () => {
  it('renders its children with no per-file JSX pragma', () => {
    const markup = renderToStaticMarkup(<Banner>Race Day</Banner>);
    expect(markup).toContain('Race Day');
  });
});
