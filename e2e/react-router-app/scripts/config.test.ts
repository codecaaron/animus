import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');

function source(path: string): string {
  const absolute = resolve(ROOT, path);
  expect(existsSync(absolute), `${path} must exist`).toBe(true);
  return readFileSync(absolute, 'utf8');
}

function jsonc(path: string): unknown {
  return JSON.parse(source(path).replace(/,\s*([}\]])/g, '$1'));
}

describe('React Router Worker canary structure', () => {
  it.each([
    'app/root.tsx',
    'app/routes.ts',
    'app/routes/home.tsx',
    'app/routes/client.tsx',
    'app/entry.server.tsx',
    'src/ds.ts',
    'src/components.tsx',
    'workers/app.ts',
    'vite.config.ts',
    'react-router.config.ts',
    'wrangler.jsonc',
    'scripts/worker.test.ts',
    'scripts/hydration.test.tsx',
    'vitest.config.ts',
  ])('owns %s', (path) => source(path));

  it('composes Cloudflare SSR, one Animus plugin, and React Router', () => {
    const config = source('vite.config.ts');
    expect(config.match(/cloudflare\(/g)).toHaveLength(1);
    expect(config.match(/animusExtract\(/g)).toHaveLength(1);
    expect(config.match(/reactRouter\(/g)).toHaveLength(1);
    expect(config).toContain("name: 'ssr'");
  });

  it('owns the exact Worker identity and full-stack output', () => {
    expect(jsonc('wrangler.jsonc')).toMatchObject({
      name: 'animus-react-router-canary',
      main: './workers/app.ts',
      compatibility_flags: ['nodejs_compat'],
      assets: { directory: './build/client' },
    });
    expect(source('react-router.config.ts')).toMatch(/ssr:\s*true/);
  });

  it('delegates the Worker to the generated server build', () => {
    const worker = source('workers/app.ts');
    expect(worker).toContain('createRequestHandler');
    expect(worker).toContain('virtual:react-router/server-build');
    expect(worker).toContain("'/api/health'");
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
