import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, test } from 'vitest';

/**
 * IS_DEV is the runtime's only dev-build signal, and the hosts it has to
 * satisfy cannot all be reproduced inside vitest (a browser bundle after
 * define-replacement, a QuickJS script with no `process`). Each case is
 * reproduced here by evaluating the module source itself in a fresh vm
 * context that has no `process` binding — the browser/QuickJS shape — with
 * the `process.env.NODE_ENV` token substituted the way a bundler's define
 * substitutes it (or left alone, for the host that never rewrites it).
 */
const source = readFileSync(
  resolve(import.meta.dirname, '../src/runtime/is-dev.ts'),
  'utf8'
);

const evaluateIsDev = (
  definedNodeEnv?: string,
  host: Record<string, unknown> = {}
): unknown => {
  const bundled = definedNodeEnv
    ? source.replaceAll('process.env.NODE_ENV', JSON.stringify(definedNodeEnv))
    : source;
  return runInNewContext(
    `${bundled.replaceAll('export const', 'const')}
IS_DEV;`,
    host
  );
};

describe('IS_DEV dev-build detection', () => {
  test('browser dev bundle: define-replaced token yields dev', () => {
    expect(evaluateIsDev('development')).toBe(true);
  });

  test('browser prod bundle: define-replaced token yields not-dev', () => {
    expect(evaluateIsDev('production')).toBe(false);
  });

  test('host that never rewrites the token: no throw, not dev', () => {
    expect(() => evaluateIsDev()).not.toThrow();
    expect(evaluateIsDev()).toBe(false);
  });

  test('host with a partial process (no env): no throw, not dev', () => {
    expect(() => evaluateIsDev(undefined, { process: {} })).not.toThrow();
    expect(evaluateIsDev(undefined, { process: {} })).toBe(false);
  });

  test('node host reads the real env', () => {
    const node = (nodeEnv: string) =>
      evaluateIsDev(undefined, { process: { env: { NODE_ENV: nodeEnv } } });
    expect(node('development')).toBe(true);
    expect(node('production')).toBe(false);
  });
});
