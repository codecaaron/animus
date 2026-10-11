/**
 * Immutable asset copies: one binding from an `asset()` source file to a
 * content-digested name, shared by every host that serves copies.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { basename, extname, join } from 'path';

import { contentHash } from './content-hash';

export interface AssetCopy {
  /** `<stem>.<digest8><ext>`, the copy's name in the assets directory. */
  fileName: string;
  /** The source bytes' content hash when copied. */
  digest: string;
}

/** Copies `sourcePath` into `assetsDir` under its content-digested name,
 *  once: a copy is never overwritten, so a URL naming it always serves the
 *  bytes it named. */
export function writeAssetCopy(
  sourcePath: string,
  assetsDir: string
): AssetCopy {
  const bytes = readFileSync(sourcePath);
  const digest = contentHash(bytes);
  const ext = extname(sourcePath);
  const fileName = `${basename(sourcePath, ext)}.${digest.slice(0, 8)}${ext}`;
  if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });
  const copyPath = join(assetsDir, fileName);
  if (!existsSync(copyPath)) writeFileSync(copyPath, bytes);
  return { fileName, digest };
}

/** Sync `assets/` to the current build's file set; per-entry failures are
 *  tolerated — a concurrent session may have removed the same file. */
export function pruneStaleAssets(
  assetsDir: string,
  expected: ReadonlySet<string>
): void {
  if (!existsSync(assetsDir)) return;
  let entries: string[];
  try {
    entries = readdirSync(assetsDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (expected.has(entry)) continue;
    try {
      unlinkSync(join(assetsDir, entry));
    } catch {
      // Concurrent session removal, or an unexpected subdirectory — leave it.
    }
  }
}
