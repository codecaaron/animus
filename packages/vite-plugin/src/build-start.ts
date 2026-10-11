import {
  assembleStylesheet,
  clearEngineCache,
  createExcludeMatcher,
  DEFAULT_EXTENSIONS,
  validateLayerOrder,
} from '@animus-ui/extract/pipeline';
import { readFileSync } from 'fs';
import { basename, dirname } from 'path';

import { sweepAbandonedCopyDirs } from './asset-copy-dirs';

import type { PluginContext } from './context';

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

  const t0 = performance.now();

  if (ctx.options.layers) {
    validateLayerOrder(ctx.options.layers);
    ctx.log(`Custom layers: [${ctx.options.layers.join(', ')}]`);
  }

  // One matcher per buildStart, which the hot path's classification reads.
  // Refreshed in case `options` was mutated between server lifecycles.
  ctx.excludeMatcher = createExcludeMatcher(
    ctx.options.exclude,
    ctx.outputExclude === null ? [] : [ctx.outputExclude]
  );
  ctx.extensionsSet = new Set(ctx.options.extensions ?? DEFAULT_EXTENSIONS);

  // System load, discovery, package collection and analysis are the
  // Session's; Vite serves its publication and substitutes asset URLs.
  const session = ctx.session ?? ctx.createSession();
  session.hostResolve = resolveSpecifier;
  session.hostSubstitutesAssets = true;
  try {
    await session.runFullPipeline();
  } catch (error) {
    // A dev server starts through an aborted parse: it serves no component
    // CSS until an edit repairs the source. A build fails on it.
    if (ctx.isProd || ctx.sessionOutcome?.kind !== 'held') throw error;
    ctx.warn(error instanceof Error ? error.message : String(error));
  }
  ctx.adoptPublication(session);
  // Until the hot path moves onto the Session, it reads the sources the
  // Session holds.
  if (!ctx.isProd) {
    ctx.mutateFileCache((cache) => {
      cache.clear();
      for (const [path, entry] of session.publishedSources) {
        cache.set(path, { hash: entry.hash, source: entry.source });
      }
    });
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

  // Vite's CSS pipeline resolves `__VITE_ASSET__` markers to hashed names
  // before the stylesheet is hashed, so the CSS hash reflects the final URL.
  const assetSpecifiers = ctx.sheetAssetSpecifiers();
  ctx.assetSourceBySpecifier.clear();
  if (ctx.assetCopyDir !== null)
    sweepAbandonedCopyDirs(dirname(ctx.assetCopyDir));
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
