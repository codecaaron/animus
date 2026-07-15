import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true }))
  );
});

describe('manifest capture preload', () => {
  test('does not replace Module._load when capture is disabled', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'animus-manifest-capture-disabled-'));
    temporaryDirectories.push(directory);
    const runnerPath = join(directory, 'runner.cjs');
    const hookPath = join(import.meta.dir, 'capture-manifests.cjs');
    await writeFile(
      runnerPath,
      `const Module = require('node:module');
const before = Module._load;
require(${JSON.stringify(hookPath)});
if (Module._load !== before) process.exit(2);
`
    );

    const env = { ...process.env };
    delete env.ANIMUS_RESIDUE_CAPTURE_DIR;
    delete env.ANIMUS_RESIDUE_CAPTURE_LABEL;
    delete env.ANIMUS_RESIDUE_CAPTURE_MODULE;
    const child = Bun.spawn([Bun.which('bun')!, runnerPath], {
      env,
      stderr: 'pipe',
    });
    expect(await child.exited).toBe(0);
  });

  test('captures ExtractEngine analyze output without changing its return value', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'animus-manifest-capture-'));
    temporaryDirectories.push(directory);
    const captureDirectory = join(directory, 'captures');
    const enginePath = join(directory, 'fake-engine.cjs');
    const runnerPath = join(directory, 'runner.cjs');
    await writeFile(
      enginePath,
      `class ExtractEngine {
  analyze() { return JSON.stringify({ usageResidue: [{ binding: 'Box' }] }); }
}
module.exports = { ExtractEngine };
`
    );
    await writeFile(
      runnerPath,
      `const { ExtractEngine } = require(${JSON.stringify(enginePath)});
const result = new ExtractEngine().analyze('[]');
if (JSON.parse(result).usageResidue.length !== 1) process.exit(2);
`
    );

    const hookPath = join(import.meta.dir, 'capture-manifests.cjs');
    const child = Bun.spawn([Bun.which('bun')!, `--require=${hookPath}`, runnerPath], {
      env: {
        ...process.env,
        ANIMUS_RESIDUE_CAPTURE_DIR: captureDirectory,
        ANIMUS_RESIDUE_CAPTURE_LABEL: 'unit test',
        ANIMUS_RESIDUE_CAPTURE_MODULE: enginePath,
      },
      stderr: 'pipe',
    });
    expect(await child.exited).toBe(0);

    const captures = await readdir(captureDirectory);
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatch(/^unit-test-\d+-1\.json$/);
    expect(
      JSON.parse(await readFile(join(captureDirectory, captures[0]), 'utf8'))
    ).toEqual({ usageResidue: [{ binding: 'Box' }] });
  });
});
