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
 * the `__ANIMUS_DEV__` and `process.env.NODE_ENV` tokens substituted the way
 * a bundler's define substitutes them (or left alone, for the hosts that
 * never rewrite them).
 */
const source = readFileSync(
  resolve(import.meta.dirname, '../src/runtime/is-dev.ts'),
  'utf8'
);

/**
 * The globals a host supplies to the fresh context. Only `process` is ever
 * installed: it is the one global the module source reads, and each host case
 * below differs solely in how much of it exists.
 */
interface EvaluationHost {
  process?: { env?: { NODE_ENV?: string } };
}

const evaluateIsDev = (
  definedNodeEnv?: string,
  host: EvaluationHost = {},
  definedDev?: boolean
): boolean => {
  // The ambient declaration of the define token is TS-only syntax that no
  // host ever evaluates — a bundler emits nothing for it.
  let bundled = source.replace(/^declare .*$/gm, '');
  if (definedDev !== undefined) {
    bundled = bundled.replaceAll('__ANIMUS_DEV__', String(definedDev));
  }
  if (definedNodeEnv) {
    bundled = bundled.replaceAll(
      'process.env.NODE_ENV',
      JSON.stringify(definedNodeEnv)
    );
  }
  const evaluated: unknown = runInNewContext(
    `${bundled.replaceAll('export const', 'const')}
IS_DEV;`,
    host
  );
  // The constant is a dev-build signal, not a truthiness: a host that produced
  // anything but a boolean has already broken the contract these cases assert.
  if (evaluated === true) return true;
  if (evaluated === false) return false;
  throw new TypeError(
    `IS_DEV evaluated to ${String(evaluated)}, not a boolean`
  );
};

describe('IS_DEV dev-build detection', () => {
  test('browser dev bundle: define-replaced token yields dev', () => {
    expect(evaluateIsDev('development')).toBe(true);
  });

  test('browser prod bundle: define-replaced token yields not-dev', () => {
    expect(evaluateIsDev('production')).toBe(false);
  });

  // Both hosts below reach the bare `process.env.NODE_ENV` read with no
  // `process` to read it from; returning `false` at all is the proof the
  // module-scope ReferenceError was caught rather than thrown.
  test('host that never rewrites the token: no throw, not dev', () => {
    expect(evaluateIsDev()).toBe(false);
  });

  test('host with a partial process (no env): no throw, and DEV', () => {
    // A process shim without env carries no production signal — dev is the
    // answer the optional-chained call-site reads this constant replaced
    // always gave, so a polyfilled bundle keeps its diagnostics reachable.
    expect(evaluateIsDev(undefined, { process: {} })).toBe(true);
  });

  test('node host reads the real env', () => {
    const node = (nodeEnv: string) =>
      evaluateIsDev(undefined, { process: { env: { NODE_ENV: nodeEnv } } });
    expect(node('development')).toBe(true);
    expect(node('production')).toBe(false);
  });

  // The build define is what a minifier can fold; the cases above stay the
  // contract for every host that supplies no such token.

  test('dev build define yields dev even against a production NODE_ENV token', () => {
    expect(evaluateIsDev('production', {}, true)).toBe(true);
  });

  test('production build define yields not-dev even against a development NODE_ENV token', () => {
    expect(evaluateIsDev('development', {}, false)).toBe(false);
  });

  test('build define outranks a real node env', () => {
    const withEnv = (nodeEnv: string, dev: boolean) =>
      evaluateIsDev(
        undefined,
        { process: { env: { NODE_ENV: nodeEnv } } },
        dev
      );
    expect(withEnv('development', false)).toBe(false);
    expect(withEnv('production', true)).toBe(true);
  });
});
