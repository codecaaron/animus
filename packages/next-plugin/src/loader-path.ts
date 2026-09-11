import { existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

export function resolveAnimusLoaderPath(): string {
  return resolveLoaderPath(__dirname, ['loader.mjs'], 'loader.ts');
}
