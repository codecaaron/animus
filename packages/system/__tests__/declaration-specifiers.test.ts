import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../../..');

test('emits a Node ESM-resolvable conditions re-export', () => {
  const outDir = mkdtempSync(resolve(tmpdir(), 'animus-system-dts-'));

  try {
    const result = spawnSync(
      resolve(ROOT, 'node_modules/.bin/tsc'),
      [
        '-p',
        'packages/system/tsconfig.build.json',
        '--outDir',
        outDir,
        '--declarationMap',
        'false',
      ],
      { cwd: ROOT, encoding: 'utf8' }
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);

    const declaration = readFileSync(resolve(outDir, 'index.d.ts'), 'utf8');
    expect(declaration).toContain("from './conditions.js';");
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
