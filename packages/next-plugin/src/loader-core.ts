import { contentHash } from '@animus-ui/extract/pipeline';
import { ANIMUS_CSS_MODULE_ID } from '@animus-ui/extract/session';

import type { ProjectManifest } from '@animus-ui/extract/pipeline';

export interface LoaderPolicyOptions {
  strict?: boolean;
  cssImportTarget?: string;
}

export interface LoaderContextBase<
  O extends LoaderPolicyOptions = LoaderPolicyOptions,
> {
  resourcePath: string;
  rootContext: string;
  getOptions: () => O;
  addDependency?: (file: string) => void;
}

/** Matches every already-emitted stylesheet import — arbitrary relative
 *  prefixes and the Vite emitter's virtual id — not this bundler's id.
 *  Never derive it from the shared module-id constant: this reads foreign
 *  output, and deriving it silently stops matching the other forms. */
const CSS_IMPORT_RE =
  /import\s+['"](?:[^'"]*\.animus\/styles\.css|virtual:animus\/styles\.css)['"];\n?/g;

const CSS_IMPORT_STATEMENT = `import '${ANIMUS_CSS_MODULE_ID}';\n`;

const ROOT_ENTRY_RE = /^(src\/)?(?:app\/layout|pages\/_app)\.[tj]sx?$/;

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.\//, '');
}

function isCssImportTarget(
  filename: string,
  cssImportTarget: string | undefined
): boolean {
  const normalized = normalizePath(filename);
  if (cssImportTarget) {
    return normalized === normalizePath(cssImportTarget);
  }
  return ROOT_ENTRY_RE.test(normalized);
}

type ExtensionProvenance = Pick<ProjectManifest, 'components' | 'files'>;

/** Each file's transitive cross-file ancestors, built once per published
 *  manifest: loaders ask for every module. */
let ancestry: { json: string; byFile: Map<string, string[]> } | null = null;

function indexAncestry(manifestJson: string): Map<string, string[]> {
  // SAFETY: the engine's own manifest; only `components` and `files` are
  // read, and a missing entry below is a genuine miss.
  const { components = {}, files = {} } = JSON.parse(
    manifestJson
  ) as Partial<ExtensionProvenance>;
  const byFile = new Map<string, string[]>();
  for (const [filename, ids] of Object.entries(files)) {
    const ancestors = new Set<string>();
    const queue = [...ids];
    const seen = new Set(queue);
    for (let i = 0; i < queue.length; i++) {
      const parentId = components[queue[i]]?.extends_from;
      if (!parentId || seen.has(parentId)) continue;
      seen.add(parentId);
      queue.push(parentId);
      const parentFile = components[parentId]?.file;
      if (parentFile && parentFile !== filename) ancestors.add(parentFile);
    }
    if (ancestors.size > 0) byFile.set(filename, [...ancestors].sort());
  }
  return byFile;
}

/**
 * The other files declaring a component that one of `filename`'s components
 * extends, transitively. An extension captures its parent's callables when
 * its module evaluates, so it must re-evaluate whenever one of these does.
 */
export function extendedFiles(
  manifestJson: string,
  filename: string
): readonly string[] {
  if (ancestry?.json !== manifestJson) {
    ancestry = { json: manifestJson, byFile: indexAncestry(manifestJson) };
  }
  return ancestry.byFile.get(filename) ?? [];
}

/**
 * Emitted code that changes whenever an extended file's analyzed source does,
 * so a host re-delivers the extension in the same update as its parent.
 * Hosts keep an unchanged module out of a hot update, and Turbopack ignores
 * comment-only differences, so this must be a statement.
 */
export function extensionLineage(
  files: readonly string[],
  analyzedHashes: ReadonlyMap<string, string> | null | undefined
): string {
  if (files.length === 0) return '';
  const lineage = files
    .map((file) => `${file}\0${analyzedHashes?.get(file) ?? ''}`)
    .join('\0');
  return `\nvoid "animus-lineage:${contentHash(lineage)}";\n`;
}

export function transformWithManifest(args: {
  source: string;
  /** Project-root-relative path of the file being transformed. */
  filename: string;
  manifestJson: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engineApi: () => any;
  opts: LoaderPolicyOptions;
}): string {
  const { source, filename, manifestJson, engineApi, opts } = args;
  const isRootEntry = isCssImportTarget(filename, opts.cssImportTarget);

  try {
    const { transformFile } = engineApi();

    const result = transformFile(source, filename, manifestJson);

    let code = result.hasComponents ? result.code : source;

    code = code.replace(CSS_IMPORT_RE, '');

    if (isRootEntry && !code.includes(ANIMUS_CSS_MODULE_ID)) {
      if (code.startsWith("'use client'") || code.startsWith('"use client"')) {
        const nl = code.indexOf('\n');
        if (nl === -1) {
          code = `${code}\n${CSS_IMPORT_STATEMENT}`;
        } else {
          code = `${code.slice(0, nl + 1)}${CSS_IMPORT_STATEMENT}${code.slice(nl + 1)}`;
        }
      } else {
        code = `${CSS_IMPORT_STATEMENT}${code}`;
      }
    }

    return code;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);

    if (opts.strict) {
      throw new Error(
        `[animus-extract] Transform failed for ${filename}: ${msg}`,
        { cause: e }
      );
    }

    console.warn(`[animus-extract] Transform failed for ${filename}:`, msg);
    return source;
  }
}
