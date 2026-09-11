import { AnimusConfigError, contentHash } from '@animus-ui/extract/pipeline';
import {
  checkLockLiveness,
  CLI_COMMIT_ARTIFACT,
  CLI_LOCK_ARTIFACT,
  decodeCommitRecord,
  holdDirectoryClaim,
  isLockHolderAlive,
  lockRecordBytes,
  MANIFEST_ARTIFACT,
  readCliLockRecord,
  SESSION_ASSETS_DIR,
  STYLES_ARTIFACT,
  SYSTEM_PROPS_ARTIFACT,
  verifyCommitRecord,
} from '@animus-ui/extract/session';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';

import type { CommitRecord, SessionAsset } from '@animus-ui/extract/session';

// These names are the session's own constants: the stylesheet's relative
// urls and the session's confinement gate key on the same spellings.
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
  /** Published under `assets/<name>` beside styles.css — the stylesheet's
   *  relative urls dangle without them. */
  assets?: readonly SessionAsset[];
}

interface FileExistsError {
  code: 'EEXIST';
}

function isFileExistsError<Value>(
  error: Value
): error is Value & FileExistsError {
  return error instanceof Object && 'code' in error && error.code === 'EEXIST';
}

/** Rejected by the pre-swap consistency check: the staged set did not
 *  verify, and the previous generation was left untouched. */
export class PublishInconsistencyError extends Error {
  constructor(readonly failures: string[]) {
    super(
      `Staged publication failed its consistency check:\n  - ${failures.join('\n  - ')}`
    );
    this.name = 'PublishInconsistencyError';
  }
}

export class PublishSwapIncompleteError<Thrown> extends Error {
  constructor(
    readonly outDir: string,
    /** Names replaced before the failure, in swap order. */
    readonly landed: readonly string[],
    readonly failure: Thrown
  ) {
    super(
      `Publication of ${outDir} stopped mid-swap after replacing ` +
        `${landed.join(', ')} — the directory now mixes two generations and ` +
        `its commit record does not describe it. The next successful ` +
        `publication rewrites the whole set. Cause: ${String(failure)}`
    );
    this.name = 'PublishSwapIncompleteError';
  }
}

/** A refused claim on the output tree: another process owns it, or its lock
 *  cannot be proven dead. Extends `AnimusConfigError`, so it exits 2. */
export class AnimusLockConflictError extends AnimusConfigError {
  constructor(message: string) {
    super(message);
    this.name = 'AnimusLockConflictError';
  }
}

const STAGING_PREFIX = '.staging-';

/** One list drives the staged write, the commit record, the rename, and the
 *  unfinished-publication probe; the order is swap order. */
const NAMED_PAYLOAD_FIELDS = [
  [STYLES_FILE, 'stylesCss'],
  [SYSTEM_PROPS_FILE, 'systemPropsJs'],
  [MANIFEST_FILE, 'manifestJson'],
] as const satisfies ReadonlyArray<readonly [string, keyof ArtifactPayloads]>;

const PUBLISHED_NAMES: readonly string[] = [
  ...NAMED_PAYLOAD_FIELDS.map(([name]) => name),
  COMMIT_FILE,
];

/** Called only while the claim is held — deciding a tree is debris and
 *  deleting it is a write. A live pid's tree is its own working set. */
function reapAbandonedStaging(outDir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(outDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith(STAGING_PREFIX)) continue;
    const pid = Number(entry.slice(STAGING_PREFIX.length));
    if (!Number.isInteger(pid) || isLockHolderAlive(pid)) continue;
    console.error(
      `[animus] Removing staging directory ${entry} left by dead pid ${pid}`
    );
    rmSync(join(outDir, entry), { recursive: true, force: true });
  }
}

/** Reported, not refused: this run republishes the whole set, which is the
 *  repair; refusing would leave the directory wedged. */
function reportUnfinishedPublication(outDir: string): void {
  if (!PUBLISHED_NAMES.some((name) => existsSync(join(outDir, name)))) return;
  const failures = verifyCommitRecord(outDir);
  if (failures.length === 0) return;
  console.error(
    `[animus] ${outDir} holds artifacts that do not match its commit ` +
      `record — a previous publication did not finish:\n  - ` +
      `${failures.join('\n  - ')}\n[animus] This run replaces the whole set; ` +
      `until it does, nothing in that directory is consistent.`
  );
}

/** Take the single-writer advisory lock; a live holder is a hard failure. */
export function acquireLock(outDir: string): () => void {
  mkdirSync(outDir, { recursive: true });
  const lockPath = join(outDir, LOCK_FILE);
  const startedAt = new Date().toISOString();
  try {
    writeFileSync(lockPath, lockRecordBytes(startedAt), { flag: 'wx' });
  } catch (error) {
    if (!isFileExistsError(error)) throw error;
    const lock = readCliLockRecord(outDir);
    let staleReason =
      'the lock file was removed between the failed claim and the read';
    if (lock.kind === 'held') {
      const liveness = checkLockLiveness(lock.record);
      if (liveness.live) {
        throw new AnimusLockConflictError(
          `Another animus process (pid ${lock.record.pid}, started ` +
            `${lock.record.startedAt ?? 'unknown'}) owns ${outDir} — wait for ` +
            `it or pass --out-dir to write elsewhere.`
        );
      }
      staleReason = liveness.reason;
    }
    if (lock.kind === 'indeterminate') {
      // A holder that cannot be identified cannot be proven dead, and
      // stealing it would put two writers on one tree.
      throw new AnimusLockConflictError(
        `${join(outDir, LOCK_FILE)} exists but is not a readable lock record ` +
          `— its holder cannot be identified. Remove the file if no animus ` +
          `process is running, or pass --out-dir to write elsewhere.`
      );
    }
    // Unlink then re-create under 'wx': two racers on one stale claim
    // cannot both win — the loser's exclusive create fails into conflict.
    console.error(`[animus] Replacing stale lock: ${staleReason}`);
    rmSync(lockPath, { force: true });
    try {
      writeFileSync(lockPath, lockRecordBytes(startedAt), { flag: 'wx' });
    } catch (retryError) {
      if (!isFileExistsError(retryError)) {
        throw retryError;
      }
      throw new AnimusLockConflictError(
        `Another animus process re-acquired ${outDir} while a stale lock ` +
          `was being replaced — wait for it or pass --out-dir.`
      );
    }
  }
  reapAbandonedStaging(outDir);
  reportUnfinishedPublication(outDir);
  // Heartbeat: without one, a lock left by a kill -9 is indistinguishable
  // from a live one. Renamed, because a truncated record is refused.
  return holdDirectoryClaim(outDir, { write: 'rename', startedAt });
}

function publishedAssetNames(outDir: string): ReadonlySet<string> {
  let record: CommitRecord | null;
  try {
    record = decodeCommitRecord(
      readFileSync(join(outDir, COMMIT_FILE), 'utf-8')
    );
  } catch {
    return new Set();
  }
  if (record === null) return new Set();
  return new Set(
    Object.keys(record.payloads)
      .filter((name) => name.startsWith(`${ASSETS_DIR}/`))
      .map((name) => name.slice(ASSETS_DIR.length + 1))
  );
}

/** Staged, verified, then renamed into place with the commit record LAST. A
 *  set that cannot verify throws with the previous generation untouched. */
export function publishArtifacts(
  outDir: string,
  payloads: ArtifactPayloads
): CommitRecord {
  mkdirSync(outDir, { recursive: true });
  // Captured before any mutation: only names the current record published
  // are prunable below.
  const previouslyPublishedAssets = publishedAssetNames(outDir);
  const staging = join(outDir, `${STAGING_PREFIX}${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  try {
    const namedPayloads: ReadonlyArray<readonly [string, string]> =
      NAMED_PAYLOAD_FIELDS.map(([name, field]) => [name, payloads[field]]);
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

    const failures = verifyCommitRecord(staging);
    if (failures.length > 0) {
      throw new PublishInconsistencyError(failures);
    }

    // The record lands LAST and the swap as a whole is not atomic: `landed`
    // separates a destroyed previous generation from an intact one.
    const landed: string[] = [];
    try {
      for (const [name] of namedPayloads) {
        renameSync(join(staging, name), join(outDir, name));
        landed.push(name);
      }
      const publishedAssetsDir = join(outDir, ASSETS_DIR);
      if (assets.length > 0) {
        mkdirSync(publishedAssetsDir, { recursive: true });
        for (const { name } of assets) {
          renameSync(
            join(staging, ASSETS_DIR, name),
            join(publishedAssetsDir, name)
          );
          landed.push(`${ASSETS_DIR}/${name}`);
        }
      }
      // Content-hashed asset names accumulate forever, but outDir is not
      // animus-exclusive: only what the previous record published is pruned.
      const expectedNames = new Set(assets.map((asset) => asset.name));
      for (const name of previouslyPublishedAssets) {
        if (expectedNames.has(name)) continue;
        try {
          unlinkSync(join(publishedAssetsDir, name));
        } catch {
          // Concurrent removal — the prune's goal is already met.
        }
      }
      renameSync(join(staging, COMMIT_FILE), join(outDir, COMMIT_FILE));
      landed.push(COMMIT_FILE);
    } catch (error) {
      if (landed.length === 0) throw error;
      throw new PublishSwapIncompleteError(outDir, landed, error);
    }
    return record;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
