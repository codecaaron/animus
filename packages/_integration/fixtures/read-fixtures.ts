import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

interface FileEntry {
  path: string;
  source: string;
}

/**
 * Read .tsx fixture files from a directory and return FileEntry[]
 * in the format analyzeProject() expects.
 */
export function readFixtureFiles(dir: string): FileEntry[] {
  const entries: FileEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.tsx')) continue;
    const fullPath = join(dir, name);
    entries.push({
      path: relative(join(dir, '..'), fullPath),
      source: readFileSync(fullPath, 'utf-8'),
    });
  }
  return entries;
}

/**
 * Read specific fixture files by name.
 */
export function readFixtureFile(dir: string, filename: string): FileEntry {
  const fullPath = join(dir, filename);
  return {
    path: relative(join(dir, '..'), fullPath),
    source: readFileSync(fullPath, 'utf-8'),
  };
}
