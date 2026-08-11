/**
 * Deterministic fixed-path artifact writer (design D3): raw payload bytes —
 * no session envelope, no per-invocation identity — staged into a private
 * subdirectory, VERIFIED there, then renamed into place with `commit.json`
 * LAST carrying content hashes of every payload (asset files included), so
 * a reader holding only the record and the payload bytes can verify set
 * completeness and consistency — and a publication that cannot verify
 * never replaces the previous generation. A single-writer advisory lock
 * fails loud instead of last-writer-wins; the lock never outlives the
 * invocation, so repeated identical builds are byte-identical trees.
 */

import { AnimusConfigError, contentHash } from '@animus-ui/extract/pipeline';
import {
  CLI_COMMIT_ARTIFACT,
  CLI_LOCK_ARTIFACT,
  MANIFEST_ARTIFACT,
  pruneStaleAssets,
  SESSION_ASSETS_DIR,
  STYLES_ARTIFACT,
  SYSTEM_PROPS_ARTIFACT,
  verifyCommitRecord,
} from '@animus-ui/extract/session';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import type { SessionAsset } from '@animus-ui/extract/session';

// Every published name is the SESSION's constant — the stylesheet's
// relative urls and the session's start-hygiene confinement gate key on
// these exact spellings, so a drifted local literal on either side breaks
// the contract silently.
export const STYLES_FILE = STYLES_ARTIFACT;
export const SYSTEM_PROPS_FILE = SYSTEM_PROPS_ARTIFACT;
export const MANIFEST_FILE = MANIFEST_ARTIFACT;
export const COMMIT_FILE = CLI_COMMIT_ARTIFACT;
export const LOCK_FILE = CLI_LOCK_ARTIFACT;
export const ASSETS_DIR = SESSION_ASSETS_DIR;

export interface ArtifactPayloads {
  stylesCss: string;
  systemPropsJs: string;
  manifestJson: string;
  /** The session's copied asset() files (`collectSessionAssets` output),
   *  published under `assets/<name>` beside styles.css — the stylesheet's
   *  relative urls dangle without them. */
  assets?: readonly SessionAsset[];
}

export interface CommitRecord {
  schema: 1;
  payloads: Record<string, { hash: string }>;
}

/** Publication rejected by the pre-swap consistency check: the staged set
 *  did not verify, and the previous generation was left untouched. */
export class PublishInconsistencyError extends Error {
  constructor(readonly failures: string[]) {
    super(
      `Staged publication failed its consistency check:\n  - ${failures.join('\n  - ')}`
    );
    this.name = 'PublishInconsistencyError';
  }
}

/** Take the single-writer advisory lock, failing loud on a live holder.
 *  Returns a release function. */
export function acquireLock(outDir: string): () => void {
  mkdirSync(outDir, { recursive: true });
  const lockPath = join(outDir, LOCK_FILE);
  try {
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }),
      { flag: 'wx' }
    );
  } catch (error) {
    if ((error as { code?: string }).code !== 'EEXIST') throw error;
    let holder: { pid?: number; startedAt?: string } = {};
    try {
      holder = JSON.parse(readFileSync(lockPath, 'utf-8'));
    } catch {
      // Unreadable lock — treat as stale below.
    }
    if (typeof holder.pid === 'number' && isProcessAlive(holder.pid)) {
      throw new AnimusConfigError(
        `Another animus process (pid ${holder.pid}, started ` +
          `${holder.startedAt ?? 'unknown'}) owns ${outDir} — wait for it ` +
          `or pass --out-dir to write elsewhere.`
      );
    }
    // Stale lock from a dead process: steal it loudly via unlink +
    // re-acquire under 'wx', so two racers observing the same dead pid
    // cannot both win (one's exclusive create fails and maps to the live
    // conflict path).
    console.error(
      `[animus] Replacing stale lock left by dead pid ${holder.pid ?? '?'}`
    );
    rmSync(lockPath, { force: true });
    try {
      writeFileSync(
        lockPath,
        JSON.stringify({
          pid: process.pid,
          startedAt: new Date().toISOString(),
        }),
        { flag: 'wx' }
      );
    } catch (retryError) {
      if ((retryError as { code?: string }).code !== 'EEXIST') {
        throw retryError;
      }
      throw new AnimusConfigError(
        `Another animus process re-acquired ${outDir} while a stale lock ` +
          `was being replaced — wait for it or pass --out-dir.`
      );
    }
  }
  return () => {
    rmSync(lockPath, { force: true });
  };
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Publish the payload set. The set is STAGED into a private subdirectory,
 * verified there (recompute-and-compare, the same check
 * `verifyPublishedSet` runs), and only a verified set is renamed into
 * place: payloads first, asset files next, the commit record LAST. A set
 * that cannot verify throws `PublishInconsistencyError` with the previous
 * generation untouched — "keeping last-good artifacts" must be literally
 * true for the watch loop's rejection path. The record carries only
 * content-derived data (asset entries sorted by name) so the full tree is
 * byte-identical across identical-input runs.
 */
export function publishArtifacts(
  outDir: string,
  payloads: ArtifactPayloads
): CommitRecord {
  mkdirSync(outDir, { recursive: true });
  const staging = join(outDir, `.staging-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    // ONE list drives the write, the record, and the rename — a payload
    // added to one arm but not another would stage without ever landing.
    const namedPayloads: ReadonlyArray<readonly [string, string]> = [
      [STYLES_FILE, payloads.stylesCss],
      [SYSTEM_PROPS_FILE, payloads.systemPropsJs],
      [MANIFEST_FILE, payloads.manifestJson],
    ];
    const record: CommitRecord = { schema: 1, payloads: {} };
    for (const [name, text] of namedPayloads) {
      writeFileSync(join(staging, name), text);
      record.payloads[name] = { hash: contentHash(text) };
    }

    const assets = payloads.assets ?? [];
    if (assets.length > 0) {
      mkdirSync(join(staging, ASSETS_DIR), { recursive: true });
      for (const { name, bytes } of assets) {
        writeFileSync(join(staging, ASSETS_DIR, name), bytes);
        record.payloads[`${ASSETS_DIR}/${name}`] = {
          hash: contentHash(bytes),
        };
      }
    }

    writeFileSync(
      join(staging, COMMIT_FILE),
      JSON.stringify(record, null, 2) + '\n'
    );

    const failures = verifyPublishedSet(staging);
    if (failures.length > 0) {
      throw new PublishInconsistencyError(failures);
    }

    // Swap the verified set into place: payloads → assets → record LAST,
    // each an atomic same-directory-tree rename.
    for (const [name] of namedPayloads) {
      renameSync(join(staging, name), join(outDir, name));
    }
    const publishedAssetsDir = join(outDir, ASSETS_DIR);
    if (assets.length > 0) {
      mkdirSync(publishedAssetsDir, { recursive: true });
      for (const { name } of assets) {
        renameSync(
          join(staging, ASSETS_DIR, name),
          join(publishedAssetsDir, name)
        );
      }
    }
    // Prune published assets the new generation no longer records —
    // content-hashed names accumulate forever otherwise. (After the copies
    // land, before the record flips; the session's own race-tolerant prune.)
    pruneStaleAssets(
      publishedAssetsDir,
      new Set(assets.map((asset) => asset.name))
    );
    renameSync(join(staging, COMMIT_FILE), join(outDir, COMMIT_FILE));
    return record;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** The documented consistency check — the session-shared implementation
 *  (published-set.ts): recompute every payload hash raw-bytes and compare
 *  against the commit record. Returns failure lines (empty = consistent). */
export function verifyPublishedSet(outDir: string): string[] {
  return verifyCommitRecord(outDir);
}
