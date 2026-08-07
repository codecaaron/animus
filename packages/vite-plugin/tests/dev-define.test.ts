import { describe, expect, test } from 'vitest';

import { animusExtract } from '../src/index';

import type { ConfigEnv } from 'vite';

/**
 * The system runtime gates its development-only diagnostics on the
 * `__ANIMUS_DEV__` define. The plugin is what supplies it, keyed on Vite's own
 * command, so a production build folds those branches away and a dev server
 * keeps them.
 */
describe('__ANIMUS_DEV__ define', () => {
  const runConfigHook = (command: ConfigEnv['command']) => {
    const hook = animusExtract({ system: './src/ds.ts' }).config;
    if (typeof hook !== 'function') {
      throw new Error('expected a plain function `config` hook');
    }
    return hook.call(undefined as never, {}, { command, mode: 'test' });
  };

  test('dev serve declares the token as dev', () => {
    expect(runConfigHook('serve')).toEqual({
      define: { __ANIMUS_DEV__: true },
    });
  });

  test('build declares the token as not-dev', () => {
    expect(runConfigHook('build')).toEqual({
      define: { __ANIMUS_DEV__: false },
    });
  });
});
