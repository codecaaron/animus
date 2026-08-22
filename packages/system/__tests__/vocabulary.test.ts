import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSystem } from '../src';
import type { VocabularyRecord } from '../src';

const FRAMES_A = { '0%': { opacity: 0 }, '100%': { opacity: 1 } };
const FRAMES_B = { '0%': { opacity: 1 }, '100%': { opacity: 0 } };

function recordOf(sealed: {
  getVocabularyRecord?(): VocabularyRecord;
}): VocabularyRecord {
  const record = sealed.getVocabularyRecord?.();
  if (!record) {
    throw new Error('expected a sealed system to carry a vocabulary record');
  }
  return record;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('vocabulary registration — two-phase terminal (runtime)', () => {
  it('register between the terminals, then seal: the record carries the collection under its registered name, declaration-ordered, version-marked', () => {
    const bundle = createSystem().build();
    const first = bundle.createKeyframes({ pulse: FRAMES_A });
    const second = bundle.createKeyframes({ fade: FRAMES_B });

    const sealed = bundle
      .registerKeyframes({ first })
      .registerKeyframes({ second })
      .seal();

    const record = recordOf(sealed);
    expect(record.version).toBe(1);
    expect(record.keyframes.map((entry) => entry.name)).toEqual([
      'first',
      'second',
    ]);
    expect(record.keyframes[0]?.frames).toEqual(first.__frames);
    expect(record.collisions).toEqual([]);
  });

  it('the sealed record is frozen INCLUDING the frame payload, which is a registration-time copy — mutating the live collection afterwards changes nothing', () => {
    const bundle = createSystem().build();
    const motion = bundle.createKeyframes({ pulse: FRAMES_A });
    const sealed = bundle.registerKeyframes({ motion }).seal();

    const record = recordOf(sealed);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.keyframes)).toBe(true);
    expect(Object.isFrozen(record.keyframes[0])).toBe(true);
    const entry = record.keyframes[0]!;
    expect(entry.frames).not.toBe(motion.__frames);
    expect(Object.isFrozen(entry.frames)).toBe(true);
    expect(Object.isFrozen(entry.frames.pulse)).toBe(true);
    expect(Object.isFrozen(entry.frames.pulse?.frames)).toBe(true);

    (
      motion.__frames.pulse.frames as Record<string, Record<string, unknown>>
    )['0%'] = { opacity: 0.5 };
    // Literal expectation — the module const aliases the live collection.
    expect(entry.frames.pulse?.frames['0%']).toEqual({ opacity: 0 });
  });

  it('registration is linear: a superseded bundle rejects further registration and sealing loudly', () => {
    const bundle = createSystem().build();
    const motion = bundle.createKeyframes({ pulse: FRAMES_A });
    const next = bundle.registerKeyframes({ motion });

    expect(() =>
      (bundle as { registerKeyframes(map: object): unknown }).registerKeyframes(
        { motion }
      )
    ).toThrow(/superseded|linear/);
    expect(() => bundle.seal()).toThrow(/superseded|linear/);
    expect(recordOf(next.seal()).keyframes.map((e) => e.name)).toEqual([
      'motion',
    ]);
  });

  it('registration after seal throws naming the sealed state', () => {
    const bundle = createSystem().build();
    const motion = bundle.createKeyframes({ pulse: FRAMES_A });
    bundle.seal();

    expect(() =>
      (bundle as { registerKeyframes(map: object): unknown }).registerKeyframes(
        { motion }
      )
    ).toThrow(/sealed/);
  });

  it('a second seal() throws — one sealed instance per bundle', () => {
    const bundle = createSystem().build();
    bundle.seal();
    expect(() => bundle.seal()).toThrow(/sealed/);
  });

  it('a non-collection value is rejected at runtime naming the key', () => {
    const bundle = createSystem().build();
    expect(() =>
      (bundle as { registerKeyframes(map: object): unknown }).registerKeyframes(
        { bogus: { frames: {} } }
      )
    ).toThrow(/bogus/);
  });

  it('the sealed instance serializes from a snapshot the unsealed instance cannot reach: post-seal mutation of public registries affects nothing', () => {
    const bundle = createSystem()
      .addGroup('space', { m: { property: 'margin' } })
      .build();
    const sealed = bundle.seal();
    const before = sealed.toConfig().propConfig;

    (
      sealed as unknown as { propRegistry: Record<string, unknown> }
    ).propRegistry.injected = { property: 'color' };
    expect(sealed.toConfig().propConfig).toBe(before);
  });

  it('extending a sealed kit merges its vocabulary ahead of local registrations', () => {
    const kitBundle = createSystem().build();
    const kitMotion = kitBundle.createKeyframes({ pulse: FRAMES_A });
    const kit = kitBundle.registerKeyframes({ kitMotion }).seal();

    const consumerBundle = createSystem().extend(kit).build();
    const appMotion = consumerBundle.createKeyframes({ fade: FRAMES_B });
    const sealed = consumerBundle.registerKeyframes({ appMotion }).seal();

    expect(recordOf(sealed).keyframes.map((entry) => entry.name)).toEqual([
      'kitMotion',
      'appMotion',
    ]);
  });

  it('a local registration colliding with inherited vocabulary wins in place and records a collision witness', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const kitBundle = createSystem().build();
    const kitMotion = kitBundle.createKeyframes({ pulse: FRAMES_A });
    const kit = kitBundle.registerKeyframes({ motion: kitMotion }).seal();

    const consumerBundle = createSystem().extend(kit).build();
    const localMotion = consumerBundle.createKeyframes({ fade: FRAMES_B });
    const sealed = (
      consumerBundle as unknown as {
        registerKeyframes(map: object): { seal(): unknown };
      }
    )
      .registerKeyframes({ motion: localMotion })
      .seal() as Parameters<typeof recordOf>[0];

    const record = recordOf(sealed);
    expect(record.keyframes.map((entry) => entry.name)).toEqual(['motion']);
    expect(record.keyframes[0]?.frames).toEqual(localMotion.__frames);
    expect(record.collisions).toHaveLength(1);
    expect(record.collisions[0]).toMatchObject({
      code: 'animus.vocabulary.collision',
      name: 'motion',
    });
    expect(record.collisions[0]?.winner).not.toBe(record.collisions[0]?.loser);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('motion');
  });

  it('a collision winner takes its OWN declaration position — record order stays declaration order of the survivors', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const kitBundle = createSystem().build();
    const kit = kitBundle
      .registerKeyframes({
        a: kitBundle.createKeyframes({ pulse: FRAMES_A }),
        b: kitBundle.createKeyframes({ fade: FRAMES_B }),
      })
      .seal();

    const consumerBundle = createSystem().extend(kit).build();
    const c = consumerBundle.createKeyframes({
      spin: { '0%': { opacity: 0.25 } },
    });
    const bOverride = consumerBundle.createKeyframes({ blink: FRAMES_B });
    const sealed = (
      consumerBundle
        .registerKeyframes({ c }) as unknown as {
        registerKeyframes(map: object): {
          seal(): Parameters<typeof recordOf>[0];
        };
      }
    )
      .registerKeyframes({ b: bOverride })
      .seal();

    expect(recordOf(sealed).keyframes.map((entry) => entry.name)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('two extended kits colliding: the later extension wins and the collision is witnessed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const kitABundle = createSystem().build();
    const kitA = kitABundle
      .registerKeyframes({
        motion: kitABundle.createKeyframes({ pulse: FRAMES_A }),
      })
      .seal();
    const kitBBundle = createSystem().build();
    const bMotion = kitBBundle.createKeyframes({ fade: FRAMES_B });
    const kitB = kitBBundle.registerKeyframes({ motion: bMotion }).seal();

    const sealed = createSystem().extend(kitA).extend(kitB).build().seal();

    const record = recordOf(sealed);
    expect(record.keyframes.map((entry) => entry.name)).toEqual(['motion']);
    expect(record.keyframes[0]?.frames).toEqual(bMotion.__frames);
    expect(record.collisions).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('an empty vocabulary seals to an empty, version-marked record', () => {
    const sealed = createSystem().build().seal();
    const record = recordOf(sealed);
    expect(record.version).toBe(1);
    expect(record.keyframes).toEqual([]);
    expect(record.globalStyles).toEqual([]);
  });

  // SPEC(vocabulary-registration §"Extending an unsealed instance fails
  // loud"): the strict rejection is DEFERRED to the atomic migration
  // increment (design Ledger DEF-11) — verify:compile sweeps un-migrated
  // fixtures until then. `it.fails` pins the obligation: when the flip
  // lands, this test starts passing and MUST be inverted to a plain `it`.
  it.fails(
    'extending a built-but-unsealed system instance fails loud (flips at the migration increment — DEF-11)',
    () => {
      const kit = createSystem()
        .addGroup('kitSurface', { kitGlow: { property: 'boxShadow' } })
        .build().system;
      expect(() => createSystem().extend(kit)).toThrow(/seal/);
    }
  );
});
