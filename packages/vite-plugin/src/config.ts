import {
  buildPathAliasesJson,
  outputExclusions,
  resolveMode,
  viteAssetClassification,
  viteExtensionPolicy,
  viteHostExpander,
  viteOutputTargets,
} from '@animus-ui/extract/pipeline';
import { isAbsolute, join, resolve } from 'path';
import { isFileLoadingAllowed } from 'vite';

import { processCopyDir } from './asset-copy-dirs';
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
  // Serving or watching runs another turn, so an error-level diagnostic is
  // reported there; only a one-shot build fails on one.
  ctx.development = !ctx.isProd || Boolean(config.build.watch);
  // Emission signal: explicit `mode` wins over the command signal for the
  // decisions that change emitted bytes — engine devMode and minify default.
  ctx.emissionProd =
    resolveMode(ctx.options.mode, () =>
      config.command === 'build' ? 'production' : 'development'
    ).mode === 'production';
  ctx.rootDir = config.root;
  // Dev asset() URLs name immutable copies where the dev server serves
  // them, by Vite's own rule: strict mode, `server.fs.allow` and
  // `server.fs.deny` together. Each process copies into its own directory.
  if (!ctx.isProd) {
    const copyDir = resolve(config.cacheDir, 'animus-assets', processCopyDir());
    const served = isFileLoadingAllowed(config, join(copyDir, 'asset'));
    ctx.assetCopyDir = served ? copyDir : null;
    // Each copy is checked again by its own path: a deny may name a file.
    ctx.servesFile = (path) => isFileLoadingAllowed(config, path);
    if (!served) {
      ctx.warn(
        `[animus-extract] asset() copies in ${copyDir} are not served under server.fs; serving the live files instead, so an edited asset keeps its URL`
      );
    }
  }
  ctx.outputExcludes = outputExclusions(config.root, viteOutputTargets(config));
  ctx.configFiles = config.configFile ? [config.configFile] : [];
  // Vite substitutes the mode for its `development|production` condition.
  ctx.resolveConditions = config.resolve.conditions.map((condition) =>
    condition === 'development|production'
      ? config.isProduction
        ? 'production'
        : 'development'
      : condition
  );
  // Vite's extension order, with its defaults applied.
  ctx.extensionPolicy = viteExtensionPolicy(config.resolve.extensions);
  ctx.assetClassification = viteAssetClassification(config.assetsInclude);
  // How the build expands computed loads (spec §6.3): only where every
  // environment is bundled and no alias rewrites a relative specifier.
  ctx.loadExpander = viteHostExpander(config);
  ctx.log(`extension order: ${ctx.extensionPolicy.resolverVersion}`);
  ctx.logger = config.logger;
  // What dev asset URLs are served under (build URLs are resolved by Vite's
  // own asset pipeline, which applies base itself).
  ctx.base = config.base ?? '/';
  ctx.viteRoot = config.root;
  ctx.serverOrigin = config.server.origin ?? '';

  ctx.lcssTargets = resolveLightningTargets(ctx.options.targets, ctx.rootDir);
  ctx.log(
    `Lightning CSS targets resolved (${Object.keys(ctx.lcssTargets).length} browsers)`
  );

  const pairs: Parameters<typeof buildPathAliasesJson>[0] = [];
  for (const entry of config.resolve.alias) {
    if (entry.find instanceof RegExp) continue;
    // A bare target (`react` → `preact/compat`) aliases a package, not a
    // path: the resolver's package resolution follows it.
    if (!isAbsolute(entry.replacement) && !entry.replacement.startsWith('.')) {
      continue;
    }
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
  ctx.createSession();
}
