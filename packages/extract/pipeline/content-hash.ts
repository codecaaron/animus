import { createHash } from 'crypto';

export function contentHash(source: string | Buffer): string {
  return createHash('md5').update(source).digest('hex');
}
