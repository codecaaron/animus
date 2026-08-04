import { createHash } from 'crypto';

/**
 * MD5 content hash used for file-change detection (HMR diffing) by both
 * extraction plugins, and for content-addressing copied asset bytes. The
 * algorithm/encoding is a cross-plugin contract: cache keys written by one
 * build path must compare equal in the next. Accepts a Buffer directly so
 * binary sources hash without an intermediate string copy.
 */
export function contentHash(source: string | Buffer): string {
  return createHash('md5').update(source).digest('hex');
}
