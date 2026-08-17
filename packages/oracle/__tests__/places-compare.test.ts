import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MANIFEST_FILE } from '../src/host/animus/loader';
import { asManifest } from '../src/host/animus/manifest-types';
import { compareSnapshots, loadSnapshot } from '../src/places';

/**
 * PLACES.md §6 — cross-build identity at MVP depth. Two snapshots relate by
 * program hash, component id, and place occurrence; refused files produce no
 * place claims at all.
 */

const FIXTURE = join(__dirname, 'fixtures/rollup-app');
const SOURCE_ROOT = join(__dirname, '../../../e2e/rollup-app');
const GROUP_FILE = 'src/Group.tsx';
const GROUP_ITEM_ID =
  '../../packages/test-ds/src/components/GroupItem.tsx::GroupItem';

describe('compareSnapshots', () => {
  it('reports one generation as identical, every place persisted', () => {
    const before = loadSnapshot(FIXTURE, { sourceRoot: SOURCE_ROOT });
    const after = loadSnapshot(FIXTURE, { sourceRoot: SOURCE_ROOT });
    const comparison = compareSnapshots(before, after);

    expect(comparison.identical).toBe(true);
    expect(comparison.components.added).toEqual([]);
    expect(comparison.components.removed).toEqual([]);
    expect(comparison.refusals).toEqual([]);
    expect(comparison.places.length).toBeGreaterThan(0);
    expect(
      comparison.places.every((place) => place.status === 'persisted')
    ).toBe(true);
    expect(
      comparison.places.every((place) => place.bindingChanges === undefined)
    ).toBe(true);

    const groupPlaces = comparison.places.filter(
      (place) => place.component === GROUP_ITEM_ID
    );
    expect(groupPlaces).toHaveLength(4);
    expect(new Set(groupPlaces.map((place) => place.file))).toEqual(
      new Set([GROUP_FILE])
    );
  });

  it('classifies places of a dropped file as removed, not silently gone', () => {
    const dir = mkdtempSync(join(tmpdir(), 'places-compare-'));
    cpSync(FIXTURE, dir, { recursive: true });
    const manifestPath = join(dir, MANIFEST_FILE);
    const manifest = asManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
    const facts = manifest.fileFacts;
    if (facts === undefined) {
      throw new Error('fixture: the manifest must carry fileFacts');
    }
    const { [GROUP_FILE]: dropped, ...keptFacts } = facts;
    // Vacuity guard: the file whose places must vanish was really in there.
    expect(dropped).toBeDefined();
    writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, fileFacts: keptFacts })
    );

    const before = loadSnapshot(FIXTURE, { sourceRoot: SOURCE_ROOT });
    const after = loadSnapshot(dir, { sourceRoot: SOURCE_ROOT });
    const comparison = compareSnapshots(before, after);

    expect(comparison.identical).toBe(false);
    // The component definition survives — only its invocation places went.
    expect(comparison.components.removed).toEqual([]);
    const groupPlaces = comparison.places.filter(
      (place) => place.component === GROUP_ITEM_ID
    );
    expect(groupPlaces).toHaveLength(4);
    expect(groupPlaces.every((place) => place.status === 'removed')).toBe(true);
  });

  it('makes no place claims about a file refused on either side', () => {
    const root = mkdtempSync(join(tmpdir(), 'places-compare-drift-'));
    mkdirSync(join(root, 'src'), { recursive: true });
    const source = readFileSync(join(SOURCE_ROOT, GROUP_FILE), 'utf8');
    writeFileSync(
      join(root, GROUP_FILE),
      source.replace(
        '<div className="group" data-active="true">',
        '<div className="group" data-active="maybe">'
      )
    );

    const before = loadSnapshot(FIXTURE, { sourceRoot: SOURCE_ROOT });
    const after = loadSnapshot(FIXTURE, { sourceRoot: root });
    const comparison = compareSnapshots(before, after);

    expect(comparison.refusals).toContainEqual(
      expect.objectContaining({
        side: 'after',
        file: GROUP_FILE,
        reason: 'diverged',
      })
    );
    // Neither removed nor added nor persisted — the refusal IS the answer.
    expect(
      comparison.places.filter((place) => place.file === GROUP_FILE)
    ).toEqual([]);
  });
});
