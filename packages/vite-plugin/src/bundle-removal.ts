import {
  outputEvidence,
  removeComponentRules,
  shippedClasses,
  unbundledComponents,
} from '@animus-ui/extract/pipeline';
import { createHash } from 'node:crypto';
import { posix } from 'node:path';

import { sliceIdOf } from './index-html';

import type { PluginContext } from './context';
import type { Rolldown } from 'vite';

/** What a build that removes unbundled components does to its slices. */
export interface BundleRemoval {
  /** Emits `file` without the removed components' rules, beside it under a
   *  name its new content hashes, and returns that name; `null` keeps it. */
  replace(
    file: Rolldown.OutputAsset,
    emit: (asset: Rolldown.EmittedAsset) => void
  ): string | null;
  /** Points every JSON file of the output (Vite's manifests) at each
   *  replacement where it named the file replaced, then reports. */
  finish(): void;
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
  const slices = Object.values(bundle).filter(
    (file) => sliceIdOf(file, sliceIds) !== undefined
  );
  // A replaced slice is relinked from pages and JSON manifests only.
  const naming = Object.values(bundle).find(
    (file) =>
      !slices.includes(file) &&
      !file.fileName.endsWith('.json') &&
      slices.some((slice) =>
        (file.type === 'chunk'
          ? file.code
          : Buffer.from(file.source).toString('utf8')
        ).includes(posix.basename(slice.fileName))
      )
  );
  if (naming !== undefined) {
    ctx.info(
      `kept every component's CSS: ${naming.fileName} names a stylesheet file, which a replacement would leave it naming`
    );
    return null;
  }
  const { texts, unreadable } = outputEvidence(
    Object.values(bundle).map((file) =>
      file.type === 'chunk'
        ? { fileName: file.fileName, code: file.code }
        : { fileName: file.fileName, bytes: Buffer.from(file.source) }
    ),
    new Set(slices.map((file) => file.fileName))
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
  const renamed = new Map<string, string>();
  return {
    replace(file, emit) {
      const css = Buffer.from(file.source).toString('utf8');
      let pruned: string | null;
      try {
        pruned = removeComponentRules(css, classes, {
          targets: ctx.lcssTargets,
          keepDirSelector: ctx.options.keepDirSelector,
        });
      } catch (error) {
        ctx.warn(
          `[animus-extract] removeUnbundledComponents kept ${file.fileName} whole: Lightning CSS could not read it (${error instanceof Error ? error.message : String(error)})`
        );
        return null;
      }
      if (pruned === null) return null;
      bytes += css.length - pruned.length;
      // Beside the file it replaces, so each relative url() still resolves,
      // whatever an `assetFileNames` callback would choose.
      const fileName = siblingFileName(file.fileName, pruned);
      emit({
        type: 'asset',
        fileName,
        name: file.names[0],
        originalFileName: file.originalFileNames[0],
        source: pruned,
      });
      renamed.set(file.fileName, fileName);
      return fileName;
    },
    finish() {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.json')) continue;
        const text = Buffer.from(file.source).toString('utf8');
        let relinked = text;
        for (const [before, after] of renamed) {
          relinked = relinked
            .split(JSON.stringify(before).slice(1, -1))
            .join(JSON.stringify(after).slice(1, -1));
        }
        if (relinked !== text) file.source = relinked;
      }
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

/** `fileName`'s directory and name, followed by a hash of `source`. */
function siblingFileName(fileName: string, source: string): string {
  const extension = posix.extname(fileName);
  const hash = createHash('sha256')
    .update(source)
    .digest('base64url')
    .slice(0, 8);
  return `${fileName.slice(0, fileName.length - extension.length)}-${hash}${extension}`;
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
