import { createHash } from 'crypto';

/** A change-detection and copy-naming hash, not a security boundary: 32
 *  hex digits, as it has always been. SHA-1 runs several times faster than
 *  MD5 where the CPU has SHA instructions (about 26 ms against 124 ms per
 *  64 MiB on arm64). */
export function contentHash(source: string | Buffer): string {
  return createHash('sha1').update(source).digest('hex').slice(0, 32);
}
