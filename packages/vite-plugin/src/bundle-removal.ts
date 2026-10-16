import {
  outputEvidence,
  removeComponentRules,
  shippedClasses,
  unbundledComponents,
} from '@animus-ui/extract/pipeline';

import { sliceIdOf } from './index-html';

import type { PluginContext } from './context';
import type { Rolldown } from 'vite';

/** What a build that removes unbundled components does to its slices. */
export interface BundleRemoval {
  /** A slice's CSS without the removed components' rules; `null` keeps it. */
  rewrite(css: string, fileName: string): string | null;
  /** Reports what the rewrites removed. */
  report(): void;
}

/**
 * The removal of every component no output file of this client build
 * includes, or `null` where the build keeps every component: it bundles
 * another environment beside the client (`otherEnvironments`), whose output
 * may render what the client's does not, leaves a module external, or
 * carries data the scan cannot read as text. Every output file but the
 * stylesheet's slices (`sliceIds`) and media is evidence, data URLs
 * decoded.
 */
export function bundleRemoval(
  ctx: PluginContext,
  bundle: Rolldown.OutputBundle,
  sliceIds: readonly string[],
  otherEnvironments: readonly string[]
): BundleRemoval | null {
  const manifest = ctx.storedManifest;
  if (!manifest) return null;
  const blocker = removalBlocker(bundle, otherEnvironments);
  if (blocker !== null) {
    ctx.info(`kept every component's CSS: ${blocker}`);
    return null;
  }
  const { texts, unreadable } = outputEvidence(
    Object.values(bundle).map((file) =>
      file.type === 'chunk'
        ? { fileName: file.fileName, code: file.code }
        : { fileName: file.fileName, bytes: Buffer.from(file.source) }
    ),
    new Set(
      Object.values(bundle)
        .filter((file) => sliceIdOf(file, sliceIds) !== undefined)
        .map((file) => file.fileName)
    )
  );
  if (unreadable !== null) {
    ctx.info(
      `kept every component's CSS: ${unreadable} holds data the scan cannot read as text, which may name a class`
    );
    return null;
  }
  const components = manifest.components;
  const removed = unbundledComponents(
    components,
    shippedClasses(
      texts,
      Object.values(components).map((component) => component.class_name)
    ),
    new Set(Object.keys(ctx.options.staticCss?.components ?? {}))
  );
  const classes = new Set(removed.values());
  let bytes = 0;
  return {
    rewrite(css, fileName) {
      let pruned: string | null;
      try {
        pruned = removeComponentRules(css, classes, {
          targets: ctx.lcssTargets,
          keepDirSelector: ctx.options.keepDirSelector,
        });
      } catch (error) {
        ctx.warn(
          `[animus-extract] removeUnbundledComponents kept ${fileName} whole: Lightning CSS could not read it (${error instanceof Error ? error.message : String(error)})`
        );
        return null;
      }
      if (pruned !== null) bytes += css.length - pruned.length;
      return pruned;
    },
    report() {
      if (ctx.tracing) {
        for (const [id, className] of removed) {
          ctx.trace(`removed ${id} (${className}): no output file includes it`);
        }
      }
      ctx.info(
        `removed the CSS of ${removed.size} of ${Object.keys(components).length} components no output file includes (${bytes} bytes of the stylesheet)`
      );
    },
  };
}

/** Why a client build keeps every component, or `null`. */
function removalBlocker(
  bundle: Rolldown.OutputBundle,
  otherEnvironments: readonly string[]
): string | null {
  if (otherEnvironments.length > 0) {
    return `this build also bundles ${otherEnvironments.join(', ')}, whose output may render what the client's does not`;
  }
  // A chunk's import that names no output file is external.
  for (const file of Object.values(bundle)) {
    if (file.type !== 'chunk') continue;
    const external = [...file.imports, ...file.dynamicImports].find(
      (imported) => !(imported in bundle)
    );
    if (external !== undefined) {
      return `the build leaves ${external} external, which may render components no output file includes`;
    }
  }
  return null;
}
