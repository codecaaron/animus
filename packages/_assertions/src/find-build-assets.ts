import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface FindAssetsOptions {
  dir: string;
  extensions: readonly string[];
  filenameContains?: string;
  recursive?: boolean;
}

export async function findBuildAssets(
  opts: FindAssetsOptions
): Promise<string[]> {
  const recursive = opts.recursive ?? true;
  const results: string[] = [];

  async function walk(current: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === 'ENOENT') return;
      throw err;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive) await walk(full);
      } else if (entry.isFile()) {
        const matchesExt = opts.extensions.some((ext) =>
          entry.name.endsWith(ext)
        );
        const matchesName =
          opts.filenameContains == null ||
          entry.name.includes(opts.filenameContains);
        if (matchesExt && matchesName) {
          results.push(full);
        }
      }
    }
  }

  await walk(opts.dir);
  return results;
}

export async function findCssFiles(dir: string): Promise<string[]> {
  return findBuildAssets({ dir, extensions: ['.css'] });
}

export async function findJsFiles(dir: string): Promise<string[]> {
  return findBuildAssets({ dir, extensions: ['.js', '.mjs', '.cjs'] });
}

export async function readAsset(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

export async function readAllConcat(paths: string[]): Promise<string> {
  const contents = await Promise.all(paths.map((p) => readFile(p, 'utf8')));
  return contents.join('\n');
}
