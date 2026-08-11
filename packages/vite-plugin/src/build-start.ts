import {
  assembleStylesheet,
  clearEngineCache,
  collectExternalPackageSources,
  contentHash,
  createExcludeMatcher,
  DEFAULT_EXTENSIONS,
  discoverFiles,
  extractSystemFilePackages,
  findAssetSpecifiers,
  firstOwners,
  preprocessMdx,
  substituteAssetPlaceholders,
  validateLayerOrder,
} from '@animus-ui/extract/pipeline';
import { readFileSync } from 'fs';
import { basename, extname, relative } from 'path';

import type { PluginContext } from './context';

/**
 * buildStart: load the system, discover and ingest sources (local +
 * external packages), run whole-project analysis, and log the report.
 * `resolveSpecifier` is the bundler seam — Vite's `this.resolve` mapped to
 * an absolute id. `emitAsset` (build mode only) is Rollup's `this.emitFile`
 * for `asset()` placeholder substitution; absent in dev, where resolved
 * files are served via base + `/@fs/` instead.
 */
export async function runBuildStart(
  ctx: PluginContext,
  resolveSpecifier: (specifier: string) => Promise<string | null>,
  emitAsset?: (fileName: string, source: Uint8Array) => string
): Promise<void> {
  // Clear Rust-side per-file cache so stale results from a prior
  // server lifecycle never bleed into a fresh build/dev start.
  clearEngineCache(ctx.engineApi);

  // Reset the asset() pass BEFORE step 6's runAnalysis: its substitution
  // pass consults this state, and Rollup reference ids are scoped to one
  // build — a second buildStart on the same context (another environment,
  // a --watch rebuild) must not splice build #1's ids into build #2's CSS.
  ctx.assetPassComplete = false;
  ctx.assetUrlBySpecifier.clear();
  ctx.assetResolutionFailures.clear();

  // 1. Load system: config, theme, transforms, global styles
  let t0 = performance.now();
  ctx.loadSystem();

  // Validate layer ordering
  if (ctx.options.layers) {
    validateLayerOrder(ctx.options.layers);
    ctx.log(`Custom layers: [${ctx.options.layers.join(', ')}]`);
  }

  if (ctx.verbose) {
    const propCount = Object.keys(JSON.parse(ctx.system.propConfigJson)).length;
    const groupCount = Object.keys(
      JSON.parse(ctx.system.groupRegistryJson)
    ).length;
    ctx.log(
      `System loaded: ${propCount} props, ${groupCount} groups (${Math.round(performance.now() - t0)}ms)`
    );
  }

  // 3. Discover source files via recursive directory walk
  t0 = performance.now();
  // Refresh the hoisted `extensionsSet` and `excludeMatcher` in case
  // `options` was mutated between server lifecycles. Sources of truth stay
  // `options.extensions ?? DEFAULT_EXTENSIONS` / `options.exclude`.
  ctx.excludeMatcher = createExcludeMatcher(ctx.options.exclude);
  const excludePatterns = ctx.excludeMatcher;
  ctx.extensionsSet = new Set(ctx.options.extensions ?? DEFAULT_EXTENSIONS);
  const shouldHandleMdx = ctx.extensionsSet.has('.mdx');
  let mdxMissingDepWarned = false;

  // One MDX preprocess policy for the local and package ingest paths:
  // missing-dep warns once, errors warn per file, success rewrites to `.tsx`
  // so the Rust source-type helper parses the output as tsx.
  const preprocessMdxEntry = async (
    source: string,
    relPath: string
  ): Promise<{ source: string; relPath: string } | null> => {
    const result = await preprocessMdx(source, relPath);
    if (result.kind === 'missing-dep') {
      if (!mdxMissingDepWarned) {
        ctx.warn(
          '⚠ .mdx in extensions but @mdx-js/mdx not installed; MDX files skipped'
        );
        mdxMissingDepWarned = true;
      }
      return null;
    }
    if (result.kind === 'error') {
      ctx.warn(`⚠ MDX preprocessing failed for ${relPath}: ${result.error}`);
      return null;
    }
    return { source: result.source!, relPath: relPath + '.tsx' };
  };
  const filePaths = discoverFiles(
    ctx.rootDir,
    ctx.rootDir,
    excludePatterns,
    ctx.extensionsSet
  );

  // 4. Read all file sources and build file entries (preprocessing MDX as we go)
  const fileEntries: Array<{
    path: string;
    source: string;
    hash?: string;
  }> = [];
  for (const filePath of filePaths) {
    try {
      let source = readFileSync(filePath, 'utf-8');
      let relPath = relative(ctx.rootDir, filePath);

      if (shouldHandleMdx && extname(filePath) === '.mdx') {
        const processed = await preprocessMdxEntry(source, relPath);
        if (!processed) continue;
        source = processed.source;
        relPath = processed.relPath;
      }

      const hash = !ctx.isProd ? contentHash(source) : undefined;
      fileEntries.push({ path: relPath, source, hash });

      // Populate file cache for dev HMR
      if (!ctx.isProd && hash) {
        ctx.fileCache.set(relPath, { hash, source });
      }
    } catch {
      // Skip unreadable files silently
    }
  }

  // 5. Discover external packages from system entry file imports and resolve them
  const localFileCount = fileEntries.length;
  const packageSpecifiers = extractSystemFilePackages(ctx.resolvedSystemPath!);

  ctx.externalSourceEntries.clear();
  ctx.externalKeyframesScanEntries.clear();

  // Shared traversal/ingest (spec: external-package-file-discovery);
  // only specifier resolution, MDX handling, and the hash/cache policy
  // below stay bundler-specific.
  const collected = await collectExternalPackageSources({
    specifiers: packageSpecifiers,
    resolveSpecifier,
    rootDir: ctx.rootDir,
    extensionsSet: ctx.extensionsSet,
    hasEntry: (relPath) => fileEntries.some((e) => e.path === relPath),
    preprocessFile: async (source, relPath, absPath) => {
      if (shouldHandleMdx && extname(absPath) === '.mdx') {
        return preprocessMdxEntry(source, relPath);
      }
      return { source, relPath };
    },
    onUnreadable: (relPath, err) =>
      ctx.warn(`skipped unreadable package file ${relPath}: ${String(err)}`),
  });

  ctx.packageMap = collected.packageMap;
  ctx.externalPackageOutcomes = collected.outcomes;
  ctx.externalDirOwners = firstOwners(collected.dirOwnerSets);
  ctx.externalFileOwners = collected.fileOwners;
  ctx.enforceIncludeResolution();
  for (const [specifier, srcEntry] of collected.sourceEntries) {
    ctx.externalSourceEntries.set(specifier, srcEntry);
  }
  for (const [specifier, scanEntry] of collected.keyframesScanEntries) {
    ctx.externalKeyframesScanEntries.set(specifier, scanEntry);
  }
  for (const entry of collected.entries) {
    const hash = !ctx.isProd ? contentHash(entry.source) : undefined;
    fileEntries.push({ path: entry.path, source: entry.source, hash });
    if (!ctx.isProd && hash) {
      ctx.fileCache.set(entry.path, { hash, source: entry.source });
    }
  }

  ctx.externalPackageDirs = collected.packageDirs;
  // Both prior registration points run before this assignment
  // (configureServer precedes buildStart; loadSystem precedes discovery), so
  // external dirs must register here or they are never watched.
  ctx.registerSystemWatchPaths();

  // Keyframes-only carve-out: external package entries contribute their
  // `Keyframes` collections to the analysis inputs; everything else about
  // the consumer system's authority is untouched.
  ctx.applyExternalKeyframes();

  const packageFileCount = fileEntries.length - localFileCount;
  ctx.log(
    `Discovered ${fileEntries.length} files (${packageFileCount} from packages) (${Math.round(performance.now() - t0)}ms)`
  );

  // 6. Run project-wide analysis to produce the manifest. The cross-source
  // token-contract gate (extraction-diagnostics) runs inside runAnalysis —
  // on this pass and on every HMR re-analysis alike.
  t0 = performance.now();
  ctx.runAnalysis(fileEntries);

  // 6c. asset() placeholder resolution (global-styles-system): resolve each
  // referenced specifier through the bundler. Dev serves the resolved file
  // via base + /@fs/. Build emits it as a Rollup asset and substitutes
  // Vite's own `__VITE_ASSET__<referenceId>__` marker: Vite's CSS pipeline
  // resolves the marker to the hashed file name (with base / relative-base
  // handling) BEFORE the stylesheet asset is itself hashed and emitted, so
  // the CSS `[hash]` reflects the final URL — and markers landing in JS
  // chunks (inlined/code-split CSS) are resolved by the same machinery. An
  // unsubstitutable specifier warns and emits literally in non-strict mode,
  // fails the build under strict.
  const assetSpecifiers = findAssetSpecifiers(ctx.globalCss);
  for (const specifier of assetSpecifiers) {
    const resolvedPath = await resolveSpecifier(specifier);
    if (!resolvedPath) {
      ctx.assetFallback(
        specifier,
        `[animus-extract] unresolvable asset() specifier: ${specifier}`
      );
      continue;
    }
    if (emitAsset) {
      try {
        const referenceId = emitAsset(
          basename(resolvedPath),
          readFileSync(resolvedPath)
        );
        ctx.assetUrlBySpecifier.set(
          specifier,
          `__VITE_ASSET__${referenceId}__`
        );
      } catch (err) {
        ctx.assetFallback(
          specifier,
          `[animus-extract] failed to emit asset() specifier ${specifier}: ${String(err)}`,
          err
        );
      }
    } else {
      ctx.assetUrlBySpecifier.set(specifier, ctx.devFsUrl(resolvedPath));
    }
  }
  ctx.globalCss = substituteAssetPlaceholders(
    ctx.globalCss,
    ctx.assetUrlBySpecifier
  );
  // From here on, runAnalysis owns late-appearing specifiers (dev resets).
  ctx.assetPassComplete = true;

  // 7. Surface diagnostics from the manifest
  if (ctx.storedManifest) {
    const report = ctx.storedManifest.report;
    if (report) {
      ctx.log(
        `Extracted ${report.components_extracted}/${report.components_total} components (${Math.round(performance.now() - t0)}ms)`
      );
      ctx.logTimingWaterfall(ctx.storedManifest.timing ?? {});
      ctx.log(
        `Reconciliation: ${report.components_extracted} kept, ${report.variants_eliminated} variants pruned, ${report.states_eliminated} states pruned`
      );

      // Always-on elimination warnings (not gated by verbose)
      const details: Array<{
        component: string;
        kind: string;
        name?: string;
        reason: string;
      }> = report.eliminated_details || [];
      for (const d of details) {
        if (d.kind === 'component') {
          ctx.warn(`⚠ ${d.component} eliminated: ${d.reason}`);
        } else if (d.kind === 'prospective_component') {
          ctx.warn(
            `⚠ ${d.component} would be eliminated in production: ${d.reason}`
          );
        } else if (d.kind === 'variant') {
          ctx.warn(`⚠ ${d.component} variant '${d.name}' pruned: ${d.reason}`);
        } else if (d.kind === 'state') {
          ctx.warn(`⚠ ${d.component} state '${d.name}' pruned: ${d.reason}`);
        }
      }
    }

    ctx.log(
      `CSS: ${ctx.resolvedComponentCss.length} bytes (${Object.keys(ctx.storedManifest.components || {}).length} components)`
    );

    if (!ctx.isProd && ctx.storedSheets) {
      const staticCss = assembleStylesheet({
        layers: ctx.options.layers,
        variableCss: ctx.system.variableCss,
        globalCss: ctx.globalCss,
      });
      const staticSize = staticCss.length;
      const componentSize = ctx.resolvedComponentCss.length;
      ctx.log(
        `Delivery: split mode — static ${staticSize} bytes, components ${componentSize} bytes (adopted stylesheet)`
      );
    } else {
      ctx.log('Delivery: single file mode (production)');
    }
  }

  // Compute @layer declaration for HTML injection (config-time, static).
  const { declaration } = assembleStylesheet({
    layers: ctx.options.layers,
    variableCss: '',
    globalCss: '',
    split: true,
  });
  ctx.layerDeclaration = declaration;

  if (ctx.options.verify) {
    ctx.runSelfVerify();
  }
}
