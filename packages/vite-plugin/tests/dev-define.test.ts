import { describe, expect, test } from 'vitest';

import { animusExtract } from '../src/index';

import type { ConfigEnv, HookHandler, Plugin } from 'vite';

type ConfigHook = HookHandler<NonNullable<Plugin['config']>>;
type ConfigHookCall = OmitThisParameter<ConfigHook>;

describe('__ANIMUS_DEV__ define', () => {
  const runConfigHook = (command: ConfigEnv['command']) => {
    const hook = animusExtract({ system: './src/ds.ts' }).config;
    if (hook === undefined || 'handler' in hook) {
      throw new Error('expected a plain function `config` hook');
    }
    const callConfigHook: ConfigHookCall = hook;
    return callConfigHook({}, { command, mode: 'test' });
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
