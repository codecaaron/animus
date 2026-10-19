import {
  buildPathAliasesJson,
  describeLightningTargets,
  isPathWithinRoot,
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
import { lightningTargetsFor } from './css';
import { viteCssTargets } from './css-targets';

import type { PluginContext } from './context';
import type { ResolvedConfig } from 'vite';

/** The targets Vite's own first Lightning CSS stage compiles for: its
 *  Lightning CSS transformer's, which the dev component sheet, a string in
 *  a JS module, never passes through; otherwise its minification's. */
function viteLightningTargets(config: ResolvedConfig) {
  const transformer = config.css.lightningcss?.targets;
  if (config.css.transformer === 'lightningcss' && transformer) {
    return { targets: transformer, source: "Vite's css.lightningcss.targets" };
  }
  const minification = viteCssTargets(config.build.cssTarget);
  return (
    minification && {
      targets: minification,
      source: "Vite's build.cssTarget",
    }
  );
}

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
  const outputs = viteOutputTargets(config);
  ctx.outputExcludes = outputExclusions(config.root, outputs);
  // Animus's folder in Vite's cache, unless Vite would serve or ship it:
  // the cache inside publicDir or a build's outDir keeps the session's own.
  const cacheDir = resolve(config.cacheDir, 'animus');
  const shipped = [config.publicDir, ...outputs.dirs].some(
    (dir) => dir !== '' && isPathWithinRoot(dir, cacheDir)
  );
  ctx.cacheDir = shipped ? undefined : cacheDir;
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
  // How a built page names its assets, which a split build's slice links
  // follow as Vite's own links do.
  ctx.renderBuiltUrl = config.experimental.renderBuiltUrl;
  ctx.viteRoot = config.root;
  ctx.serverOrigin = config.server.origin ?? '';
  ctx.publicDir = config.publicDir;

  const { targets, source } = lightningTargetsFor(
    ctx.options.targets,
    ctx.rootDir,
    viteLightningTargets(config)
  );
  ctx.lightning = { targets, features: config.css.lightningcss ?? {} };
  ctx.log(
    `Lightning CSS targets resolved from ${source} (${Object.keys(targets).length} browsers): ${describeLightningTargets(targets)}`
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
