// @vitest-environment node
/**
 * `backdateTree` walks fixture trees that contain symlinks into the REAL
 * repo (real-engine.test.ts links packages/system + packages/properties
 * into the fixture's node_modules). The backdate must stamp the links
 * themselves, never their targets — `utimesSync` follows symlinks, and a
 * followed stamp rewrites real source mtimes, firing phantom rebuilds in
 * every mtime-keyed consumer outside the fixture (turbo caches, dev-lane
 * watchers, a running `next dev`).
 */
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, test } from 'vitest';

import { backdateTree } from './harness';

const disposers: Array<() => void> = [];

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

describe('backdateTree', () => {
  test('stamps a symlinked directory entry without touching its target', () => {
    // Stand-in for a real workspace package living OUTSIDE the fixture.
    const target = mkdtempSync(join(tmpdir(), 'animus-backdate-target-'));
    disposers.push(() => rmSync(target, { recursive: true, force: true }));
    writeFileSync(join(target, 'index.mjs'), 'export {};\n');
    // Pin target mtimes an hour back so a followed stamp (≈ now - 10s)
    // would be unmistakable.
    const pinned = new Date(Date.now() - 3_600_000);
    utimesSync(join(target, 'index.mjs'), pinned, pinned);
    utimesSync(target, pinned, pinned);
    const targetDirBefore = statSync(target).mtimeMs;
    const targetFileBefore = statSync(join(target, 'index.mjs')).mtimeMs;

    const fixture = mkdtempSync(join(tmpdir(), 'animus-backdate-fixture-'));
    disposers.push(() => rmSync(fixture, { recursive: true, force: true }));
    const linkParent = join(fixture, 'node_modules/@animus-ui');
    mkdirSync(linkParent, { recursive: true });
    const link = join(linkParent, 'system');
    symlinkSync(target, link);
    writeFileSync(join(fixture, 'entry.js'), '');

    backdateTree(fixture);

    // The link target is outside the fixture: untouched.
    expect(statSync(target).mtimeMs).toBe(targetDirBefore);
    expect(statSync(join(target, 'index.mjs')).mtimeMs).toBe(targetFileBefore);

    // The fixture itself is fully backdated — including the link entry
    // (via lutimes) and the node_modules dirs webpack existence-probes.
    const backdatedCeiling = Date.now() - 9_000;
    expect(lstatSync(link).mtimeMs).toBeLessThan(backdatedCeiling);
    expect(statSync(join(fixture, 'entry.js')).mtimeMs).toBeLessThan(
      backdatedCeiling
    );
    expect(statSync(linkParent).mtimeMs).toBeLessThan(backdatedCeiling);
    expect(statSync(join(fixture, 'node_modules')).mtimeMs).toBeLessThan(
      backdatedCeiling
    );
    expect(statSync(fixture).mtimeMs).toBeLessThan(backdatedCeiling);
  });
});
