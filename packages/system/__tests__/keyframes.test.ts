import { describe, expect, test } from 'vitest';

import { keyframes } from '../src/keyframes';

describe('keyframes() — collection factory', () => {
  test('collection is branded', () => {
    const motion = keyframes({
      fade: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
    });

    expect(motion.__brand).toBe('Keyframes');
  });

  test('__frames carries per-key name + raw frame data', () => {
    const fadeFrames = { '0%': { opacity: 0 }, '100%': { opacity: 1 } };
    const motion = keyframes({ fade: fadeFrames });

    expect(motion.__frames.fade.frames).toEqual(fadeFrames);
    expect(motion.__frames.fade.name).toMatch(/^animus-kf-[a-z0-9]+$/);
  });

  test('each named key exposes a branded KeyframeRef', () => {
    const motion = keyframes({
      ember: { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.5 } },
      flow: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
    });

    expect(motion.ember.__brand).toBe('KeyframeRef');
    expect(motion.ember.__name).toBe('ember');
    expect(motion.flow.__brand).toBe('KeyframeRef');
    expect(motion.flow.__name).toBe('flow');
  });

  test('ref coerces to its resolved name via toString / valueOf', () => {
    const motion = keyframes({
      fade: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
    });

    const resolvedName = motion.__frames.fade.name;
    expect(String(motion.fade)).toBe(resolvedName);
    expect(`${motion.fade}`).toBe(resolvedName);
    expect(motion.fade.valueOf()).toBe(resolvedName);
  });

  test('identical frame bodies across keys produce identical names (dedupe)', () => {
    const shared = { '0%': { opacity: 0 }, '100%': { opacity: 1 } };
    const motion = keyframes({ first: shared, second: shared });

    expect(motion.__frames.first.name).toBe(motion.__frames.second.name);
  });

  test('different frame bodies produce different names', () => {
    const motion = keyframes({
      fadeIn: { '0%': { opacity: 0 }, '100%': { opacity: 1 } },
      fadeOut: { '0%': { opacity: 1 }, '100%': { opacity: 0 } },
    });

    expect(motion.__frames.fadeIn.name).not.toBe(motion.__frames.fadeOut.name);
  });

  test('name is deterministic regardless of stop declaration order', () => {
    const a = keyframes({
      k: {
        '0%': { opacity: 0 },
        '50%': { opacity: 0.5 },
        '100%': { opacity: 1 },
      },
    });
    const b = keyframes({
      k: {
        '100%': { opacity: 1 },
        '0%': { opacity: 0 },
        '50%': { opacity: 0.5 },
      },
    });

    expect(a.__frames.k.name).toBe(b.__frames.k.name);
  });

  test('name is deterministic regardless of property declaration order', () => {
    const a = keyframes({
      k: { '0%': { opacity: 0, transform: 'scale(1)' } },
    });
    const b = keyframes({
      k: { '0%': { transform: 'scale(1)', opacity: 0 } },
    });

    expect(a.__frames.k.name).toBe(b.__frames.k.name);
  });

  test('compound percent stops preserved verbatim in frames', () => {
    const motion = keyframes({
      pulse: {
        '0%, 100%': { transform: 'scale(1)' },
        '50%': { transform: 'scale(1.05)' },
      },
    });

    expect(motion.__frames.pulse.frames['0%, 100%']).toEqual({
      transform: 'scale(1)',
    });
  });

  test('empty collection produces a valid collection with only branding', () => {
    const empty = keyframes({});

    expect(empty.__brand).toBe('Keyframes');
    expect(empty.__frames).toEqual({});
  });

  test('KeyframeRef literal name is preserved at the type level', () => {
    const motion = keyframes({
      ember: { '0%': { opacity: 0 } },
      flow: { '0%': { opacity: 0 } },
    });

    // Type-level assertion: __name narrows to the literal key.
    // (Runtime values documented above; this scenario anchors the TS contract.)
    const emberName: 'ember' = motion.ember.__name;
    const flowName: 'flow' = motion.flow.__name;
    expect(emberName).toBe('ember');
    expect(flowName).toBe('flow');
  });
});
