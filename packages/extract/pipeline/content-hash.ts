import { createHash } from 'crypto';
import { readFileSync } from 'fs';

export function contentHash(source: string | Buffer): string {
  return createHash('md5').update(source).digest('hex');
}

/** A file's content hash, or '' when it cannot be read. */
export function fileHashOrEmpty(path: string): string {
  try {
    return contentHash(readFileSync(path, 'utf-8'));
  } catch {
    return '';
  }
}

/** The first file whose content no longer has its recorded hash: an
 *  unreadable or deleted file reads as '', which mismatches a real one. */
export function firstChangedFile(
  hashes: Iterable<readonly [string, string]>
): string | undefined {
  for (const [path, hash] of hashes) {
    if (fileHashOrEmpty(path) !== hash) return path;
  }
  return undefined;
}
