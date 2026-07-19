import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

function source(path: string): string {
  const absolute = resolve(ROOT, path);
  expect(existsSync(absolute), `${path} must exist`).toBe(true);
  return readFileSync(absolute, 'utf8');
}

describe('Vinext canary structure', () => {
  it('contains no cross-fixture imports', () => {
    for (const path of [
      'app/layout.tsx',
      'app/page.tsx',
      'app/client/page.tsx',
      'pages/_app.tsx',
      'pages/legacy.tsx',
      'src/ds.ts',
      'src/components.tsx',
    ]) {
      expect(source(path)).not.toMatch(/e2e\/(next|vite|react-router)-app/);
    }
  });
});
