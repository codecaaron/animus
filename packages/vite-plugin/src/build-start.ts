import {
  assembleStylesheet,
  bareSpecifierPackageName,
  clearEngineCache,
  collectExternalPackageSources,
  contentHash,
  createExcludeMatcher,
  declaredWorkspacePackages,
  DEFAULT_EXTENSIONS,
  discoverFiles,
  engineModuleParser,
  extensionPolicyJson,
  extractSystemFilePackages,
  importedKitDiagnostics,
  firstOwners,
  isDeletedSource,
  nativeKitSourceRoot,
  nativePackageLocator,
  outputSourceGuard,
  outputSourceMessage,
  pruneStaleAssets,
  surfaceManifestDiagnostics,
  unmatchedExcludeLines,
  unreadableSourceDiagnostic,
  validateLayerOrder,
} from '@animus-ui/extract/pipeline';
import { readFileSync } from 'fs';
import { basename, relative, resolve } from 'path';

import type { DiscoveredSources, PluginContext } from './context';
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

  // One matcher per buildStart, which a development rediscovery reuses.
  // Refreshed in case `options` was mutated between server lifecycles.
  ctx.excludeMatcher = createExcludeMatcher(
    ctx.options.exclude,
    ctx.outputExclude === null ? [] : [ctx.outputExclude]
  );
  ctx.extensionsSet = new Set(ctx.options.extensions ?? DEFAULT_EXTENSIONS);
  const discovered = await discoverSources(ctx, resolveSpecifier);
  for (const line of unmatchedExcludeLines(ctx.excludeMatcher)) {
    console.error(line);
  }
  // The system's imports and its packages' manifests decide discovery, so a
  // development system reload repeats it. Discovery decides the files; a
  // cached file keeps the source the hot path last read.
  if (!ctx.isProd) {
    ctx.rediscoverSources = async () => {
      const rediscovered = await discoverSources(ctx, resolveSpecifier);
      return {
        ...rediscovered,
        rawEntries: rediscovered.rawEntries.map((entry) => {
          const cached = ctx.fileCache.get(entry.path);
          return cached ? { path: entry.path, ...cached } : entry;
        }),
      };
    };
  }

  t0 = performance.now();
  await ctx.analyzeIngested(discovered);

  // Vite's CSS pipeline resolves `__VITE_ASSET__` markers to hashed names
  // before the stylesheet is hashed, so the CSS hash reflects the final URL.
  const assetSpecifiers = ctx.sheetAssetSpecifiers();
  ctx.currentAssetCopies.clear();
  ctx.assetSourceBySpecifier.clear();
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
      try {
        ctx.assetUrlBySpecifier.set(
          specifier,
          ctx.devAssetUrl(specifier, resolvedPath)
        );
      } catch (err) {
        ctx.assetFallback(
          specifier,
          `[animus-extract] failed to copy asset() specifier ${specifier}: ${String(err)}`,
          err
        );
      }
    }
  }
  // Once per dev server: superseded copies from earlier servers go.
  if (ctx.assetCopyDir !== null) {
    pruneStaleAssets(ctx.assetCopyDir, ctx.currentAssetCopies);
  }
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

/** Local and external discovery, publishing the package state on `ctx`, and
 *  the analysis input it yields. */
async function discoverSources(
  ctx: PluginContext,
  hostResolve: (specifier: string) => Promise<string | null>
): Promise<DiscoveredSources> {
  const t0 = performance.now();
  // A declared workspace nothing links into node_modules is no package to
  // Vite, though the system loader resolves it: where the host finds
  // nothing, discovery asks the loader, as the session does. Vite resolves
  // such a package's imports only through a source-entry redirect, so the
  // collector admits a loader answer only where one exists.
  const workspaces = declaredWorkspacePackages(ctx.rootDir);
  const loaderOnly = new Set<string>();
  const resolveSpecifier = async (
    specifier: string
  ): Promise<string | null> => {
    const hosted = await hostResolve(specifier);
    if (
      hosted !== null ||
      !Object.hasOwn(workspaces, bareSpecifierPackageName(specifier))
    ) {
      return hosted;
    }
    const loaded = ctx
      .engineApi()
      .resolveSpecifier?.(
        specifier,
        ctx.rootDir,
        ctx.resolveConditions,
        workspaces,
        extensionPolicyJson(ctx.extensionPolicy)
      );
    if (loaded?.path) loaderOnly.add(specifier);
    return loaded?.path ?? null;
  };
  const filePaths = discoverFiles(
    ctx.rootDir,
    ctx.rootDir,
    ctx.excludeMatcher,
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
    resolveSpecifier,
    ctx.extensionPolicy
  );
  discoveryDiagnostics.push(
    ...importedKitDiagnostics(
      rawEntries,
      ctx.engineApi(),
      ctx.rootDir,
      packageSpecifiers
    )
  );

  ctx.externalSourceEntries.clear();

  // Shared traversal; resolution and hash policy stay bundler-specific.
  const collected = await collectExternalPackageSources({
    specifiers: packageSpecifiers,
    resolveSpecifier,
    kitSourceRoot: nativeKitSourceRoot(
      ctx.engineApi(),
      ctx.rootDir,
      ctx.resolveConditions,
      workspaces,
      extensionPolicyJson(ctx.extensionPolicy)
    ),
    locatePackage: nativePackageLocator(ctx.engineApi(), workspaces),
    requireSourceEntry: (specifier) => loaderOnly.has(specifier),
    extensions: ctx.extensionPolicy,
    rootDir: ctx.rootDir,
    extensionsSet: ctx.extensionsSet,
    hasEntry: (relPath) => rawEntries.some((entry) => entry.path === relPath),
    hostOutputDirs:
      ctx.outputExclude === null
        ? []
        : [resolve(ctx.rootDir, ctx.outputExclude)],
    onUnreadable: (relPath, err) => {
      if (!isDeletedSource(err)) {
        ingestionFailures.push(unreadableSourceDiagnostic(relPath, err));
      }
    },
  });
  ctx.ingestionFailureDiagnostics = ingestionFailures;
  surfaceManifestDiagnostics(
    {
      diagnostics: [...discoveryDiagnostics, ...collected.diagnostics],
    },
    (message) => ctx.warn(message),
    // An error-severity discovery diagnostic fails a strict build.
    {
      levels: ctx.options.diagnostics,
      strict: ctx.options.strict,
      reportErrors: ctx.reportErrors(),
    }
  );

  ctx.packageMap = collected.packageMap;
  ctx.externalPackageOutcomes = collected.outcomes;
  ctx.kitDescriptors = collected.kitDescriptors;
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
  ctx.externalLinkedDirs = collected.linkedDirs;
  ctx.externalOutputDirs = collected.outputDirs;
  // The earlier registration points both run before this assignment, so
  // external dirs must register here or they are never watched.
  ctx.registerSystemWatchPaths();

  const packageFileCount = rawEntries.length - localFileCount;
  ctx.log(
    `Discovered ${rawEntries.length} files (${packageFileCount} from packages) (${Math.round(performance.now() - t0)}ms)`
  );

  // A file whose real path lies in the output directory is output, under
  // whatever spelling discovery reached it.
  const inOutput = outputSourceGuard(
    ctx.rootDir,
    ctx.outputExclude === null ? [] : [ctx.outputExclude]
  );
  const analysisInputs = rawEntries.filter((entry) => {
    const outputDir = inOutput(resolve(ctx.rootDir, entry.path));
    if (outputDir === null) return true;
    ctx.warn(outputSourceMessage(entry.path, outputDir));
    return false;
  });

  return {
    rawEntries: analysisInputs,
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
  };
}
