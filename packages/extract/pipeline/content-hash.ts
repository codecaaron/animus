import { createHash } from 'crypto';
import { readFileSync } from 'fs';

export function contentHash(source: string | Buffer): string {
  return createHash('md5').update(source).digest('hex');
}

/** A file's text, or null when it cannot be read. */
export function fileTextOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

/** A file's content hash, or '' when it cannot be read. */
export function fileHashOrEmpty(path: string): string {
  const text = fileTextOrNull(path);
  return text === null ? '' : contentHash(text);
}

/** The first file whose content neither has its recorded hash nor one
 *  `matches` accepts for it: an unreadable or deleted file reads as '',
 *  which mismatches a real one. */
export function firstChangedFile(
  hashes: Iterable<readonly [string, string]>,
  matches: (path: string, recorded: string, actual: string) => boolean = (
    _path,
    recorded,
    actual
  ) => actual === recorded
): string | undefined {
  for (const [path, hash] of hashes) {
    if (!matches(path, hash, fileHashOrEmpty(path))) return path;
  }
  return undefined;
}
