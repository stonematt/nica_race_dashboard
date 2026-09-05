/**
 * The CI workflow, asserted for the things that are decisions rather than
 * plumbing.
 *
 * A workflow file is the one piece of this repo that nothing else exercises —
 * it runs on GitHub or it runs nowhere, and by the time it is wrong the pull
 * request it should have checked has already merged. So the standing decisions
 * inside it get held here: one Node line and not a matrix (#28), no scheduled
 * ingest while the repo is public (#6, #29), and the local-only test lane never
 * running where minors' data would have to be fetched to run it (#29, #30).
 *
 * Asserted against the file's text rather than a parsed tree: adding a YAML
 * parser to test four decisions is a worse trade than a handful of string
 * checks over a file this small. What is checked is deliberately narrow —
 * whether the workflow actually passes is GitHub's answer to give, not this
 * suite's.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { repoRoot } from '../src/lib/fixtures.ts';

const PATH = join(repoRoot(), '.github', 'workflows', 'ci.yml');
const workflow = readFileSync(PATH, 'utf8');

/**
 * The workflow with comment lines dropped. The comments name the things CI must
 * not do, so a naive search for "test:local" finds the warning against it and
 * calls that a violation.
 */
const executed = workflow.replace(/^\s*#.*$/gm, '');

describe('when CI runs', () => {
  it('runs on pull requests into dev and main', () => {
    expect(workflow).toMatch(/on:\s*\n\s*pull_request:\s*\n\s*branches: \[dev, main\]/);
  });

  it('has no schedule trigger', () => {
    // bin/fetch.ts pulls minors' names from a live API. A scheduled workflow is
    // how that ends up on a runner and in a public log.
    expect(workflow).not.toMatch(/^\s*schedule:/m);
  });

  it('asks for nothing but read access', () => {
    expect(workflow).toMatch(/permissions:\s*\n\s*contents: read/);
  });
});

describe('the runtime', () => {
  it('comes from .nvmrc', () => {
    expect(workflow).toContain('node-version-file: .nvmrc');
  });

  it('is one line, not a matrix', () => {
    // "This app runs on one runtime" — #28. A matrix here would be testing a
    // compatibility claim nobody makes.
    expect(workflow).not.toMatch(/matrix:/);
    expect(workflow).not.toMatch(/node-version:\s*\[/);
  });

  it('agrees with .nvmrc and package.json engines', () => {
    const nvmrc = readFileSync(join(repoRoot(), '.nvmrc'), 'utf8').trim();
    const pkg = JSON.parse(readFileSync(join(repoRoot(), 'package.json'), 'utf8'));
    expect(pkg.engines.node).toBe(`>=${nvmrc}`);
  });

  it('caches the pnpm store between runs', () => {
    expect(workflow).toContain('cache: pnpm');
  });

  it('installs from the committed lockfile', () => {
    expect(workflow).toContain('pnpm install --frozen-lockfile');
  });
});

describe('what CI checks', () => {
  it('runs all four gates', () => {
    for (const gate of ['pnpm typecheck', 'pnpm lint', 'pnpm format:check', 'pnpm test']) {
      expect(workflow).toContain(gate);
    }
  });

  it('runs the privacy guard', () => {
    expect(workflow).toContain('node scripts/privacy-guard.ts');
  });

  it('checks for migration drift', () => {
    expect(workflow).toContain('pnpm db:generate');
    expect(workflow).toContain('git status --porcelain -- src/lib/db/migrations');
  });

  it('applies migrations to a fresh PGlite database', () => {
    expect(workflow).toContain('node bin/migrate.ts');
    expect(workflow).toMatch(/DATABASE_URL: \$\{\{ runner\.temp \}\}/);
  });
});

describe('what CI must never do', () => {
  it('never runs the local-only test lane', () => {
    // It reads the real corpus. Running it here would mean putting minors'
    // names where CI can reach them — the thing #29 decided against.
    expect(executed).not.toContain('test:local');
    expect(executed).not.toContain('vitest.local.config.ts');
  });

  it('never runs fetch, normalize or seed', () => {
    for (const script of ['pnpm fetch', 'bin/fetch.ts', 'pnpm normalize', 'pnpm seed']) {
      expect(executed).not.toContain(script);
    }
  });

  it('says out loud that scheduled ingest must never be added', () => {
    expect(workflow).toMatch(/NEVER ADD A SCHEDULED INGEST/);
    expect(workflow).toMatch(/while it is public/i);
  });
});
