import { mkdirSync, renameSync, writeFileSync } from 'fs';
import { basename, dirname, join } from 'path';

/** Write-then-rename, so a reader never sees a torn file; the pid in the
 *  tmp name keeps writers apart, and the directory is made on the way. */
export function writeAtomically(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  writeFileSync(tmpPath, content);
  renameSync(tmpPath, path);
}
