import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSystem } from '../src';

import type {
  KeyframesFrameData,
  RegisterableGlobalStyles,
  RegisterableKeyframes,
  VocabularyRecord,
} from '../src';

const FRAMES_A = { '0%': { opacity: 0 }, '100%': { opacity: 1 } };
const FRAMES_B = { '0%': { opacity: 1 }, '100%': { opacity: 0 } };

/** A value the untyped path may hand to registration: a real collection,
 *  or a malformed shape the runtime rejection is under test for. */
type ErasedRegistrable = RegisterableKeyframes | { frames: object };

/** The deliberately type-erased bundle view the untyped-path tests drive:
 *  the runtime linearity/collision witnesses — not the compiler — are under
 *  test here. Real bundles are structurally assignable (method params check
 *  bivariantly), so the erasure is a plain parameter widening — no
 *  assertion anywhere. */
interface ErasedBundle {
  registerKeyframes(map: Record<string, ErasedRegistrable>): ErasedBundle;
  registerGlobalStyles(
    map: Record<string, RegisterableGlobalStyles>
  ): ErasedBundle;
  seal(): { getVocabularyRecord?(): VocabularyRecord };
}

const erased = (bundle: ErasedBundle): ErasedBundle => bundle;

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

    // SAFETY: the readonly typing is compile-time only — mutating through
    // the owner frame-map type is exactly the hazard under test.
    (motion.__frames.pulse.frames as KeyframesFrameData[string]['frames'])[
      '0%'
    ] = { opacity: 0.5 };
    // Literal expectation — the module const aliases the live collection.
    expect(entry.frames.pulse?.frames['0%']).toEqual({ opacity: 0 });
  });

  it('registration is linear: a superseded bundle rejects further registration and sealing loudly', () => {
    const bundle = createSystem().build();
    const motion = bundle.createKeyframes({ pulse: FRAMES_A });
    const next = bundle.registerKeyframes({ motion });

    expect(() => erased(bundle).registerKeyframes({ motion })).toThrow(
      /superseded|linear/
    );
    expect(() => bundle.seal()).toThrow(/superseded|linear/);
    expect(recordOf(next.seal()).keyframes.map((e) => e.name)).toEqual([
      'motion',
    ]);
  });

  it('registration after seal throws naming the sealed state', () => {
    const bundle = createSystem().build();
    const motion = bundle.createKeyframes({ pulse: FRAMES_A });
    bundle.seal();

    expect(() => erased(bundle).registerKeyframes({ motion })).toThrow(
      /sealed/
    );
  });

  it('a second seal() throws — one sealed instance per bundle', () => {
    const bundle = createSystem().build();
    bundle.seal();
    expect(() => bundle.seal()).toThrow(/sealed/);
  });

  it('a non-collection value is rejected at runtime naming the key', () => {
    const bundle = createSystem().build();
    expect(() =>
      erased(bundle).registerKeyframes({ bogus: { frames: {} } })
    ).toThrow(/bogus/);
  });

  it('the sealed instance serializes from a snapshot the unsealed instance cannot reach: post-seal mutation of public registries affects nothing', () => {
    const bundle = createSystem()
      .addGroup('space', { m: { property: 'margin' } })
      .build();
    const sealed = bundle.seal();
    const before = sealed.toConfig().propConfig;

    // SAFETY: the public registry field is runtime-mutable by design; the
    // widened record type simulates a consumer mutating it after seal.
    (sealed.propRegistry as Record<string, { property: string }>).injected = {
      property: 'color',
    };
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
    const sealed = erased(consumerBundle)
      .registerKeyframes({ motion: localMotion })
      .seal();

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
    const sealed = erased(consumerBundle.registerKeyframes({ c }))
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
  // loud") — the DEF-11 flip, landed with the migration increment.
  it('extending a built-but-unsealed system instance fails loud', () => {
    const kit = createSystem()
      .addGroup('kitSurface', { kitGlow: { property: 'boxShadow' } })
      .build().system;
    expect(() => createSystem().extend(kit)).toThrow(/seal/);
  });

  it('a sealed kit with registered vocabulary consumed through includes: is witnessed and not merged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const kitBundle = createSystem().build();
    const kitMotion = kitBundle.createKeyframes({ pulse: FRAMES_A });
    const kit = kitBundle.registerKeyframes({ kitMotion }).seal();

    const sealed = createSystem({ includes: [kit] })
      .build()
      .seal();
    const record = recordOf(sealed);

    expect(record.keyframes).toEqual([]);
    expect(record.legacyVerbs).toHaveLength(1);
    expect(record.legacyVerbs[0]).toMatchObject({
      code: 'animus.vocabulary.legacy-verb',
      verb: 'includes',
      source: 'includes source #1',
      names: ['kitMotion'],
    });
    // The record is the SOLE witness channel — a runtime warn would ship in
    // production consumer bundles and be swallowed by the extraction host.
    expect(warn).not.toHaveBeenCalled();
  });

  it('a sealed kit with registered vocabulary consumed through from() is witnessed and not merged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const kitBundle = createSystem().build();
    const kitMotion = kitBundle.createKeyframes({ pulse: FRAMES_A });
    const kit = kitBundle.registerKeyframes({ kitMotion }).seal();

    const sealed = createSystem().from(kit).build().seal();
    const record = recordOf(sealed);

    expect(record.keyframes).toEqual([]);
    expect(record.legacyVerbs).toHaveLength(1);
    expect(record.legacyVerbs[0]).toMatchObject({
      verb: 'from',
      source: 'from source #1',
      names: ['kitMotion'],
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('a source consumed through BOTH a legacy verb and .extend() is not falsely witnessed — delivered names are filtered at seal', () => {
    const kitBundle = createSystem().build();
    const kitMotion = kitBundle.createKeyframes({ pulse: FRAMES_A });
    const kit = kitBundle.registerKeyframes({ kitMotion }).seal();

    const sealed = createSystem({ includes: [kit] })
      .extend(kit)
      .build()
      .seal();
    const record = recordOf(sealed);

    expect(record.keyframes.map((entry) => entry.name)).toEqual(['kitMotion']);
    expect(record.legacyVerbs).toEqual([]);
  });

  it('partial delivery narrows the witness to the genuinely refused names', () => {
    const kitABundle = createSystem().build();
    const kitMotion = kitABundle.createKeyframes({ pulse: FRAMES_A });
    const kitFade = kitABundle.createKeyframes({ fade: FRAMES_B });
    const kitA = kitABundle
      .registerKeyframes({ kitMotion })
      .registerKeyframes({ kitFade })
      .seal();
    // A second kit registering ONLY kitMotion, extended — delivering one of
    // kitA's two names through a different source.
    const kitBBundle = createSystem().build();
    const kitB = kitBBundle
      .registerKeyframes({
        kitMotion: kitBBundle.createKeyframes({ pulse: FRAMES_A }),
      })
      .seal();

    const sealed = createSystem({ includes: [kitA] })
      .extend(kitB)
      .build()
      .seal();
    const record = recordOf(sealed);

    expect(record.legacyVerbs).toHaveLength(1);
    expect(record.legacyVerbs[0]?.names).toEqual(['kitFade']);
  });

  it('.extend() of the same sealed kit produces no legacy-verb witness — it carries', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const kitBundle = createSystem().build();
    const kitMotion = kitBundle.createKeyframes({ pulse: FRAMES_A });
    const kit = kitBundle.registerKeyframes({ kitMotion }).seal();

    const sealed = createSystem().extend(kit).build().seal();
    const record = recordOf(sealed);

    expect(record.keyframes.map((entry) => entry.name)).toEqual(['kitMotion']);
    expect(record.legacyVerbs).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('registerGlobalStyles rides the same window: record order, fontFaces payload, shared name-space', () => {
    const bundle = createSystem().build();
    const motion = bundle.createKeyframes({ pulse: FRAMES_A });
    const reset = bundle.createGlobalStyles(
      { body: { margin: 0 } },
      {
        fontFaces: [
          { family: 'TestFont', src: [{ url: 'font.woff2', format: 'woff2' }] },
        ],
      }
    );
    const typographyBlock = bundle.createGlobalStyles({
      h1: { fontWeight: 700 },
    });

    const sealed = bundle
      .registerKeyframes({ motion })
      .registerGlobalStyles({ reset })
      .registerGlobalStyles({ typographyBlock })
      .seal();

    const record = recordOf(sealed);
    expect(record.keyframes.map((entry) => entry.name)).toEqual(['motion']);
    expect(record.globalStyles.map((entry) => entry.name)).toEqual([
      'reset',
      'typographyBlock',
    ]);
    expect(record.globalStyles[0]?.styles).toEqual({ body: { margin: 0 } });
    expect(record.globalStyles[0]?.fontFaces?.[0]?.family).toBe('TestFont');
    expect(record.globalStyles[1]?.fontFaces).toBeUndefined();
    expect(Object.isFrozen(record.globalStyles[0])).toBe(true);
    expect(Object.isFrozen(record.globalStyles[0]?.styles)).toBe(true);
  });

  it('a global-style block colliding with a keyframes name is witnessed cross-kind — one name-space', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const bundle = createSystem().build();
    const motion = bundle.createKeyframes({ pulse: FRAMES_A });
    const block = bundle.createGlobalStyles({ body: { margin: 0 } });

    const sealed = erased(bundle.registerKeyframes({ motion }))
      .registerGlobalStyles({ motion: block })
      .seal();

    const record = recordOf(sealed);
    expect(record.keyframes).toEqual([]);
    expect(record.globalStyles.map((entry) => entry.name)).toEqual(['motion']);
    expect(record.collisions).toHaveLength(1);
    expect(record.collisions[0]).toMatchObject({ name: 'motion' });
  });

  it('a sealed kit global-style block carries through .extend() ahead of local blocks', () => {
    const kitBundle = createSystem().build();
    const kitReset = kitBundle.createGlobalStyles({ body: { margin: 0 } });
    const kit = kitBundle.registerGlobalStyles({ kitReset }).seal();

    const consumerBundle = createSystem().extend(kit).build();
    const appStyles = consumerBundle.createGlobalStyles({
      main: { padding: 0 },
    });
    const sealed = consumerBundle.registerGlobalStyles({ appStyles }).seal();

    expect(recordOf(sealed).globalStyles.map((entry) => entry.name)).toEqual([
      'kitReset',
      'appStyles',
    ]);
  });

  it('registration after seal throws for global styles too', () => {
    const bundle = createSystem().build();
    const block = bundle.createGlobalStyles({ body: { margin: 0 } });
    bundle.seal();
    expect(() => erased(bundle).registerGlobalStyles({ block })).toThrow(
      /sealed/
    );
  });

  it('a vocabulary-free sealed source through legacy verbs stays silent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const plainKit = createSystem().build().seal();
    const sealed = createSystem({ includes: [plainKit] })
      .build()
      .seal();
    expect(recordOf(sealed).legacyVerbs).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});
