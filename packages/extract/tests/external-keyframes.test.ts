import { describe, expect, it } from 'vitest';

import {
  KEYFRAMES_EXPORT_COLLISION,
  KEYFRAMES_EXTERNAL_ENTRY_FAILED,
  mergeExternalKeyframes,
} from '../pipeline/external-keyframes';

const kitCollection = {
  kitMotion: {
    pulse: { name: 'animus-kf-kit', frames: { from: { opacity: 0.4 } } },
  },
};

describe('mergeExternalKeyframes', () => {
  it('merges external collections into consumer collections', () => {
    const consumer = JSON.stringify({
      animations: { spin: { name: 'animus-kf-consumer', frames: {} } },
    });
    const result = mergeExternalKeyframes(
      () => JSON.stringify(kitCollection),
      consumer,
      ['/pkg/kit/src/index.ts'],
      '/root'
    );
    expect(result.diagnostics).toEqual([]);
    const merged = JSON.parse(result.keyframesJson!);
    expect(Object.keys(merged).sort()).toEqual(['animations', 'kitMotion']);
  });

  it('consumer wins name collisions with a coded diagnostic', () => {
    const consumer = JSON.stringify({
      kitMotion: { pulse: { name: 'animus-kf-consumer', frames: {} } },
    });
    const result = mergeExternalKeyframes(
      () => JSON.stringify(kitCollection),
      consumer,
      ['/pkg/kit/src/index.ts'],
      '/root'
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe(KEYFRAMES_EXPORT_COLLISION);
    expect(result.diagnostics[0].severity).toBe('warn');
    const merged = JSON.parse(result.keyframesJson!);
    expect(merged.kitMotion.pulse.name).toBe('animus-kf-consumer');
  });

  it('identical re-exports collide silently (no diagnostic)', () => {
    const consumer = JSON.stringify(kitCollection);
    const result = mergeExternalKeyframes(
      () => JSON.stringify(kitCollection),
      consumer,
      ['/pkg/kit/src/index.ts'],
      '/root'
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('a throwing entry degrades to a coded diagnostic and other entries proceed', () => {
    const result = mergeExternalKeyframes(
      (entry) => {
        if (entry.includes('broken')) throw new Error('QuickJS eval failed');
        return JSON.stringify(kitCollection);
      },
      null,
      ['/pkg/broken/src/index.ts', '/pkg/kit/src/index.ts'],
      '/root'
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].code).toBe(KEYFRAMES_EXTERNAL_ENTRY_FAILED);
    expect(result.diagnostics[0].file).toBe('/pkg/broken/src/index.ts');
    expect(JSON.parse(result.keyframesJson!).kitMotion).toBeDefined();
  });

  it('returns null when nothing exists and dedupes repeated entries', () => {
    let scans = 0;
    const empty = mergeExternalKeyframes(
      () => {
        scans++;
        return null;
      },
      null,
      ['/pkg/kit/src/index.ts', '/pkg/kit/src/index.ts'],
      '/root'
    );
    expect(empty.keyframesJson).toBeNull();
    expect(scans).toBe(1);
  });
});
