import { ENGINE_TRANSFORM_EXTENSIONS } from '@animus-ui/extract/pipeline';
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
}): TurbopackConfigFragment {
  const {
    rootDir,
    loaderPath,
    options,
    externalSourceEntries,
    sessionId,
    sessionDir,
  } = args;

  const loaderOptions: TurbopackLoaderOptions = {
    rootDir,
    sessionId,
    sessionDir,
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

export function resolveTurbopackLoaderPath(pluginDir: string): string {
  return resolveLoaderPath(
    pluginDir,
    ['turbopack-loader.cjs', 'turbopack-loader.mjs'],
    'turbopack-loader.ts'
  );
}
