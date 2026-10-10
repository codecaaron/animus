import {
  ENGINE_TRANSFORM_EXTENSIONS,
  fileSideEffects,
  findPackageRoot,
  kitSourceModuleSideEffects,
} from '@animus-ui/extract/pipeline';
import {
  ANIMUS_CSS_MODULE_ID,
  STYLES_ARTIFACT,
  SYSTEM_PROPS_ARTIFACT,
  TURBOPACK_SYSTEM_PROPS_ID,
} from '@animus-ui/extract/session';
import { join, relative } from 'path';

import { resolveLoaderPath } from './loader-path';

import type { TurbopackLoaderOptions } from './turbopack-loader';
import type { AnimusNextOptions } from './types';

/** Everything emitted here must be JSON-serializable: Turbopack forwards
 *  loader options across process boundaries and rejects live values. */

export type TurbopackMode = 'off' | 'auto' | 'on';

export interface TurbopackRule {
  loaders: Array<{ loader: string; options: TurbopackLoaderOptions }>;
}

export interface TurbopackConfigFragment {
  rules: Record<string, TurbopackRule>;
  resolveAlias: Record<string, string>;
}

/** The one glob the loader registers under, derived from the shared engine
 *  extension set so the bundler families cannot drift. `.mjs` belongs in that
 *  set: an external package with no src/ is ingested through its dist entry
 *  and must still reach the loader, so do not trim it. */
export const ANIMUS_TURBOPACK_RULE_GLOB = `*.{${ENGINE_TRANSFORM_EXTENSIONS.join(',')}}`;

export { TURBOPACK_SYSTEM_PROPS_ID };

export function resolveTurbopackMode(
  options: AnimusNextOptions,
  env: Record<string, string | undefined> = process.env
): boolean {
  const mode: TurbopackMode =
    options.turbopack?.mode ?? options.unstable_turbopack?.mode ?? 'auto';
  if (mode === 'on') return true;
  if (mode === 'auto') return env.TURBOPACK !== undefined;
  return false;
}

/** Development under Turbopack: the dev watcher runs, and loaders may wait
 *  for and re-deliver its generations. */
export function isTurbopackDevelopment(
  env: Record<string, string | undefined> = process.env
): boolean {
  return env.NODE_ENV === 'development';
}

function rootRelativeRequest(rootDir: string, absPath: string): string {
  return `./${relative(rootDir, absPath).replace(/\\/g, '/')}`;
}

export function buildTurbopackConfig(args: {
  rootDir: string;
  loaderPath: string;
  options: AnimusNextOptions;
  externalSourceEntries: ReadonlyMap<string, string>;
  sessionId: string;
  sessionDir: string;
  development: boolean;
}): TurbopackConfigFragment {
  const {
    rootDir,
    loaderPath,
    options,
    externalSourceEntries,
    sessionId,
    sessionDir,
    development,
  } = args;

  const loaderOptions: TurbopackLoaderOptions = {
    rootDir,
    sessionId,
    sessionDir,
    development,
  };
  if (options.strict !== undefined) loaderOptions.strict = options.strict;
  if (options.cssImportTarget !== undefined) {
    loaderOptions.cssImportTarget = options.cssImportTarget;
  }

  const resolveAlias: TurbopackConfigFragment['resolveAlias'] = {
    [TURBOPACK_SYSTEM_PROPS_ID]: rootRelativeRequest(
      rootDir,
      join(sessionDir, SYSTEM_PROPS_ARTIFACT)
    ),
    [ANIMUS_CSS_MODULE_ID]: rootRelativeRequest(
      rootDir,
      join(sessionDir, STYLES_ARTIFACT)
    ),
  };
  for (const [specifier, srcEntry] of externalSourceEntries) {
    resolveAlias[specifier] = rootRelativeRequest(rootDir, srcEntry);
  }

  return {
    rules: {
      [ANIMUS_TURBOPACK_RULE_GLOB]: {
        loaders: [{ loader: loaderPath, options: loaderOptions }],
      },
    },
    resolveAlias,
  };
}

/**
 * Turbopack aliases a kit entry to its source with no per-module setting, so
 * it reads the package's `sideEffects` against the source file's own path.
 * One line for each redirect whose source that reading classifies otherwise
 * than the entry it replaces, and one for each kit whose list names shipped
 * code, which Turbopack reads against every source module the redirects
 * reach: Turbopack cannot represent the declaration.
 */
export function turbopackSideEffectsLimits(
  rootDir: string,
  externalSourceEntries: ReadonlyMap<string, string>,
  externalSourceSideEffects: ReadonlyMap<string, boolean>
): string[] {
  const kits = new Set(
    [...externalSourceEntries.values()]
      .filter((srcEntry) => kitSourceModuleSideEffects(srcEntry) === true)
      .map(findPackageRoot)
  );
  const modules = [...kits].map(
    (pkgRoot) =>
      `[animus-extract] Turbopack cannot keep the source modules of ${relative(rootDir, pkgRoot).replace(/\\/g, '/')} side-effectful: the package's "sideEffects" list names shipped code, and Turbopack reads that list against each source module, so it can drop a listed effect of a module the source imports. List the source modules in "sideEffects" too, or build with webpack.`
  );
  const entries = [...externalSourceEntries].flatMap(
    ([specifier, srcEntry]) => {
      const declared = externalSourceSideEffects.get(specifier);
      if (declared === undefined) return [];
      const read = fileSideEffects(srcEntry) ?? true;
      if (read === declared) return [];
      const source = relative(rootDir, srcEntry).replace(/\\/g, '/');
      const consequence = declared
        ? 'Turbopack can drop its side effects'
        : 'Turbopack keeps it when it is unused';
      return [
        `[animus-extract] Turbopack cannot carry the "sideEffects" of ${specifier} to its source ${source}: the package's "sideEffects" classify the shipped entry as ${declared ? 'side-effectful' : 'free of side effects'} but the source as ${read ? 'side-effectful' : 'free of side effects'}, so ${consequence}. Make the package's "sideEffects" classify the source as it classifies the shipped entry, or build with webpack.`,
      ];
    }
  );
  return [...entries, ...modules];
}

export function resolveTurbopackLoaderPath(pluginDir: string): string {
  return resolveLoaderPath(
    pluginDir,
    ['turbopack-loader.cjs', 'turbopack-loader.mjs'],
    'turbopack-loader.ts'
  );
}
