import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, test } from 'vitest';

const source = readFileSync(
  resolve(import.meta.dirname, '../src/runtime/is-dev.ts'),
  'utf8'
);

interface EvaluationHost {
  process?: { env?: { NODE_ENV?: string } };
}

const evaluateIsDev = (
  definedNodeEnv?: string,
  host: EvaluationHost = {},
  definedDev?: boolean
): boolean => {
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

  test('host that never rewrites the token: no throw, not dev', () => {
    expect(evaluateIsDev()).toBe(false);
  });

  test('host with a partial process (no env): no throw, and DEV', () => {
    expect(evaluateIsDev(undefined, { process: {} })).toBe(true);
  });

  test('node host reads the real env', () => {
    const node = (nodeEnv: string) =>
      evaluateIsDev(undefined, { process: { env: { NODE_ENV: nodeEnv } } });
    expect(node('development')).toBe(true);
    expect(node('production')).toBe(false);
  });

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
