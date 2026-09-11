import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

interface FileEntry {
  path: string;
  source: string;
}

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

export function readFixtureFile(dir: string, filename: string): FileEntry {
  const fullPath = join(dir, filename);
  return {
    path: relative(join(dir, '..'), fullPath),
    source: readFileSync(fullPath, 'utf-8'),
  };
}
