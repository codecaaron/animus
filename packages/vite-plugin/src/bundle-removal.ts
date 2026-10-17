import {
  contentHash,
  noteKept,
  outputEvidence,
  removeComponentRules,
  shippedClasses,
  unbundledComponents,
} from '@animus-ui/extract/pipeline';
import { posix } from 'node:path';

import { replaceInOrder, sliceIdOf } from './index-html';

import type { PluginContext } from './context';
import type { KeptRuleReason, RuleRemoval } from '@animus-ui/extract/pipeline';
import type { Rolldown } from 'vite';

/** What a build that removes unbundled components does to its slices. */
export interface BundleRemoval {
  /** Emits `file` without the removed components' rules, beside it under a
   *  name its new content hashes, and returns that name; `null` keeps it. */
  replace(file: Rolldown.OutputAsset): string | null;
  /** Points Vite's manifests and chunk metadata at each replacement where
   *  they named the file replaced, then reports. */
  finish(): void;
}

/**
 * The removal of every component no output file of this client build
 * includes, or `null` where the build keeps every component: it bundles
 * another environment beside the client (`otherEnvironments`), whose output
 * may render what the client's does not; it leaves a module external; it
 * carries data the scan cannot read as text; or an output file other than
 * Vite's `manifests` names a stylesheet slice, which a replacement would
 * leave naming a deleted file. Every output file but the slices
 * (`sliceIds`) and media is evidence, data URLs decoded.
 */
export function bundleRemoval(
  ctx: PluginContext,
  bundle: Rolldown.OutputBundle,
  sliceIds: readonly string[],
  context: {
    otherEnvironments: readonly string[];
    manifests: ReadonlySet<string>;
    emit: (asset: Rolldown.EmittedAsset) => void;
  }
): BundleRemoval | null {
  const manifest = ctx.storedManifest;
  if (!manifest) return null;
  const keep = (why: string) => {
    ctx.info(`kept every component's CSS: ${why}`);
    return null;
  };
  const blocker = removalBlocker(bundle, context.otherEnvironments);
  if (blocker !== null) return keep(blocker);
  const slices = new Set(
    Object.values(bundle)
      .filter((file) => sliceIdOf(file, sliceIds) !== undefined)
      .map((file) => file.fileName)
  );
  const { texts, unreadable } = outputEvidence(
    Object.values(bundle).map((file) =>
      file.type === 'chunk'
        ? { fileName: file.fileName, code: file.code }
        : { fileName: file.fileName, bytes: Buffer.from(file.source) }
    ),
    slices
  );
  if (unreadable !== null) {
    return keep(
      `${unreadable} holds data the scan cannot read as text, which may name a class`
    );
  }
  // A replaced slice is relinked from pages and Vite's manifests only, and a
  // manifest only where it names the slice's whole file name.
  for (const { fileName, text } of texts) {
    for (const slice of slices) {
      const named = occurrences(text, posix.basename(slice));
      const relinked = context.manifests.has(fileName)
        ? occurrences(text, JSON.stringify(slice).slice(1, -1))
        : 0;
      if (named > relinked) {
        return keep(
          `${fileName} names ${slice}, which a replacement would leave it naming`
        );
      }
    }
  }
  const components = manifest.components;
  const removed = unbundledComponents(
    components,
    shippedClasses(
      texts.map(({ text }) => text),
      Object.values(components).map((component) => component.class_name)
    ),
    new Set(Object.keys(ctx.options.staticCss?.components ?? {}))
  );
  const classes = new Set(removed.values());
  let characters = 0;
  const renamed = new Map<string, string>();
  // A component counts as removed once one of its rules went; one a kept
  // rule names, or one in a file removal leaves whole, is kept whole.
  const went = new Set<string>();
  const kept = new Map<string, KeptRuleReason>();
  const wholeFiles = new Set<string>();
  const keepFile = (css: string) => {
    for (const name of classes) {
      if (css.includes(name)) wholeFiles.add(name);
    }
    return null;
  };
  return {
    replace(file) {
      const css = Buffer.from(file.source).toString('utf8');
      let removal: RuleRemoval;
      try {
        removal = removeComponentRules(css, classes);
      } catch (error) {
        ctx.warn(
          `[animus-extract] removeUnbundledComponents kept ${file.fileName} whole: Lightning CSS could not read it (${error instanceof Error ? error.message : String(error)})`
        );
        return keepFile(css);
      }
      if (removal.refused !== null) {
        ctx.info(`kept ${file.fileName} whole: ${removal.refused}`);
        return keepFile(css);
      }
      for (const name of removal.went) went.add(name);
      for (const [name, reason] of removal.kept) noteKept(kept, name, reason);
      const { css: pruned } = removal;
      if (pruned === null) return null;
      characters += css.length - pruned.length;
      // Beside the file it replaces, so each relative url() still resolves,
      // whatever an `assetFileNames` callback would choose.
      const extension = posix.extname(file.fileName);
      const fileName = `${file.fileName.slice(0, -extension.length)}-${contentHash(pruned).slice(0, 8)}${extension}`;
      context.emit({
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
        const imported = file.viteMetadata?.importedCss;
        if (imported && renamed.size > 0) {
          replaceInOrder(imported, (css) => [renamed.get(css) ?? css]);
        }
        if (file.type !== 'asset' || !context.manifests.has(file.fileName)) {
          continue;
        }
        let text = Buffer.from(file.source).toString('utf8');
        for (const [before, after] of renamed) {
          text = text.replaceAll(
            JSON.stringify(before).slice(1, -1),
            JSON.stringify(after).slice(1, -1)
          );
        }
        file.source = text;
      }
      let count = 0;
      let ruleless = 0;
      const whole = new Map<KeptReason, number>();
      for (const [id, className] of removed) {
        const reason: KeptReason | undefined =
          kept.get(className) ??
          (wholeFiles.has(className) ? 'whole-file' : undefined);
        if (went.has(className)) {
          count += 1;
          ctx.trace(`removed ${id} (${className}): no output file includes it`);
        } else if (reason === undefined) {
          ruleless += 1;
          ctx.trace(
            `${id} (${className}): no output file includes it, and no rule names it`
          );
        } else {
          whole.set(reason, (whole.get(reason) ?? 0) + 1);
          ctx.trace(
            `kept ${id} (${className}) whole, though no output file includes it: ${KEPT_WHOLE[reason]}`
          );
        }
      }
      const keptWhole = [...whole]
        .map(([reason, n]) => `${KEPT_WHOLE[reason]}: ${n}`)
        .join(', ');
      const wholeCount = [...whole.values()].reduce((sum, n) => sum + n, 0);
      ctx.info(
        `removed the CSS of ${count} of ${Object.keys(components).length} components no output file includes (${characters} characters of the stylesheet)${wholeCount > 0 ? `; kept ${wholeCount} more whole (${keptWhole})` : ''}${ruleless > 0 ? `; with no rules to remove: ${ruleless}` : ''}`
      );
    },
  };
}

/** Why the rules of a component no output file includes all stayed. */
type KeptReason = KeptRuleReason | 'whole-file';

/** Each reason, as the trace and the build's report print it. */
const KEPT_WHOLE = {
  'shared-list': 'shares a selector list with a kept component',
  nested: 'a rule naming it holds nested rules removal cannot prove unused',
  conditional:
    'named only where a selector can match without it, or in a pseudo-class argument removal does not read, such as :not(), :has(), :host(), or an :is() or :where() with an alternative that does not need it',
  'whole-file': 'in a stylesheet removal kept whole',
} satisfies Record<KeptReason, string>;

/** How many times `needle` occurs in `text`. */
function occurrences(text: string, needle: string): number {
  let count = 0;
  for (
    let at = text.indexOf(needle);
    at !== -1;
    at = text.indexOf(needle, at + 1)
  ) {
    count += 1;
  }
  return count;
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
