import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  resolveClasses,
  serializeValueKey,
} from '../src/runtime/resolveClasses';

const config = (base: Partial<Parameters<typeof resolveClasses>[2]> = {}) => ({
  systemPropNames: ['p'],
  ...base,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('drop diagnostic', () => {
  test('static map hit resolves identically and emits no warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses('animus-A-static1', { p: 8 }, config(), {
      p: { '8': 'animus-u-abc' },
    });
    expect(res.classes).toEqual(['animus-A-static1', 'animus-u-abc']);
    expect(res.dynamicStyle).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  test('dynamic slot hit resolves identically and emits no warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses(
      'animus-A-dyn1',
      { p: 12 },
      config(),
      undefined,
      { p: { varName: '--animus-p', slotClass: 'animus-dyn-p' } }
    );
    expect(res.classes).toEqual(['animus-A-dyn1', 'animus-dyn-p']);
    expect(res.dynamicStyle).toEqual({ '--animus-p': '12px' });
    expect(warn).not.toHaveBeenCalled();
  });

  test('unresolvable value warns with component, prop, and serialized value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = resolveClasses('animus-A-drop1', { p: 999 }, config());
    expect(res.classes).toEqual(['animus-A-drop1']);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0][0]);
    expect(msg).toContain('animus:drop');
    expect(msg).toContain('animus-A-drop1');
    expect(msg).toContain('p');
    expect(msg).toContain('999');
  });

  test('serializes responsive values exactly in the warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const value = { md: 24, _: 8 };
    const serializedValue = serializeValueKey(value);
    expect(serializedValue).toBe('_:8|md:24');

    resolveClasses('animus-A-responsive-drop1', { p: value }, config());

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain(serializedValue);
  });

  test('warns once per (component, prop) pair', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveClasses('animus-A-once1', { p: 1 }, config());
    resolveClasses('animus-A-once1', { p: 2 }, config());
    expect(warn).toHaveBeenCalledTimes(1);
  });

  test('warns independently for distinct component and prop pairs', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveClasses('animus-A-pairs1', { p: 1 }, config());
    resolveClasses('animus-A-pairs2', { p: 2 }, config());
    resolveClasses(
      'animus-A-pairs1',
      { q: 3 },
      config({ systemPropNames: ['q'] })
    );
    expect(warn).toHaveBeenCalledTimes(3);
  });

  test('production mode emits no warning', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    resolveClasses('animus-A-prod1', { p: 999 }, config());
    expect(warn).not.toHaveBeenCalled();
  });

  test('partial process without env remains dev-observable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('process', {});

    expect(() =>
      resolveClasses('animus-A-partial1', { p: 999 }, config())
    ).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
