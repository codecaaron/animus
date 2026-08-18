import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

function source(path: string): string {
  const absolute = resolve(ROOT, path);
  expect(existsSync(absolute), `${path} must exist`).toBe(true);
  return readFileSync(absolute, 'utf8');
}

// Fixture self-containment (no cross-fixture imports) is enforced for all
// e2e/* members by the fixture-sibling vector in scripts/verify/topology.ts
// (runs in verify:lint).
describe('React Router Worker canary structure', () => {
  it('delegates the Worker to the generated server build', () => {
    // The two anchors carry the invariant: the Worker still exercises React
    // Router SSR rather than degenerating into a stub that would build and
    // dry-run green.
    const worker = source('workers/app.ts');
    expect(worker).toContain('createRequestHandler');
    expect(worker).toContain('virtual:react-router/server-build');
  });
});
