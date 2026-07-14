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
  it.each([
    'app/layout.tsx',
    'app/page.tsx',
    'app/client/page.tsx',
    'pages/_app.tsx',
    'pages/legacy.tsx',
    'src/ds.ts',
    'src/components.tsx',
    'scripts/hydration.test.tsx',
    'vite.config.ts',
    'vitest.config.ts',
    'wrangler.jsonc',
  ])('owns %s', (path) => {
    source(path);
  });

  it('composes Vinext, one Animus plugin, and Cloudflare RSC workerd', () => {
    const config = source('vite.config.ts');
    expect(config.match(/vinext\(/g)).toHaveLength(1);
    expect(config.match(/animusExtract\(/g)).toHaveLength(1);
    expect(config.match(/cloudflare\(/g)).toHaveLength(1);
    expect(config).toContain("name: 'rsc'");
    expect(config).toContain("childEnvironments: ['ssr']");
    expect(config).not.toMatch(/\brsc\s*\(/);
  });

  it('owns the exact Worker identity and Vinext entry', () => {
    const config = JSON.parse(
      source('wrangler.jsonc').replace(/,\s*([}\]])/g, '$1')
    ) as {
      name?: string;
      main?: string;
      compatibility_flags?: string[];
      assets?: Record<string, unknown>;
    };
    expect(config).toMatchObject({
      name: 'animus-vinext-canary',
      main: 'vinext/server/fetch-handler',
      compatibility_flags: ['nodejs_compat'],
      assets: {
        directory: 'dist/client',
        not_found_handling: 'none',
        binding: 'ASSETS',
      },
    });
  });

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
