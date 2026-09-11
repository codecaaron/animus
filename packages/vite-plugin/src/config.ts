import { buildPathAliasesJson, resolveMode } from '@animus-ui/extract/pipeline';

import { resolveLightningTargets } from './css';

import type { PluginContext } from './context';
import type { ResolvedConfig } from 'vite';

export function applyResolvedConfig(
  ctx: PluginContext,
  config: ResolvedConfig
): void {
  // Lifecycle signal: HMR ownership, rediscovery, and cache behavior key on
  // the host command, never on the explicit `mode` option.
  ctx.isProd = config.command === 'build';
  // Emission signal: explicit `mode` wins over the command signal for the
  // decisions that change emitted bytes — engine devMode and minify default.
  ctx.emissionProd =
    resolveMode(ctx.options.mode, () =>
      config.command === 'build' ? 'production' : 'development'
    ).mode === 'production';
  ctx.rootDir = config.root;
  ctx.logger = config.logger;
  // Public base for dev /@fs asset URLs (build URLs are resolved by Vite's
  // own asset pipeline, which applies base itself).
  ctx.base = config.base ?? '/';

  ctx.lcssTargets = resolveLightningTargets(ctx.options.targets, ctx.rootDir);
  ctx.log(
    `Lightning CSS targets resolved (${Object.keys(ctx.lcssTargets).length} browsers)`
  );

  const pairs: Parameters<typeof buildPathAliasesJson>[0] = [];
  for (const entry of config.resolve.alias) {
    if (entry.find instanceof RegExp) continue;
    pairs.push({
      pattern: entry.find,
      target: entry.replacement,
      kind: 'prefix',
    });
  }
  const built = buildPathAliasesJson(pairs, ctx.rootDir);
  if (built) {
    ctx.pathAliasesJson = built.json;
    ctx.log(`Path aliases forwarded: ${built.count} entries`);
  }
}
