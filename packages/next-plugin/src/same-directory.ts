import { realpathSync, statSync } from 'fs';
import { resolve } from 'path';

/** Whether two paths name one directory: by real path, which resolves a
 *  trailing slash, a symlink and the filesystem's own spelling, else by
 *  device and inode. */
export function sameDirectory(a: string, b: string): boolean {
  const real = (path: string): string => {
    try {
      return realpathSync.native(path);
    } catch {
      return resolve(path);
    }
  };
  if (real(a) === real(b)) return true;
  try {
    const left = statSync(a);
    const right = statSync(b);
    return left.dev === right.dev && left.ino === right.ino;
  } catch {
    return false;
  }
}
