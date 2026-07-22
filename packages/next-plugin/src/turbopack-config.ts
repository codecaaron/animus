import { existsSync } from 'fs';
import { relative, resolve as resolvePath } from 'path';

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

/** The single glob the Animus loader registers under. */
export const ANIMUS_TURBOPACK_RULE_GLOB = '*.{ts,tsx,js,jsx}';

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

/**
 * Build the `turbopack` config fragment: one glob-keyed loader rule
 * (file-level allowlisting lives in the loader via manifest lookup — Next 15
 * rules have no condition algebra) plus resolve aliases for the virtual
 * system-props id, the emitter's stylesheet id, and each collected external
 * package specifier redirected to its source entry.
 */
export function buildTurbopackConfig(args: {
  rootDir: string;
  loaderPath: string;
  options: AnimusNextOptions;
  externalSourceEntries: ReadonlyMap<string, string>;
}): TurbopackConfigFragment {
  const { rootDir, loaderPath, options, externalSourceEntries } = args;

  const loaderOptions: Record<string, unknown> = {
    rootDir,
    ...(options.strict !== undefined ? { strict: options.strict } : {}),
    ...(options.cssImportTarget !== undefined
      ? { cssImportTarget: options.cssImportTarget }
      : {}),
  };

  const resolveAlias: Record<string, string> = {
    [TURBOPACK_SYSTEM_PROPS_ID]: './.animus/system-props.js',
    '.animus/styles.css': './.animus/styles.css',
  };
  for (const [specifier, srcEntry] of externalSourceEntries) {
    // Alias values are module requests — always forward slashes, even when
    // path.relative produced Windows separators.
    resolveAlias[specifier] =
      `./${relative(rootDir, srcEntry).replace(/\\/g, '/')}`;
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
  for (const candidate of ['turbopack-loader.cjs', 'turbopack-loader.mjs']) {
    const distPath = resolvePath(pluginDir, candidate);
    if (existsSync(distPath)) return distPath;
  }
  return resolvePath(pluginDir, 'turbopack-loader.ts');
}
