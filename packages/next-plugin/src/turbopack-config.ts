import { join, relative } from 'path';

import { resolveLoaderPath } from './loader-path';
import { STYLES_ARTIFACT, SYSTEM_PROPS_ARTIFACT } from './session-paths';

import type { AnimusNextOptions } from './types';

/**
 * Turbopack config fragment generation (spec: next-turbopack-integration).
 * Everything emitted here MUST be JSON-serializable — Turbopack forwards
 * loader options across process boundaries and rejects live values.
 */

export type TurbopackMode = 'off' | 'auto' | 'on';

export interface TurbopackRule {
  loaders: Array<{ loader: string; options: Record<string, unknown> }>;
}

export interface TurbopackConfigFragment {
  rules: Record<string, TurbopackRule>;
  resolveAlias: Record<string, string>;
}

/** The single glob the Animus loader registers under. `.mjs` is included
 *  for webpack parity: an external package without `src/` is ingested via
 *  its resolved dist entry (often `dist/index.mjs`) and must still reach
 *  the loader — manifest lookup remains the file-level gate. */
export const ANIMUS_TURBOPACK_RULE_GLOB = '*.{ts,tsx,js,jsx,mjs}';

/** Virtual system-props id emitted into transformed sources under Turbopack
 *  (absolute-path imports are rejected there); resolveAlias maps it to the
 *  on-disk artifact. */
export const TURBOPACK_SYSTEM_PROPS_ID = 'virtual:animus/system-props';

/**
 * Resolve whether Turbopack wiring is active for this process. Default is
 * `'auto'`: active exactly when the TURBOPACK environment variable is set
 * (Next sets it for every Turbopack dev/build). The stable `turbopack`
 * option wins over the deprecated `unstable_turbopack` alias.
 */
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

/** rootDir-relative module request for an absolute path — always forward
 *  slashes, even when path.relative produced Windows separators. */
function rootRelativeRequest(rootDir: string, absPath: string): string {
  return `./${relative(rootDir, absPath).replace(/\\/g, '/')}`;
}

/**
 * Build the `turbopack` config fragment: one glob-keyed loader rule
 * (file-level allowlisting lives in the loader via manifest lookup — Next 15
 * rules have no condition algebra) plus resolve aliases for the virtual
 * system-props id, the emitter's stylesheet id, and each collected external
 * package specifier redirected to its source entry. Loader options carry
 * the session identity (design D2: an options-borne, JSON-serializable
 * Turbopack task input — restart-cold by construction), and the artifact
 * aliases point into the session-scoped tree.
 */
export function buildTurbopackConfig(args: {
  rootDir: string;
  loaderPath: string;
  options: AnimusNextOptions;
  externalSourceEntries: ReadonlyMap<string, string>;
  sessionId: string;
  sessionDir: string;
}): TurbopackConfigFragment {
  const {
    rootDir,
    loaderPath,
    options,
    externalSourceEntries,
    sessionId,
    sessionDir,
  } = args;

  const loaderOptions: Record<string, unknown> = {
    rootDir,
    sessionId,
    sessionDir,
    ...(options.strict !== undefined ? { strict: options.strict } : {}),
    ...(options.cssImportTarget !== undefined
      ? { cssImportTarget: options.cssImportTarget }
      : {}),
  };

  const resolveAlias: Record<string, string> = {
    [TURBOPACK_SYSTEM_PROPS_ID]: rootRelativeRequest(
      rootDir,
      join(sessionDir, SYSTEM_PROPS_ARTIFACT)
    ),
    '.animus/styles.css': rootRelativeRequest(
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
 * Locate the Turbopack loader module: built dist first, source fallback for
 * in-repo development. CJS preferred — Turbopack's loader-runner follows
 * the webpack loader contract (`module.exports = fn`), and the .cjs build
 * is loadable by every runner version; ESM default-export acceptance is
 * not guaranteed.
 */
export function resolveTurbopackLoaderPath(pluginDir: string): string {
  return resolveLoaderPath(
    pluginDir,
    ['turbopack-loader.cjs', 'turbopack-loader.mjs'],
    'turbopack-loader.ts'
  );
}
