/**
 * LOCAL ONLY — `pnpm test:local`. Never CI.
 *
 * The other half of issue #56's proof: `Banner.test.tsx` shows the plugin
 * reaches the default lane's `.tsx` include; this shows it reaches the local
 * lane's too, since both configs pull `sharedPlugins` from the same
 * `vitest.shared.ts` rather than one of them registering it locally.
 *
 * It reads the real corpus, per the split this lane exists for (see
 * `vitest.shared.ts`) — a payload count, nothing that could carry a name.
 */

import { readdir } from 'node:fs/promises';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { corpusPath } from '../lib/fixtures.ts';
import { Banner } from './Banner.tsx';

describe('Banner against the real corpus', () => {
  it('renders a real payload count with no per-file JSX pragma', async () => {
    const files = await readdir(corpusPath('2026'));
    const count = files.filter((name) => name.endsWith('.json')).length;
    expect(count).toBeGreaterThan(0);

    const markup = renderToStaticMarkup(<Banner>{count} 2026 payloads</Banner>);
    expect(markup).toContain(`${count} 2026 payloads`);
  });
});
