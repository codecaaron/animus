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

/**
 * Canonical replacement-epoch helper (openspec:
 * next-webpack-served-transform-coherence, design D5): ONE semantic epoch
 * definition shared by every integration —
 * `hashReplacementPlans(snapshotFilePlans(manifest))` over the sorted
 * canonical serialization with the domain prefix
 * `animus-replacement-plans-v1\0`.
 */

/** A complete `ManifestComponentDescriptor` at the engine's empty-universe
 *  values — `file` and `replacement` are the two fields the epoch derivation
 *  reads; the rest carry the engine's own empty values so a fake descriptor
 *  is a whole one (the schema in `manifest-schema.ts` is the authority). */
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
    // The epoch is the webpack persistent-cache witness for RESTORED
    // modules, and those modules import the session's served system-props
    // artifact — content the replacement plans alone cannot see. An offline
    // system-props change (e.g. a group-registry edit while the server is
    // down) must move the epoch even when every replacement is unchanged.
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
    // Same plans + same witness → same epoch (restart stability).
    expect(hashReplacementPlans(snapshot, 'module-source-a')).toBe(withA);
    // An empty witness is a witness, not absence.
    expect(hashReplacementPlans(snapshot, '')).not.toBe(bare);
  });

  it('pins the domain prefix and canonical serialization', () => {
    // Empty snapshot: canonical serialization is the bare domain prefix.
    expect(hashReplacementPlans(new Map())).toBe(contentHash(DOMAIN_PREFIX));

    // Non-empty: sorted (file, planJson) entries, each contributing
    // `file\0plan\0`, exactly as snapshotFilePlans produced each plan string.
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
    // Absent→present (the reverse direction) is a plan change too.
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

    // Two components 'x' + 'y' must not equal one component 'xy'.
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
