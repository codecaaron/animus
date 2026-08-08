import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

import { runBuildStart } from '../src/build-start';
import { PluginContext } from '../src/context';

/**
 * External-keyframes state across REPEATED buildStarts on one PluginContext
 * (--watch rebuilds, multi-environment builds): each run's merged
 * `keyframesJson` must reflect ONLY the includes the current system file
 * declares. `loadSystem()` re-applies the carve-out from whatever external
 * entries exist (for geological resets), so a rebuild after an include was
 * removed must not resurrect the removed package's keyframes — the merge
 * starts from the consumer-only baseline, never from compounded state.
 */

const scratch = mkdtempSync(join(tmpdir(), 'animus-external-kf-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const KIT_A_KF = '{"kitAKeyframes":{"spinA":{"to":{"opacity":1}}}}';
const KIT_B_KF = '{"kitBKeyframes":{"spinB":{"to":{"opacity":0}}}}';
const KIT_C_KF = '{"kitCKeyframes":{"spinC":{"to":{"opacity":1}}}}';

function writeKit(name: string): void {
  const src = join(scratch, name, 'src');
  mkdirSync(src, { recursive: true });
  writeFileSync(join(scratch, name, 'package.json'), `{"name":"${name}"}\n`);
  writeFileSync(join(src, 'index.ts'), `export default {};\n`);
}

/** A published-shape kit: dist entry only, no src/ tree. */
function writeDistKit(name: string): void {
  const dist = join(scratch, name, 'dist');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(scratch, name, 'package.json'), `{"name":"${name}"}\n`);
  writeFileSync(join(dist, 'index.mjs'), `export default {};\n`);
}

/** `importPath` is relative to src/ds.ts (e.g. '../kit-a/src'). */
function writeSystemFile(importPath: string | null): void {
  const importLine = importPath ? `import kit from '${importPath}';\n` : '';
  const chain = importPath ? '.extend(kit)' : '';
  writeFileSync(
    join(scratch, 'src', 'ds.ts'),
    `${importLine}export const ds = createSystem({})${chain};\n`
  );
}

function makeContext(): PluginContext {
  mkdirSync(join(scratch, 'src'), { recursive: true });
  writeKit('kit-a');
  writeKit('kit-b');
  writeDistKit('kit-c');

  const engine = {
    loadSystemModule: () => ({
      propConfig: '{}',
      groupRegistry: '{}',
      scalesJson: '{}',
      variableMapJson: '{}',
      variableCss: '',
      dependencies: [],
    }),
    analyzeProject: () => JSON.stringify({ components: {}, css: '' }),
    scanKeyframesExports: (entry: string) => {
      if (entry.includes('kit-a')) return KIT_A_KF;
      if (entry.includes('kit-b')) return KIT_B_KF;
      if (entry.includes('kit-c')) return KIT_C_KF;
      return null;
    },
  };

  const ctx = new PluginContext({ system: 'src/ds.ts' }, () => engine);
  ctx.rootDir = scratch;
  ctx.isProd = true;
  return ctx;
}

// src-shipping includes probe the fs from their absolute specifier; the
// dist-only kit resolves like a bundler would (package entry → dist file).
const resolveSpecifier = async (specifier: string) =>
  specifier.endsWith('kit-c')
    ? join(scratch, 'kit-c', 'dist', 'index.mjs')
    : null;

describe('external keyframes across repeated buildStarts', () => {
  test('a removed include leaves no keyframes behind on the next run', async () => {
    const ctx = makeContext();

    writeSystemFile('../kit-a/src');
    await runBuildStart(ctx, resolveSpecifier);
    expect(ctx.system.keyframesJson).toContain('kitAKeyframes');

    // The include moves from kit-a to kit-b between runs (--watch rebuild).
    writeSystemFile('../kit-b/src');
    await runBuildStart(ctx, resolveSpecifier);
    expect(ctx.system.keyframesJson).toContain('kitBKeyframes');
    expect(ctx.system.keyframesJson).not.toContain('kitAKeyframes');

    // All includes removed: back to the consumer-only baseline, with no
    // stale external diagnostics riding the next analysis.
    writeSystemFile(null);
    await runBuildStart(ctx, resolveSpecifier);
    expect(ctx.system.keyframesJson).toBeNull();
    expect(ctx.externalKeyframesDiagnostics).toEqual([]);
  });

  test('a dist-only include contributes its keyframes collections', async () => {
    // Published packages routinely ship dist without src/ — their imported
    // `Keyframes` collections must reach the merged system exactly like a
    // src-shipping package's.
    const ctx = makeContext();

    writeSystemFile('../kit-c');
    await runBuildStart(ctx, resolveSpecifier);
    expect(ctx.system.keyframesJson).toContain('kitCKeyframes');
  });
});
