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

interface FileExistsError {
  code: 'EEXIST';
}

function isFileExistsError<Value>(
  error: Value
): error is Value & FileExistsError {
  return error instanceof Object && 'code' in error && error.code === 'EEXIST';
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

/**
 * The swap stopped with the output directory mixing two generations: a
 * payload name had already been replaced when a later rename failed, so
 * `commit.json` no longer describes the bytes beside it. Unlike
 * `PublishInconsistencyError`, the previous generation is NOT intact.
 */
export class PublishSwapIncompleteError<Thrown> extends Error {
  constructor(
    readonly outDir: string,
    /** Names replaced before the failure, in swap order. */
    readonly landed: readonly string[],
    /** The rename failure as the platform threw it, reported verbatim. */
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

/**
 * A refused claim on the output tree: some other process owns it, or its
 * lock cannot be proven dead. Split out of `AnimusConfigError` so the class
 * names ONE thing — "the user misconfigured this run" and "another writer
 * is here" are different facts, and the base class was carrying both.
 *
 * The exit routing is deliberately UNCHANGED: this extends
 * `AnimusConfigError`, so `exitCodeFor` still classifies it as EXIT_USAGE
 * exactly as before. The split makes the two meanings separable by
 * `instanceof` without making the class the routing mechanism.
 *
 * Open owner decision (spec gap, not settled here): the standalone-CLI
 * design's D5 Choice reads exit 2 as "config/usage error" while its own
 * Rationale reads it as "preconditions", and no requirement or scenario
 * under that change's specs names a lock-conflict code at all. Under the
 * Choice reading a busy output directory is arguably an environment
 * failure (3). Moving it is a behavior change and needs a fail-first test.
 */
export class AnimusLockConflictError extends AnimusConfigError {
  constructor(message: string) {
    super(message);
    this.name = 'AnimusLockConflictError';
  }
}

/** The publication's private staging subdirectory, pid-suffixed so two
 *  writers over one tree never share a path. */
const STAGING_PREFIX = '.staging-';

/**
 * Every payload name a publication writes, in swap order, paired with its
 * `ArtifactPayloads` field. One list drives the staged write, the commit
 * record, the rename, and the unfinished-publication probe: a name in one arm
 * but not another stages without ever landing, or is never looked for.
 */
const NAMED_PAYLOAD_FIELDS = [
  [STYLES_FILE, 'stylesCss'],
  [SYSTEM_PROPS_FILE, 'systemPropsJs'],
  [MANIFEST_FILE, 'manifestJson'],
] as const satisfies ReadonlyArray<readonly [string, keyof ArtifactPayloads]>;

/** What a finished publication leaves in an output directory: every payload
 *  name plus the record written last. */
const PUBLISHED_NAMES: readonly string[] = [
  ...NAMED_PAYLOAD_FIELDS.map(([name]) => name),
  COMMIT_FILE,
];

/**
 * Remove staging trees left in `outDir` by writers that are no longer
 * running; a hard kill never reaches the `finally` that removes them.
 *
 * Called only while the claim is held, since deciding a directory is debris
 * and deleting it is a write to the tree. A tree whose pid is still running
 * is that writer's private working set and is never touched.
 */
function reapAbandonedStaging(outDir: string): void {
  let entries: string[];
  try {
    entries = readdirSync(outDir);
  } catch {
    return; // the directory this claim just created is readable; a race is not
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

/**
 * Report an output directory whose artifacts do not match their commit
 * record — what a publication that stopped mid-swap, or a hand edit of a
 * published payload, leaves behind. Reported rather than refused: this run
 * republishes the whole set, which is the repair, so refusing would leave a
 * wedged directory with no remedy but deleting it by hand.
 */
function reportUnfinishedPublication(outDir: string): void {
  // An outDir with none of these names has no publication to be unfinished:
  // a first run, or a user-owned directory the CLI has not written yet.
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

/** Take the single-writer advisory lock, failing loud on a live holder.
 *  Returns a release function. */
export function acquireLock(outDir: string): () => void {
  mkdirSync(outDir, { recursive: true });
  const lockPath = join(outDir, LOCK_FILE);
  const startedAt = new Date().toISOString();
  try {
    writeFileSync(lockPath, lockRecordBytes(startedAt), { flag: 'wx' });
  } catch (error) {
    if (!isFileExistsError(error)) throw error;
    // The lock's shape and its liveness policy belong to the session (the
    // other reader is the session's debris-detection gate) — this driver
    // only decides what to do with each outcome.
    const lock = readCliLockRecord(outDir);
    // Why the claim is stealable, in the user's terms. The default covers
    // the one path that reaches the steal with no record: the file was
    // removed between the failed exclusive create and this read.
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
      // A lock whose bytes name no pid cannot be proven dead, and stealing
      // it would put two writers on one tree. Refuse, and name the file the
      // user may remove once no animus process is running.
      throw new AnimusLockConflictError(
        `${join(outDir, LOCK_FILE)} exists but is not a readable lock record ` +
          `— its holder cannot be identified. Remove the file if no animus ` +
          `process is running, or pass --out-dir to write elsewhere.`
      );
    }
    // Steal the stale lock via unlink + re-acquire under 'wx', so two racers
    // observing the same stale claim cannot both win: the loser's exclusive
    // create fails and maps to the live-conflict path.
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
  // Proof of life for as long as the claim is held: without a heartbeat, a
  // lock left behind by a kill -9 or a crashed host is indistinguishable
  // from a live one for as long as the kernel keeps the pid number in use.
  // Write-then-rename, because this tree's reader refuses an undecodable
  // record rather than pruning past it, so a truncated rewrite would cost
  // the next run its output directory.
  return holdDirectoryClaim(outDir, { write: 'rename', startedAt });
}

/** Asset names under `assets/` that outDir's current commit record
 *  published, or empty when no record is readable. */
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

/**
 * Publish the payload set. The set is STAGED into a private subdirectory,
 * verified there (recompute-and-compare, the same check
 * `verifyCommitRecord` runs), and only a verified set is renamed into
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
  // The prune's ownership boundary, captured before any mutation: asset
  // names the outDir's CURRENT commit record published. Absent/unreadable
  // record → nothing is prunable.
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

    // Swap the verified set into place: payloads → assets → record LAST,
    // each an atomic same-directory-tree rename. The swap as a WHOLE is not
    // atomic, so `landed` records how far it got: it is the only thing that
    // separates a failure that destroyed the previous generation from one
    // that left it intact.
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
      // Prune published assets the new generation no longer records —
      // content-hashed names accumulate forever otherwise. Ownership-scoped:
      // only names the PREVIOUS record published are prunable. outDir is not
      // animus-exclusive (the lock-conflict remediation advertises
      // --out-dir), so an unscoped prune with an empty expected set would
      // clear a user-owned assets/ wholesale.
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
      // Nothing was replaced, so the previous generation is genuinely intact.
      if (landed.length === 0) throw error;
      throw new PublishSwapIncompleteError(outDir, landed, error);
    }
    return record;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}
