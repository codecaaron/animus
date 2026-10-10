import {
  assembleStylesheet,
  clearEngineCache,
  collectExternalPackageSources,
  contentHash,
  createExcludeMatcher,
  DEFAULT_EXTENSIONS,
  discoverFiles,
  engineModuleParser,
  extractSystemFilePackages,
  firstOwners,
  isDeletedSource,
  noKitFilesDiagnostics,
  surfaceManifestDiagnostics,
  unreadableSourceDiagnostic,
  validateLayerOrder,
} from '@animus-ui/extract/pipeline';
import { readFileSync } from 'fs';
import { basename, relative } from 'path';

import type { PluginContext } from './context';
import type { ManifestDiagnostic } from '@animus-ui/extract/pipeline';

/**
 * `resolveSpecifier` maps a specifier to an absolute id. `emitAsset` is
 * present in build only, where `asset()` files become Rollup assets.
 */
export async function runBuildStart(
  ctx: PluginContext,
  resolveSpecifier: (specifier: string) => Promise<string | null>,
  emitAsset?: (fileName: string, source: Uint8Array) => string
): Promise<void> {
  // Clear Rust-side per-file cache so stale results from a prior
  // server lifecycle never bleed into a fresh build/dev start.
  clearEngineCache(ctx.engineApi);

  // Reset before the analysis below, which consults this state: Rollup
  // reference ids are scoped to one build and must not cross into the next.
  ctx.assetPassComplete = false;
  ctx.assetUrlBySpecifier.clear();
  ctx.assetResolutionFailures.clear();

  let t0 = performance.now();
  ctx.loadSystem();

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

  t0 = performance.now();
  // Refresh in case `options` was mutated between server lifecycles.
  ctx.excludeMatcher = createExcludeMatcher(ctx.options.exclude);
  const excludePatterns = ctx.excludeMatcher;
  ctx.extensionsSet = new Set(ctx.options.extensions ?? DEFAULT_EXTENSIONS);
  const filePaths = discoverFiles(
    ctx.rootDir,
    ctx.rootDir,
    excludePatterns,
    ctx.extensionsSet
  );

  // Adaptation happens once, after local and external discovery establish
  // the complete resolver index.
  const rawEntries: Array<{
    path: string;
    source: string;
    hash?: string;
  }> = [];
  // A configured file that cannot be read is lost input: error severity fails
  // a strict build, and the analysis prunes nothing it might render.
  const ingestionFailures: ManifestDiagnostic[] = [];
  for (const filePath of filePaths) {
    const relPath = relative(ctx.rootDir, filePath);
    let source: string;
    try {
      source = readFileSync(filePath, 'utf-8');
    } catch (err) {
      if (!isDeletedSource(err)) {
        ingestionFailures.push(unreadableSourceDiagnostic(relPath, err));
      }
      continue;
    }
    const hash = !ctx.isProd ? contentHash(source) : undefined;
    rawEntries.push({ path: relPath, source, hash });
  }

  const localFileCount = rawEntries.length;
  const discoveryDiagnostics: ManifestDiagnostic[] = [];
  const packageSpecifiers = await extractSystemFilePackages(
    ctx.resolvedSystemPath!,
    engineModuleParser(ctx.engineApi()),
    (diagnostic) => discoveryDiagnostics.push(diagnostic),
    resolveSpecifier
  );

  ctx.externalSourceEntries.clear();

  // Shared traversal; resolution and hash policy stay bundler-specific.
  const collected = await collectExternalPackageSources({
    specifiers: packageSpecifiers,
    resolveSpecifier,
    rootDir: ctx.rootDir,
    extensionsSet: ctx.extensionsSet,
    hasEntry: (relPath) => rawEntries.some((entry) => entry.path === relPath),
    onUnreadable: (relPath, err) => {
      if (!isDeletedSource(err)) {
        ingestionFailures.push(unreadableSourceDiagnostic(relPath, err));
      }
    },
  });
  ctx.ingestionFailureDiagnostics = ingestionFailures;
  // `verify` reports an empty kit through the structural self-check.
  surfaceManifestDiagnostics(
    {
      diagnostics: [
        ...discoveryDiagnostics,
        ...(ctx.options.verify
          ? []
          : noKitFilesDiagnostics(collected.outcomes)),
      ],
    },
    (message) => ctx.warn(message)
  );

  ctx.packageMap = collected.packageMap;
  ctx.externalPackageOutcomes = collected.outcomes;
  ctx.externalDirOwners = firstOwners(collected.dirOwnerSets);
  ctx.externalFileOwners = collected.fileOwners;
  ctx.enforceIncludeResolution();
  for (const [specifier, srcEntry] of collected.sourceEntries) {
    ctx.externalSourceEntries.set(specifier, srcEntry);
  }
  ctx.externalSourceSideEffects = collected.sourceEntrySideEffects;
  for (const entry of collected.entries) {
    const hash = !ctx.isProd ? contentHash(entry.source) : undefined;
    rawEntries.push({ path: entry.path, source: entry.source, hash });
  }

  ctx.externalPackageDirs = collected.packageDirs;
  // The earlier registration points both run before this assignment, so
  // external dirs must register here or they are never watched.
  ctx.registerSystemWatchPaths();

  const packageFileCount = rawEntries.length - localFileCount;
  ctx.log(
    `Discovered ${rawEntries.length} files (${packageFileCount} from packages) (${Math.round(performance.now() - t0)}ms)`
  );

  t0 = performance.now();
  await ctx.analyzeIngested({
    rawEntries,
    // Seed before the parse and analysis gates: a failed non-strict
    // buildStart must leave HMR the full corpus, not one assembled from the
    // first edit.
    afterIngestion: (accepted) => {
      if (!ctx.isProd) {
        ctx.mutateFileCache((cache) => {
          cache.clear();
          for (const entry of accepted.originalEntries) {
            cache.set(entry.path, { hash: entry.hash, source: entry.source });
          }
        });
      }
    },
  });

  // Vite's CSS pipeline resolves `__VITE_ASSET__` markers to hashed names
  // before the stylesheet is hashed, so the CSS hash reflects the final URL.
  const assetSpecifiers = ctx.sheetAssetSpecifiers();
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
  ctx.substituteSheets();
  // From here on, runAnalysis owns late-appearing specifiers (dev resets).
  ctx.assetPassComplete = true;

  if (ctx.storedManifest) {
    const report = ctx.storedManifest.report;
    ctx.log(
      `Extracted ${report.components_extracted}/${report.components_total} components (${Math.round(performance.now() - t0)}ms)`
    );
    ctx.log(
      `Reconciliation: ${report.components_extracted} kept, ${report.variants_eliminated} variants pruned, ${report.states_eliminated} states pruned`
    );

    for (const d of report.eliminated_details) {
      if (d.kind === 'component') {
        ctx.warn(`⚠ ${d.component} eliminated: ${d.reason}`);
      } else if (d.kind === 'prospective_component' && !ctx.emissionProd) {
        // A production build reports prospective entries only while a skipped
        // source holds pruning off, so this build keeps the component.
        ctx.warn(
          `⚠ ${d.component} would be eliminated in production: ${d.reason}`
        );
      } else if (d.kind === 'variant') {
        ctx.trace(`${d.component} variant '${d.name}' pruned: ${d.reason}`);
      } else if (d.kind === 'state') {
        ctx.trace(`${d.component} state '${d.name}' pruned: ${d.reason}`);
      }
    }

    ctx.log(
      `CSS: ${ctx.resolvedComponentCss.length} bytes (${Object.keys(ctx.storedManifest.components).length} components)`
    );

    if (!ctx.isProd && ctx.storedSheets) {
      const staticCss = assembleStylesheet({
        layers: ctx.options.layers,
        variableCss: ctx.variableCss,
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
