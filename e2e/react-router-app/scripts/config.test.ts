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
    const worker = source('workers/app.ts');
    expect(worker).toContain('createRequestHandler');
    expect(worker).toContain('virtual:react-router/server-build');
    expect(worker).not.toContain('/api/health');
    expect(worker).not.toContain('new URL');
    expect(worker).toMatch(
      /async fetch\(request: Request\): Promise<Response> \{\s*return requestHandler\(request\);\s*\}/
    );
  });

  it('contains no cross-fixture imports', () => {
    for (const path of [
      'app/root.tsx',
      'app/routes.ts',
      'app/routes/home.tsx',
      'app/routes/client.tsx',
      'src/ds.ts',
      'src/components.tsx',
      'workers/app.ts',
    ]) {
      expect(source(path)).not.toMatch(/e2e\/(next|vite|vinext)-app/);
    }
  });
});
