/**
 * Brand token drift check — `pnpm brand:check`.
 *
 * Diffs the vendored `@theme` block in `src/app/globals.css` against the
 * `:root` block in `../scd-brand/DESIGN.md`. The comparison itself lives in
 * `src/lib/brand-tokens.ts`, where it is tested; this file is the filesystem
 * and exit-code half.
 *
 * Local-only by construction: it **skips with exit 0** when the sibling repo is
 * absent. `scd-brand` is private and this repo is public, so CI can never run
 * this, and a fresh clone by anyone but the owner has no sibling — a check that
 * fails there is a check that gets deleted. Issue #13; see `docs/brand.md`.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  describeDrift,
  extractBlock,
  findDrift,
  parseDeclarations,
} from '../src/lib/brand-tokens.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const designPath = resolve(repoRoot, '../scd-brand/DESIGN.md');
const cssPath = resolve(repoRoot, 'src/app/globals.css');

if (!existsSync(designPath)) {
  console.log(`brand:check — skipped, no sibling brand repo at ${designPath}`);
  console.log('  Clone git@github.com:stonematt/scd-brand.git alongside this repo to enable it.');
  process.exit(0);
}

const upstream = parseDeclarations(
  extractBlock(readFileSync(designPath, 'utf8'), /:root\s*\{/, 'DESIGN.md :root'),
);
const vendored = parseDeclarations(
  extractBlock(readFileSync(cssPath, 'utf8'), /@theme\s*\{/, 'globals.css @theme'),
);

const drift = findDrift(upstream, vendored);

if (drift.length > 0) {
  console.error('brand:check — the vendored copy has drifted from ../scd-brand/DESIGN.md:\n');
  for (const d of drift) console.error(`  ${describeDrift(d)}`);
  console.error(
    '\nUpdate src/app/globals.css to match, then update the commit cited in its header:\n' +
      '  git -C ../scd-brand log --oneline -1 -- DESIGN.md\n' +
      'See docs/brand.md.',
  );
  process.exit(1);
}

console.log(`brand:check — ${upstream.size} tokens match ../scd-brand/DESIGN.md`);
