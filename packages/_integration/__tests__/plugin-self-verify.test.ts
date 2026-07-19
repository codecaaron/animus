import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';

import { animusExtract } from '../../vite-plugin/src';

const repoRoot = join(import.meta.dirname, '../../..');
const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    fixtureRoots.splice(0).map((root) => rm(root, { recursive: true }))
  );
});

describe('plugin self-verification', () => {
  it('fails a strict build when extraction produces no component CSS', async () => {
    const root = await mkdtemp(join(repoRoot, '.animus-self-verify-'));
    fixtureRoots.push(root);
    await writeFile(join(root, 'index.html'), '<main>empty fixture</main>');

    const result = build({
      root,
      configFile: false,
      logLevel: 'silent',
      build: { write: false },
      plugins: [
        animusExtract({
          system: join(repoRoot, 'packages/extract/tests/test-system.ts'),
          strict: true,
          verify: true,
        }),
      ],
    });

    await expect(result).rejects.toThrow(
      '[animus:verify] No component CSS produced'
    );
  });
});
