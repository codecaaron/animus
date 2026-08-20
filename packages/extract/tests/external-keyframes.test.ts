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
    // The teaching half: the message names the remedy, not just the failure.
    expect(result.diagnostics[0].message).toContain('definition entry');
    expect(result.diagnostics[0].message).toContain('named re-export');
    expect(result.diagnostics[0].message).toContain('export *');
    expect(JSON.parse(result.keyframesJson!).kitMotion).toBeDefined();
  });

  /**
   * `collectExternalPackageSources` registers TWO scan entries for a kit
   * declared at a subpath — the declared entry and a derived alias for the
   * package ROOT module, because collections routinely live only there
   * (pinned by `collect-external-packages.test.ts`, "a derived root alias
   * scans its root entry for keyframes too"). The failing entry is therefore
   * often the root barrel, which for a React kit necessarily re-exports
   * framework components. The message must describe that scan set: telling a
   * consumer whose definition entry is already framework-free that
   * collections "must be reachable from the package's definition entry" is
   * advice they have already followed, and it never silences the barrel.
   */
  it('the entry-failed message describes the whole scanned-entry set', () => {
    const result = mergeExternalKeyframes(
      () => {
        throw new Error("could not resolve '@ark-ui/react/field'");
      },
      null,
      ['/pkg/kit/src/index.ts'],
      '/root'
    );
    const [diagnostic] = result.diagnostics;
    expect(diagnostic.code).toBe(KEYFRAMES_EXTERNAL_ENTRY_FAILED);
    // Both scanned entries are named, so the reader can tell which one failed.
    expect(diagnostic.message).toContain('your system entry declares');
    expect(diagnostic.message).toContain('package root module');
    // And the false requirement is gone: a framework-free definition entry
    // does not exempt the root barrel from being scanned.
    expect(diagnostic.message).not.toContain(
      "must be reachable from the package's definition entry"
    );
  });

  /**
   * The scan result is animus's own wire: `scanKeyframesExports` is a NAPI
   * entry point and its JSON is serialized by the engine, never authored by a
   * package. A `catch { continue }` here dropped the entry's collections
   * silently — indistinguishable from "this package ships no keyframes", the
   * same success-looking default the ENTRY_FAILED diagnostic exists to avoid.
   * An entry that fails to EVALUATE still degrades to that diagnostic (the
   * external-package boundary); only unparseable engine output throws.
   */
  it('throws when the engine returns unparseable scan JSON', () => {
    expect(() =>
      mergeExternalKeyframes(
        () => 'not json',
        null,
        ['/pkg/kit/src/index.ts'],
        '/root'
      )
    ).toThrow(/keyframes/);
    expect(() =>
      mergeExternalKeyframes(
        () => 'not json',
        null,
        ['/pkg/kit/src/index.ts'],
        '/root'
      )
    ).toThrow(/SyntaxError/);
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
