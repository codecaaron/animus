import { createHash } from 'crypto';

/**
 * MD5 content hash used for file-change detection (HMR diffing) by both
 * extraction plugins. The algorithm/encoding is a cross-plugin contract:
 * cache keys written by one build path must compare equal in the next.
 */
export function contentHash(source: string): string {
  return createHash('md5').update(source).digest('hex');
}
