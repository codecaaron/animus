import { PluginContext } from '../src/context';

import type { MinimalPluginContextWithoutEnvironment } from 'vite';

/** Fixture for `buildIndexHtmlTags`: `isProd` is required, never defaulted,
 *  because a shared default hands one caller the wrong branch. */
export const LAYER_DECLARATION =
  '@layer anm-global, anm-base, anm-variants, anm-compounds, anm-states, anm-system, anm-custom;';

export const HTML_HOOK_CONTEXT: MinimalPluginContextWithoutEnvironment = {
  error: (error) => {
    throw error instanceof Error ? error : new Error(String(error));
  },
  info: () => {},
  warn: () => {},
  debug: () => {},
  meta: {
    rollupVersion: 'test',
    rolldownVersion: 'test',
    viteVersion: 'test',
    watchMode: false,
  },
};

export function contextWith(overrides: {
  isProd: boolean;
  appearanceBootstrap?: { code: string; cspHash: string };
  layerDeclaration?: string;
}): PluginContext {
  const options: ConstructorParameters<typeof PluginContext>[0] = {
    system: './ds.ts',
  };
  if (overrides.appearanceBootstrap) {
    options.appearanceBootstrap = overrides.appearanceBootstrap;
  }
  const ctx = new PluginContext(options);
  ctx.isProd = overrides.isProd;
  ctx.layerDeclaration = overrides.layerDeclaration ?? '';
  return ctx;
}
