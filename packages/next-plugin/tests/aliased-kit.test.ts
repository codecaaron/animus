/**
 * @vitest-environment node
 *
 * A Next webpack build whose `resolve.alias` names another instance of a
 * kit (C8), through the fixture's real webpack and the real engine.
 */
import { createRequire } from 'module';
import { afterEach, beforeEach, expect, test } from 'vitest';

import { getSharedCss, sessionKey } from '../../extract/session/singleton';
import {
  createAliasedKitApp,
  disposeTempRoots,
  resetAnimusGlobals,
} from '../../extract/tests/session/session-fixtures';
import { AnimusWebpackPlugin } from '../src/plugin';
import {
  probeRealEnginePrerequisites,
  WEBPACK_FIXTURES,
} from './webpack-watch/prerequisites';
import { loadFixtureWebpack } from './webpack-watch/watch-session';

const prerequisites = probeRealEnginePrerequisites();

type PluginCompiler = Parameters<AnimusWebpackPlugin['apply']>[0];

/** The fixture's webpack factory, as far as this test drives it: a real
 *  compiler whose `run` hook the plugin taps. */
type AliasingWebpack = (config: {
  context: string;
  mode: 'development';
  entry: string;
  resolve: { alias: Record<string, string> };
}) => PluginCompiler & {
  hooks: { run: { promise(compiler: PluginCompiler): Promise<void> } };
};

let restoreGlobals: () => void;

beforeEach(() => {
  restoreGlobals = resetAnimusGlobals();
});

afterEach(() => {
  restoreGlobals();
  disposeTempRoots();
});

/** Contract (C8): under webpack's `resolve.alias`, a strict build evaluates
 *  the kit instance the alias names, the one extraction analyses, instead
 *  of failing with system-instance-mismatch. */
test.skipIf(!prerequisites.ok)(
  'an aliased kit is evaluated from the instance the alias names',
  async () => {
    const root = createAliasedKitApp('animus-webpack-aliased-');
    const webpackPath = WEBPACK_FIXTURES[0].webpackPath;
    // Initialises the fixture's lazily loaded bundle.
    loadFixtureWebpack(webpackPath);
    // SAFETY: Next's compiled webpack module exports a factory that accepts
    // any webpack config and returns a real Compiler, whose run hook is an
    // AsyncSeriesHook; this test passes the fields AliasingWebpack names.
    const { webpack } = createRequire(__filename)(webpackPath) as {
      webpack: AliasingWebpack;
    };
    const compiler = webpack({
      context: root,
      mode: 'development',
      entry: './src/App.tsx',
      resolve: { alias: { kit: 'alt-kit' } },
    });
    new AnimusWebpackPlugin(
      { system: './src/system.ts', strict: true },
      { build: 'b' }
    ).apply(compiler);
    await compiler.hooks.run.promise(compiler);
    const css = getSharedCss(sessionKey('b', root));
    expect(css).toContain('#ff6347');
    expect(css).not.toContain('#111111');
  },
  60_000
);
