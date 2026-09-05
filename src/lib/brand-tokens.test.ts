import { describe, expect, it } from 'vitest';

import {
  describeDrift,
  extractBlock,
  findDrift,
  normalize,
  parseDeclarations,
  vendoredName,
} from './brand-tokens.ts';

/**
 * A drift check nobody has proven can *detect* drift is decoration, so the
 * detecting cases come first and the passing case last.
 *
 * These read fixture strings, never the sibling repo: `scd-brand` is private,
 * so a test that required it would fail for every clone but the owner's.
 */

/** DESIGN.md's shape: hand-aligned columns, trailing comment, three-on-one-line. */
const UPSTREAM = `:root {
  --bg:       oklch(98.3% 0.005 95);  /* #faf9f4 paper */
  --accent:   oklch(73% 0.187 52);    /* #FF8000 ORANGE — primary, most prominent */
  --navy:     oklch(45% 0.06 252);    /* #405C80 ground */
  --success: oklch(60% 0.13 150); --warn: oklch(78% 0.14 75); --danger: oklch(58% 0.20 28);
  --font-display: 'Anton','Oswald',Impact,sans-serif;  /* web equiv of official Impact */
}`;

/** This repo's shape: Tailwind namespace, Prettier spacing, self-hosted face prefix. */
const VENDORED = `@theme {
  --color-bg: oklch(98.3% 0.005 95); /* #faf9f4 paper */
  --color-accent: oklch(73% 0.187 52); /* #FF8000 ORANGE */
  --color-navy: oklch(45% 0.06 252); /* #405C80 ground */
  --color-success: oklch(60% 0.13 150);
  --color-warn: oklch(78% 0.14 75);
  --color-danger: oklch(58% 0.2 28);

  --font-display: var(--font-display-face), 'Anton', 'Oswald', Impact, sans-serif;
}`;

const upstreamTokens = () => parseDeclarations(extractBlock(UPSTREAM, /:root\s*\{/, 'test'));
const vendoredTokens = (css = VENDORED) =>
  parseDeclarations(extractBlock(css, /@theme\s*\{/, 'test'));

describe('detecting drift', () => {
  it('catches a changed value', () => {
    const drifted = VENDORED.replace('oklch(73% 0.187 52)', 'oklch(73% 0.187 60)');
    const [found, ...rest] = findDrift(upstreamTokens(), vendoredTokens(drifted));

    expect(rest).toHaveLength(0);
    expect(found).toEqual({
      kind: 'drifted',
      token: 'color-accent',
      upstream: 'oklch(73% 0.187 52)',
      vendored: 'oklch(73% 0.187 60)',
    });
    expect(describeDrift(found)).toContain('--color-accent');
  });

  it('catches a token upstream added that the copy never picked up', () => {
    const drifted = VENDORED.replace(/\s*--color-navy:[^;]+;/, '');
    const found = findDrift(upstreamTokens(), vendoredTokens(drifted));

    expect(found).toEqual([
      { kind: 'missing', token: 'color-navy', upstream: 'oklch(45% 0.06 252)' },
    ]);
  });

  it('catches a changed font stack behind the self-hosted face prefix', () => {
    const drifted = VENDORED.replace("'Oswald', Impact", "'Oswald', Helvetica");
    const [found] = findDrift(upstreamTokens(), vendoredTokens(drifted));

    expect(found.kind).toBe('drifted');
    expect(found.token).toBe('font-display');
  });

  it('does not report a token this repo adds and DESIGN.md does not have', () => {
    const extended = VENDORED.replace('@theme {', '@theme {\n  --color-strip: oklch(50% 0 0);');

    expect(findDrift(upstreamTokens(), vendoredTokens(extended))).toEqual([]);
  });
});

describe('formatting that is not drift', () => {
  it('absorbs a trailing zero — DESIGN.md `0.20` is Prettier `0.2`', () => {
    expect(normalize('oklch(58% 0.20 28)')).toBe(normalize('oklch(58% 0.2 28)'));
  });

  it('absorbs column alignment, comma spacing, and a wrapped stack', () => {
    expect(normalize("'Nunito',-apple-system,system-ui,sans-serif")).toBe(
      normalize("'Nunito', -apple-system,\n    system-ui, sans-serif"),
    );
  });

  it('strips the next/font face prefix but nothing else', () => {
    expect(normalize("var(--font-body-face), 'Nunito', sans-serif")).toBe("'Nunito',sans-serif");
    expect(normalize('var(--color-fg)')).toBe('var(--color-fg)');
  });

  it('drops trailing comments', () => {
    expect(normalize('oklch(45% 0.06 252); /* #405C80 ground */'.replace(';', ''))).toBe(
      'oklch(45% 0.06 252)',
    );
  });
});

describe('parsing', () => {
  it('reads three declarations sharing one line', () => {
    const tokens = upstreamTokens();

    expect(tokens.get('success')).toBe('oklch(60% 0.13 150)');
    expect(tokens.get('warn')).toBe('oklch(78% 0.14 75)');
    expect(tokens.get('danger')).toBe('oklch(58% 0.2 28)');
  });

  it('namespaces colours and leaves fonts alone', () => {
    expect(vendoredName('accent')).toBe('color-accent');
    expect(vendoredName('font-display')).toBe('font-display');
  });

  it('throws rather than comparing zero tokens when a block shape changes', () => {
    // The one failure this check must not have: a silently empty block would
    // find no drift and report success.
    expect(() => extractBlock('/* no root block here */', /:root\s*\{/, 'test')).toThrow(
      /has its shape changed/,
    );
  });
});

describe('the real files', () => {
  it('agrees that the shipped copy matches upstream', () => {
    expect(findDrift(upstreamTokens(), vendoredTokens())).toEqual([]);
  });
});
