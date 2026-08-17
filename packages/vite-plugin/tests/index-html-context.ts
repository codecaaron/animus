import { PluginContext } from '../src/context';

import type { MinimalPluginContextWithoutEnvironment } from 'vite';

/**
 * Shared fixture for the two suites that drive `buildIndexHtmlTags`: the
 * dev-only HMR bridge tag (`hmr-bridge-injection.test.ts`) and the build-time
 * bootstrap/layer pair (`appearance-bootstrap-injection.test.ts`).
 *
 * `isProd` is REQUIRED rather than defaulted: the builder has one dev-only
 * branch and two build-time ones, and the two suites want opposite answers —
 * a shared default would silently hand one of them the wrong branch.
 * `layerDeclaration` defaults to the plugin's own initial state (empty until
 * `buildStart` runs); a suite asserting on the layer tag passes it explicitly.
 */
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
