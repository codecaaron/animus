import { describe, expect, it } from 'vitest';

import { contentHash } from '../pipeline/content-hash';
import {
  diffFilePlans,
  hashReplacementPlans,
  snapshotFilePlans,
} from '../pipeline/replacement-plans';

import type {
  ManifestComponentDescriptor,
  ProjectManifest,
} from '../pipeline/manifest-schema';

function descriptor(
  file: string,
  replacement: string
): ManifestComponentDescriptor {
  return {
    file,
    binding: '',
    class_name: '',
    extends_from: null,
    terminal: 'asElement',
    tag: 'div',
    replacement,
    system_prop_names: [],
  };
}

function manifestWith(
  components: Record<string, ManifestComponentDescriptor>
): Pick<ProjectManifest, 'components'> {
  return { components };
}

const DOMAIN_PREFIX = 'animus-replacement-plans-v1\0';

describe('hashReplacementPlans', () => {
  it('is stable: identical plans hash identically regardless of insertion order', () => {
    const forward = snapshotFilePlans(
      manifestWith({
        'src/A.tsx::A': descriptor('src/A.tsx', 'ra'),
        'src/B.tsx::B': descriptor('src/B.tsx', 'rb'),
      })
    );
    const reversed = snapshotFilePlans(
      manifestWith({
        'src/B.tsx::B': descriptor('src/B.tsx', 'rb'),
        'src/A.tsx::A': descriptor('src/A.tsx', 'ra'),
      })
    );
    expect(hashReplacementPlans(forward)).toBe(hashReplacementPlans(reversed));
  });

  it('moves when any replacement content changes', () => {
    const before = snapshotFilePlans(
      manifestWith({
        'src/A.tsx::A': descriptor('src/A.tsx', 'ra'),
      })
    );
    const after = snapshotFilePlans(
      manifestWith({
        'src/A.tsx::A': descriptor('src/A.tsx', 'ra2'),
      })
    );
    expect(hashReplacementPlans(after)).not.toBe(hashReplacementPlans(before));
  });

  it('moves on membership changes within a file', () => {
    const one = snapshotFilePlans(
      manifestWith({
        'src/Kit.tsx::A': descriptor('src/Kit.tsx', 'x'),
      })
    );
    const two = snapshotFilePlans(
      manifestWith({
        'src/Kit.tsx::A': descriptor('src/Kit.tsx', 'x'),
        'src/Kit.tsx::B': descriptor('src/Kit.tsx', 'y'),
      })
    );
    expect(hashReplacementPlans(two)).not.toBe(hashReplacementPlans(one));
  });

  it('distinguishes absent from present-with-empty-replacement', () => {
    const absent = snapshotFilePlans(manifestWith({}));
    const emptyReplacement = snapshotFilePlans(
      manifestWith({
        'src/A.tsx::A': descriptor('src/A.tsx', ''),
      })
    );
    expect(hashReplacementPlans(emptyReplacement)).not.toBe(
      hashReplacementPlans(absent)
    );
  });

  it('moves with the served-dependency witness independently of plans', () => {
    const snapshot = snapshotFilePlans(
      manifestWith({
        'src/A.tsx::A': descriptor('src/A.tsx', 'ra'),
      })
    );
    const bare = hashReplacementPlans(snapshot);
    const withA = hashReplacementPlans(snapshot, 'module-source-a');
    const withB = hashReplacementPlans(snapshot, 'module-source-b');
    expect(withA).not.toBe(bare);
    expect(withA).not.toBe(withB);
    expect(hashReplacementPlans(snapshot, 'module-source-a')).toBe(withA);
    expect(hashReplacementPlans(snapshot, '')).not.toBe(bare);
  });

  it('pins the domain prefix and canonical serialization', () => {
    expect(hashReplacementPlans(new Map())).toBe(contentHash(DOMAIN_PREFIX));

    const snapshot = snapshotFilePlans(
      manifestWith({
        'src/B.tsx::B': descriptor('src/B.tsx', 'rb'),
        'src/A.tsx::A': descriptor('src/A.tsx', 'ra'),
      })
    );
    const sortedEntries = [...snapshot.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0
    );
    const serialized = sortedEntries
      .map(([file, plan]) => `${file}\0${plan}\0`)
      .join('');
    expect(hashReplacementPlans(snapshot)).toBe(
      contentHash(DOMAIN_PREFIX + serialized)
    );
  });
});

describe('snapshotFilePlans / diffFilePlans (moved from vite-plugin)', () => {
  it('diffs replacement changes, membership, and absent↔present transitions', () => {
    const prev = snapshotFilePlans(
      manifestWith({
        'src/A.tsx::A': descriptor('src/A.tsx', 'ra'),
        'src/B.tsx::B': descriptor('src/B.tsx', 'rb'),
      })
    );
    const next = snapshotFilePlans(
      manifestWith({
        'src/A.tsx::A': descriptor('src/A.tsx', 'ra2'),
      })
    );
    expect(diffFilePlans(prev, next)).toEqual(['src/A.tsx', 'src/B.tsx']);
    expect(diffFilePlans(next, prev)).toEqual(['src/A.tsx', 'src/B.tsx']);
    expect(diffFilePlans(prev, prev)).toEqual([]);
    expect(diffFilePlans(prev, next, { exclude: 'src/A.tsx' })).toEqual([
      'src/B.tsx',
    ]);
  });

  it('treats an empty replacement as present and never collapses membership concatenations', () => {
    const emptyReplacement = snapshotFilePlans(
      manifestWith({
        'src/Card.tsx::Card': descriptor('src/Card.tsx', ''),
      })
    );
    const absent = snapshotFilePlans(manifestWith({}));
    expect(diffFilePlans(emptyReplacement, absent)).toEqual(['src/Card.tsx']);
    expect(diffFilePlans(absent, emptyReplacement)).toEqual(['src/Card.tsx']);

    const two = snapshotFilePlans(
      manifestWith({
        'src/Kit.tsx::A': descriptor('src/Kit.tsx', 'x'),
        'src/Kit.tsx::B': descriptor('src/Kit.tsx', 'y'),
      })
    );
    const one = snapshotFilePlans(
      manifestWith({
        'src/Kit.tsx::A': descriptor('src/Kit.tsx', 'xy'),
      })
    );
    expect(diffFilePlans(two, one)).toEqual(['src/Kit.tsx']);
  });
});
