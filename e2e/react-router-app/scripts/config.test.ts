import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

function source(path: string): string {
  const absolute = resolve(ROOT, path);
  expect(existsSync(absolute), `${path} must exist`).toBe(true);
  return readFileSync(absolute, 'utf8');
}

describe('React Router Worker canary structure', () => {
  it('delegates the Worker to the generated server build', () => {
    // Without these anchors a stub Worker would still build and dry-run green.
    const worker = source('workers/app.ts');
    expect(worker).toContain('createRequestHandler');
    expect(worker).toContain('virtual:react-router/server-build');
  });
});
