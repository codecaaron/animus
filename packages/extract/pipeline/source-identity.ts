import { realpathSync } from 'node:fs';
import path from 'node:path';

/** Platform path API (`path` / `path.win32` / `path.posix`). Structural
 *  local alias — the packed consumers' @types/node need not export
 *  `PlatformPath` from 'node:path' (older versions don't, which fails
 *  their declaration type-check against this file's emitted d.ts). */
type PlatformPath = typeof path.win32;

/**
 * SourceId derivation authority + allowlist membership (openspec:
 * external-source-watch-ingestion, design D1/D2/D5).
 *
 * One shared derivation produces the canonical source identity consumed by
 * discovery, watch ingestion, ownership, deletion pruning, and diagnostics
 * — raw event paths are lookup INPUTS only, so event spelling (symlink
 * alias vs canonical, lexical vs realpath) can never fork identity.
 *
 * The containment and volume helpers are pure and path-API-injectable so
 * Windows semantics are unit-testable via `path.win32` on any host; runtime
 * callers use the ambient platform implementation.
 */

/**
 * Structural containment: `target` is the root itself or a descendant of it,
 * decided by `relative()` shape — never by string prefixing, so `/ui` can
 * never claim `/ui-old`, and a cross-drive win32 target (whose relative()
 * result is absolute) is never contained.
 */
export function isPathWithinRoot(
  root: string,
  target: string,
  pathApi: PlatformPath = path
): boolean {
  const rel = pathApi.relative(root, target);
  return (
    rel === '' ||
    (!pathApi.isAbsolute(rel) &&
      rel !== '..' &&
      !rel.startsWith('..' + pathApi.sep))
  );
}

/**
 * Cross-volume gate (design D5): two paths share a platform path root
 * (win32 drive letter or UNC share; always true on posix). Compared
 * case-insensitively — win32 drive letters are case-insensitive.
 */
export function sharesVolumeRoot(
  a: string,
  b: string,
  pathApi: PlatformPath = path
): boolean {
  const volumeOf = (p: string): string =>
    pathApi.parse(pathApi.resolve(p)).root.toLowerCase();
  return volumeOf(a) === volumeOf(b);
}

/** One resolved source identity. */
export interface ResolvedSourceId {
  /**
   * The rootDir-relative source key all persistent analysis state is
   * indexed by — kit files keep their `..`-prefixed keys. Derived from
   * CANONICAL paths (canonical suffix re-attached to the root's
   * as-registered spelling) so it always matches the key discovery
   * produced, whatever spelling the event carried.
   */
  sourceKey: string;
  /** Canonical form of the owning external root; null when the project
   *  root itself owns the file. */
  owningRoot: string | null;
  /** Canonical path of the file relative to its owning root (equals
   *  `sourceKey` for project-root members) — the input for package-relative
   *  exclusion filters. */
  pathInRoot: string;
}

/**
 * The per-generation identity handle (design D2): canonical roots are
 * realpath'd once at registration, and every alias→SourceId association
 * observed while a file existed is recorded so DELETION resolves through
 * the cache — never through fresh canonicalization of a gone path.
 */
export interface SourceIdentity {
  readonly rootDir: string;
  readonly canonicalRootDir: string;
  /**
   * Register a discovery-resolved external source root. Both the
   * as-registered (lexical) and canonical forms become membership
   * witnesses; duplicate spellings of one canonical root collapse into the
   * first registration. Returns the canonical form.
   */
  registerExternalRoot(root: string): string;
  /** Canonical forms of every registered external root (registration order). */
  externalRoots(): string[];
  /**
   * Resolve an EXISTING path to its source identity: canonicalize, then
   * re-authorize containment against the canonical form of the allowed
   * trees (a nested symlink escaping every allowed tree is rejected).
   * Records the observed spelling (and the canonical form) as deletion
   * aliases. Returns null for non-members and paths that cannot be
   * canonicalized (vanished between event and resolution).
   */
  resolveSourceId(inputPath: string): ResolvedSourceId | null;
  /**
   * Resolve a DELETED path through the recorded alias associations only —
   * a spelling never observed while the file existed resolves nothing.
   */
  resolveDeletedSourceId(inputPath: string): ResolvedSourceId | null;
  /**
   * The canonical external root structurally containing `inputPath`
   * (matched against both root forms; the path itself need not exist and
   * no file identity is resolved) — the watch pass's dirty-root witness
   * for directory-granularity reports. Null when no root contains it.
   */
  containingExternalRoot(inputPath: string): string | null;
}

interface RootRecord {
  asRegistered: string;
  canonical: string;
}

function canonicalize(p: string): string | null {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

export function createSourceIdentity(rootDir: string): SourceIdentity {
  const normalizedRootDir = path.normalize(rootDir);
  const canonicalRootDir = canonicalize(normalizedRootDir) ?? normalizedRootDir;
  const roots: RootRecord[] = [];
  const aliases = new Map<string, ResolvedSourceId>();

  const owningRecord = (canonicalPath: string): RootRecord | null => {
    let owner: RootRecord | null = null;
    for (const record of roots) {
      if (!isPathWithinRoot(record.canonical, canonicalPath)) continue;
      if (!owner || record.canonical.length > owner.canonical.length) {
        owner = record;
      }
    }
    return owner;
  };

  return {
    rootDir: normalizedRootDir,
    canonicalRootDir,

    registerExternalRoot(root: string): string {
      const asRegistered = path.normalize(root);
      const canonical = canonicalize(asRegistered) ?? asRegistered;
      const existing = roots.find((record) => record.canonical === canonical);
      if (existing) return existing.canonical;
      roots.push({ asRegistered, canonical });
      return canonical;
    },

    externalRoots(): string[] {
      return roots.map((record) => record.canonical);
    },

    resolveSourceId(inputPath: string): ResolvedSourceId | null {
      const lexical = path.normalize(inputPath);
      const canonical = canonicalize(lexical);
      if (canonical === null) return null;

      const owner = owningRecord(canonical);
      const ownedBy = (record: RootRecord): ResolvedSourceId => {
        const pathInRoot = path.relative(record.canonical, canonical);
        return {
          sourceKey: path.relative(
            normalizedRootDir,
            path.join(record.asRegistered, pathInRoot)
          ),
          owningRoot: record.canonical,
          pathInRoot,
        };
      };
      // A registered root nested INSIDE the project root can be more
      // specific than the root itself (an out-of-root kit always is) —
      // otherwise project-root membership wins, then any remaining owner.
      const ownerIsMoreSpecific =
        owner !== null && owner.canonical.length > canonicalRootDir.length;
      let resolved: ResolvedSourceId;
      if (
        !ownerIsMoreSpecific &&
        isPathWithinRoot(canonicalRootDir, canonical)
      ) {
        const key = path.relative(canonicalRootDir, canonical);
        resolved = { sourceKey: key, owningRoot: null, pathInRoot: key };
      } else if (owner) {
        resolved = ownedBy(owner);
      } else {
        // Canonical form escapes every allowed tree — the re-authorization
        // after canonicalization that rejects nested symlink escapes.
        return null;
      }
      aliases.set(lexical, resolved);
      aliases.set(canonical, resolved);
      return resolved;
    },

    resolveDeletedSourceId(inputPath: string): ResolvedSourceId | null {
      return aliases.get(path.normalize(inputPath)) ?? null;
    },

    containingExternalRoot(inputPath: string): string | null {
      const lexical = path.normalize(inputPath);
      let owner: RootRecord | null = null;
      // Lexical containment first — canonicalization (a realpath syscall)
      // only runs when no lexical form matches, preserving the
      // symlink-alias path as the fallback.
      for (const record of roots) {
        const contained =
          isPathWithinRoot(record.canonical, lexical) ||
          isPathWithinRoot(record.asRegistered, lexical);
        if (!contained) continue;
        if (!owner || record.canonical.length > owner.canonical.length) {
          owner = record;
        }
      }
      if (owner) return owner.canonical;
      const canonical = canonicalize(lexical);
      if (canonical === null) return null;
      for (const record of roots) {
        if (!isPathWithinRoot(record.canonical, canonical)) continue;
        if (!owner || record.canonical.length > owner.canonical.length) {
          owner = record;
        }
      }
      return owner?.canonical ?? null;
    },
  };
}
