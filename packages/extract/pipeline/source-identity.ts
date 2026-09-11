import { realpathSync } from 'node:fs';
import path from 'node:path';

/** Structural alias, not `node:path`'s own `PlatformPath`: some @types/node
 *  versions do not export that name and fail consumers' type-check. */
type PlatformPath = typeof path.win32;

/**
 * One derivation of source identity for discovery, watch ingestion, ownership
 * and deletion: event paths are lookup INPUTS only and never fork identity.
 */

/**
 * True when `target` is `root` or a descendant, decided by `relative()`
 * shape: string prefixing would let `/ui` claim `/ui-old`.
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
 * True when two paths share a platform root (win32 drive letter or UNC
 * share; always true on posix). Drive letters compare case-insensitively.
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

export interface ResolvedSourceId {
  /**
   * rootDir-relative key all persistent analysis state is indexed by; kit
   * files keep `..`-prefixed keys. Canonical, so event spelling never forks it.
   */
  sourceKey: string;
  /** Canonical owning external root; null when the project root owns it. */
  owningRoot: string | null;
  /** Path relative to the owning root (equals `sourceKey` for project-root
   *  members) — the input for package-relative exclusion filters. */
  pathInRoot: string;
}

/**
 * Per-generation identity handle: alias associations observed while a file
 * existed are recorded, so deletion never canonicalizes a gone path.
 */
export interface SourceIdentity {
  readonly rootDir: string;
  readonly canonicalRootDir: string;
  /**
   * Register an external source root; duplicate spellings of one canonical
   * root collapse into the first registration. Returns the canonical form.
   */
  registerExternalRoot(root: string): string;
  /** Canonical forms of every registered external root (registration order). */
  externalRoots(): string[];
  /**
   * Resolve an EXISTING path: canonicalize, then re-authorize containment so
   * a symlink escaping every allowed tree is rejected. Records the aliases.
   */
  resolveSourceId(inputPath: string): ResolvedSourceId | null;
  /**
   * Resolve a DELETED path through recorded aliases only: a spelling never
   * observed while the file existed resolves nothing.
   */
  resolveDeletedSourceId(inputPath: string): ResolvedSourceId | null;
  /**
   * The canonical external root containing `inputPath` — the path need not
   * exist and no file identity is resolved. Null when no root contains it.
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
      // A root nested inside the project root outranks the project root;
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
        // Canonical form escapes every allowed tree — the post-canonical
        // re-authorization that rejects nested symlink escapes.
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
      // Lexical containment first: the realpath syscall runs only when no
      // lexical form matches.
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
