import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { AssertionError } from '../src/assert-css';
import { parseJsonObject } from '../src/json';
import { installedHostVersion, writeLaneReceipt } from '../src/receipt';

const dirs: string[] = [];

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lane-receipt-'));
  dirs.push(dir);
  return dir;
}

/** A consumer config that selects no engine — the shape every lane ships. */
function cleanConfig(dir: string): string {
  const path = join(dir, 'vite.config.ts');
  writeFileSync(
    path,
    "import { animusExtract } from '@animus-ui/vite-plugin';\n" +
      "export default { plugins: [animusExtract({ system: './src/ds.ts' })] };\n"
  );
  return path;
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('writeLaneReceipt', () => {
  it('round-trips all eight fields through JSON.parse', () => {
    const dir = scratchDir();
    const path = join(dir, 'verify-assert-vite.json');

    const returned = writeLaneReceipt(path, {
      lane: 'verify:assert:vite',
      host: 'vite',
      hostVersion: '7.1.2',
      mode: 'production',
      packageForm: 'workspace',
      engineConfigPath: cleanConfig(dir),
    });

    // Decoded, not asserted: the round-trip claim is what `toEqual` below
    // proves, so the reader only needs the bytes to BE a JSON object — which
    // this package's own boundary parser establishes rather than assumes.
    const parsed = parseJsonObject(readFileSync(path, 'utf8'), 'lane receipt');
    expect(parsed).toEqual(returned);
    expect(parsed).toEqual({
      lane: 'verify:assert:vite',
      host: 'vite',
      hostVersion: '7.1.2',
      mode: 'production',
      engineLoaded: 'v2',
      engineDefault: 'v2',
      engineOverride: false,
      packageForm: 'workspace',
    });
  });

  it('creates missing parent directories and appends a trailing newline', () => {
    const dir = scratchDir();
    // Nested, not-yet-existing path proves mkdirSync recursive.
    const path = join(dir, 'nested', '.receipts', 'verify-assert-next.json');

    const returned = writeLaneReceipt(path, {
      lane: 'verify:assert:next',
      host: 'next',
      hostVersion: '15.5.0',
      mode: 'production',
      packageForm: 'packed',
      engineConfigPath: cleanConfig(dir),
    });

    const raw = readFileSync(path, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw)).toEqual(returned);
  });

  // The V12(a) ruling: the retirement guard and the engine constants are ONE
  // step. A lane cannot record `v2` without proving its own config selects no
  // engine, so each rejection below must also leave NO receipt behind.
  for (const [label, source] of [
    ['an explicit engine option', "animusExtract({ engine: 'v1' })"],
    ['a spaced engine option', 'animusExtract({ engine : "v2" })'],
    ['an ANIMUS_ENGINE reference', 'process.env.ANIMUS_ENGINE === "v1"'],
  ] as const) {
    it(`refuses to record engine identity when the config has ${label}`, () => {
      const dir = scratchDir();
      const configPath = join(dir, 'vite.config.ts');
      writeFileSync(configPath, `export default { probe: ${source} };\n`);
      const path = join(dir, '.receipts', 'verify-assert-vite.json');

      expect(() =>
        writeLaneReceipt(path, {
          lane: 'verify:assert:vite',
          host: 'vite',
          hostVersion: '7.1.2',
          mode: 'production',
          packageForm: 'workspace',
          engineConfigPath: configPath,
        })
      ).toThrow(AssertionError);
      expect(existsSync(path)).toBe(false);
    });
  }

  it('names the config in the failure, defaulting the label to its basename', () => {
    const dir = scratchDir();
    const configPath = join(dir, 'next.config.ts');
    writeFileSync(configPath, "withAnimus({ engine: 'v1' });\n");

    expect(() =>
      writeLaneReceipt(join(dir, 'receipt.json'), {
        lane: 'verify:assert:next',
        host: 'next',
        hostVersion: '15.5.0',
        mode: 'production',
        packageForm: 'workspace',
        engineConfigPath: configPath,
      })
    ).toThrow(/^next\.config\.ts must not reference ANIMUS_ENGINE/);

    expect(() =>
      writeLaneReceipt(join(dir, 'receipt.json'), {
        lane: 'verify:assert:next',
        host: 'next',
        hostVersion: '15.5.0',
        mode: 'production',
        packageForm: 'workspace',
        engineConfigPath: configPath,
        engineConfigLabel: 'packages/showcase/vite.config.ts',
      })
    ).toThrow(/^packages\/showcase\/vite\.config\.ts must not reference/);
  });
});

describe('installedHostVersion', () => {
  it('reads the version from the installed manifest, not a declared range', () => {
    const root = scratchDir();
    mkdirSync(join(root, 'node_modules', 'vinext'), { recursive: true });
    writeFileSync(
      join(root, 'node_modules', 'vinext', 'package.json'),
      JSON.stringify({ name: 'vinext', version: '1.0.0-beta.1' })
    );
    // The lane's own manifest ranges the host; the receipt must not read it.
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { vinext: '^1.0.0' } })
    );

    expect(installedHostVersion(root, 'vinext')).toBe('1.0.0-beta.1');
  });

  it('throws when the host is not installed', () => {
    expect(() => installedHostVersion(scratchDir(), 'vinext')).toThrow();
  });
});
