import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * The one loader-path derivation: first existing dist candidate under the
 * plugin dir, else the in-repo source fallback. Both loader resolvers below
 * are thin wrappers, so rule registration and any loader-chain predicate
 * can never drift (openspec: next-webpack-served-transform-coherence,
 * design D1).
 */
export function resolveLoaderPath(
  pluginDir: string,
  distCandidates: string[],
  sourceFallback: string
): string {
  for (const candidate of distCandidates) {
    const distPath = resolve(pluginDir, candidate);
    if (existsSync(distPath)) return distPath;
  }
  return resolve(pluginDir, sourceFallback);
}

/**
 * This package's webpack loader path, shared by the rule registration
 * (with-animus) and the needBuild loader-chain predicate (plugin). Compiled
 * dist ships `loader.mjs` next to this module; running from source falls
 * back to the TypeScript loader.
 */
export function resolveAnimusLoaderPath(): string {
  return resolveLoaderPath(__dirname, ['loader.mjs'], 'loader.ts');
}
