import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, isAbsolute, join, relative, resolve } from 'path';

import { discoverFiles } from './discover-files';

/**
 * Walk up from a resolved package entry file to the nearest directory
 * containing a package.json (the package root). Stops at the filesystem
 * root and returns it if no package.json is found on the way up.
 */
export function findPackageRoot(absEntryPath: string): string {
  let pkgRoot = dirname(absEntryPath);
  while (
    pkgRoot !== dirname(pkgRoot) &&
    !existsSync(join(pkgRoot, 'package.json'))
  ) {
    pkgRoot = dirname(pkgRoot);
  }
  return pkgRoot;
}

/**
 * Exclusion fragments for discovery inside an external package's src/,
 * matched against paths RELATIVE TO the src dir. Per spec
 * external-package-file-discovery, the filters apply "within the package" —
 * an npm-installed package whose own location is under node_modules (or a
 * repo path containing 'dist') must still have its sources discovered.
 */
export const PACKAGE_SRC_EXCLUDES = [
  'dist',
  'node_modules',
  '.test.',
  '.spec.',
];

/**
 * What one declared include specifier produced, so callers can tell a package
 * that contributed sources apart from one that silently contributed nothing.
 * Collection itself never warns — reporting is the caller's policy.
 */
export interface ExternalPackageOutcome {
  /** The declared specifier, exactly as it appeared in the system file. */
  specifier: string;
  /**
   * - `resolved` — resolved to a package and accounted for at least one source
   * - `unresolvable` — specifier could not be resolved (skipped, per spec)
   * - `empty` — resolved to a package root but accounted for no sources
   */
  outcome: 'resolved' | 'unresolvable' | 'empty';
  /**
   * Source files this specifier accounted for in the analysis set: files it
   * contributed, plus files a previous specifier or the caller's own file set
   * already supplied (those are in the set, just not attributable to this
   * collection pass). Files skipped by `preprocessFile` or unreadable ones are
   * NOT counted — they never reach the analysis set.
   */
  fileCount: number;
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

/**
 * Resolve an absolute-path specifier (a relative `includes` entry already
 * resolved against the system file) without a bundler: the path itself when it
 * is a file, otherwise the extension and directory-index candidates built from
 * the caller's extension set. Used only as a fallback — a bundler resolver that
 * answers first still wins, since it also knows aliases and `.js`→`.ts` mapping.
 */
function resolveAbsolutePathSpecifier(
  absSpecifier: string,
  extensionsSet: ReadonlySet<string>
): string | null {
  const candidates = [
    absSpecifier,
    ...Array.from(extensionsSet, (ext) => absSpecifier + ext),
    ...Array.from(extensionsSet, (ext) => join(absSpecifier, `index${ext}`)),
  ];
  return candidates.find(isFile) ?? null;
}

export interface CollectedExternalPackages {
  /** New file entries (rootDir-relative, preprocessed) for the analysis set. */
  entries: Array<{ path: string; source: string }>;
  /** specifier → rootDir-relative module-resolution entry (src/index.ts when present). */
  packageMap: Record<string, string>;
  /** specifier → absolute src/index.ts path, only for packages with one. */
  sourceEntries: Map<string, string>;
  /** Absolute directories for bundler loader allowlisting (src/ or dist entry dir). */
  packageDirs: string[];
  /** Absolute package dir → owning specifier (cross-source correlation). */
  dirOwners: Record<string, string>;
  /** rootDir-relative file path → owning specifier, for files THIS collection
   *  pushed (first-contributing specifier wins; files the caller's own set
   *  already supplied stay unattributed — they are consumer-owned). */
  fileOwners: Record<string, string>;
  /** One record per declared specifier, in declaration order. */
  outcomes: ExternalPackageOutcome[];
}

/**
 * Shared external-package source collection (spec:
 * external-package-file-discovery), consumed by both extraction plugins.
 * For each specifier: resolve to an absolute entry (null/throw → silently
 * skip; an absolute-path specifier falls back to a filesystem probe), walk up
 * to the package root, then either discover sources under src/ (redirecting
 * module resolution to src/index.ts when present) or fall back to ingesting
 * the resolved entry file itself.
 *
 * The only bundler-specific seams are callbacks: specifier resolution,
 * dedup against already-ingested files, per-file preprocessing (MDX), and
 * the unreadable-file warning. Hashing and caching stay in the plugins —
 * their cache policies legitimately differ.
 *
 * Alongside the aggregates, one `ExternalPackageOutcome` per declared
 * specifier records what that specifier produced. Collection never reports on
 * them — any warning or gate is the caller's policy.
 */
export async function collectExternalPackageSources(opts: {
  specifiers: string[];
  /** Resolve a specifier to an absolute entry path; null (or a throw) skips it. */
  resolveSpecifier: (
    specifier: string
  ) => string | null | Promise<string | null>;
  rootDir: string;
  extensionsSet: ReadonlySet<string>;
  /** Does the caller's file set already contain this rootDir-relative path? */
  hasEntry: (relPath: string) => boolean;
  /**
   * Preprocess a discovered source (e.g. MDX→tsx with a path rewrite).
   * Return null to skip the file; return the input unchanged to pass through.
   */
  preprocessFile: (
    source: string,
    relPath: string,
    absPath: string
  ) => Promise<{ source: string; relPath: string } | null>;
  /** Called when a discovered file cannot be read; the file is skipped. */
  onUnreadable: (relPath: string, error: unknown) => void;
}): Promise<CollectedExternalPackages> {
  const {
    specifiers,
    resolveSpecifier,
    rootDir,
    extensionsSet,
    hasEntry,
    preprocessFile,
    onUnreadable,
  } = opts;

  const entries: Array<{ path: string; source: string }> = [];
  const pushed = new Set<string>();
  const packageMap: Record<string, string> = {};
  const sourceEntries = new Map<string, string>();
  const packageDirs: string[] = [];
  const dirOwners: Record<string, string> = {};
  const fileOwners: Record<string, string> = {};
  const outcomes: ExternalPackageOutcome[] = [];

  const alreadyIngested = (relPath: string): boolean =>
    hasEntry(relPath) || pushed.has(relPath);

  for (const specifier of specifiers) {
    let absEntry: string | null;
    try {
      absEntry = await resolveSpecifier(specifier);
    } catch {
      absEntry = null;
    }
    // A specifier that is already an absolute path is its own answer when the
    // bundler's resolver declines it (Node's resolver, for one, refuses
    // extensionless TS paths) — probe the filesystem before giving up.
    if (!absEntry && isAbsolute(specifier)) {
      absEntry = resolveAbsolutePathSpecifier(specifier, extensionsSet);
    }
    if (!absEntry) {
      // unresolvable → silently skip (spec). The outcome is recorded so a
      // caller can report it, but collection stays silent either way.
      outcomes.push({ specifier, outcome: 'unresolvable', fileCount: 0 });
      continue;
    }

    const pkgRoot = findPackageRoot(absEntry);
    const srcDir = join(pkgRoot, 'src');
    let fileCount = 0;

    if (existsSync(srcDir)) {
      packageDirs.push(srcDir);
      dirOwners[srcDir] ??= specifier;

      // Redirect module resolution to the source entry when present
      const srcEntry = join(srcDir, 'index.ts');
      if (existsSync(srcEntry)) {
        packageMap[specifier] = relative(rootDir, srcEntry);
        sourceEntries.set(specifier, srcEntry);
      } else {
        packageMap[specifier] = relative(rootDir, absEntry);
      }

      // Discover with no patterns, then exclude by package-relative path so
      // fragments in the package's own location can't blank out its sources.
      const pkgFiles = discoverFiles(srcDir, srcDir, [], extensionsSet).filter(
        (absPath) => {
          const inPkg = relative(srcDir, absPath);
          return !PACKAGE_SRC_EXCLUDES.some((pattern) =>
            inPkg.includes(pattern)
          );
        }
      );

      for (const pkgFile of pkgFiles) {
        const relPath = relative(rootDir, pkgFile);
        if (alreadyIngested(relPath)) {
          // Already in the analysis set — the specifier still accounts for it.
          fileCount++;
          continue;
        }

        let source: string;
        try {
          source = readFileSync(pkgFile, 'utf-8');
        } catch (err) {
          onUnreadable(relPath, err);
          continue;
        }

        const processed = await preprocessFile(source, relPath, pkgFile);
        if (!processed) continue;
        entries.push({ path: processed.relPath, source: processed.source });
        pushed.add(processed.relPath);
        fileOwners[processed.relPath] ??= specifier;
        fileCount++;
      }
    } else {
      // No src/ — fall back to the resolved (dist) entry file itself,
      // exempt from extension filters (spec: npm-installed scenario).
      packageDirs.push(dirname(absEntry));
      dirOwners[dirname(absEntry)] ??= specifier;
      const relPath = relative(rootDir, absEntry);
      packageMap[specifier] = relPath;

      if (alreadyIngested(relPath)) {
        fileCount++;
      } else {
        try {
          const source = readFileSync(absEntry, 'utf-8');
          entries.push({ path: relPath, source });
          pushed.add(relPath);
          fileOwners[relPath] ??= specifier;
          fileCount++;
        } catch (err) {
          onUnreadable(relPath, err);
        }
      }
    }

    outcomes.push({
      specifier,
      outcome: fileCount > 0 ? 'resolved' : 'empty',
      fileCount,
    });
  }

  return {
    entries,
    packageMap,
    sourceEntries,
    packageDirs,
    dirOwners,
    fileOwners,
    outcomes,
  };
}

/**
 * Extract external DS package names from inheritance declarations in the
 * system file.
 *
 * Supports three forms:
 *   - Primary:            `createSystem(...).from(identifier)` chain calls
 *                         (repeatable; each call contributes one source; a
 *                         library-bundle identifier traces its base import)
 *   - Deprecated alias:   `createSystem({ includes: [identifier, ...] })`
 *   - Legacy:             `.includes([identifier, ...])` chain method (RC
 *                         migration fallback)
 *
 * For each identifier found, traces back to its import declaration and returns
 * the import specifier: a bare specifier normalized to its package name, a
 * relative specifier resolved against the system file's directory into an
 * absolute path (so a sibling package referenced by path contributes discovery
 * too). Only packages explicitly declared through one of these forms are
 * treated as external DS dependencies.
 *
 * Falls back to empty array if no declaration is found.
 */
/**
 * The message for the strict/warn gate over unresolvable includes, or null
 * when every declared specifier resolved (external-package-file-discovery:
 * silence is never an outcome — non-strict consumers warn with this line,
 * strict consumers throw it).
 */
export function unresolvableIncludesMessage(
  outcomes: ExternalPackageOutcome[]
): string | null {
  const unresolvable = outcomes
    .filter((record) => record.outcome === 'unresolvable')
    .map((record) => record.specifier);
  if (unresolvable.length === 0) return null;
  return `[animus-extract] unresolvable include specifier(s): ${unresolvable.join(', ')}`;
}

export function extractSystemFilePackages(systemFilePath: string): string[] {
  let source: string;
  try {
    source = readFileSync(systemFilePath, 'utf-8');
  } catch {
    return [];
  }

  const identifiers = new Set<string>();

  // Primary form: createSystem({ includes: [...] }) — constructor arg
  // Non-greedy match on object body; captures identifiers inside the bracket list.
  const constructorRegex =
    /createSystem\s*\(\s*\{[^}]*?\bincludes\s*:\s*\[([^\]]*)\]/gs;

  // Legacy form: .includes([...]) — chain method (migration fallback)
  const chainRegex = /\.includes\s*\(\s*\[([^\]]*)\]\s*\)/gs;

  const collectIdentifiers = (regex: RegExp): void => {
    let match: RegExpExecArray | null;
    while ((match = regex.exec(source)) !== null) {
      const inner = match[1];
      for (const token of inner.split(',')) {
        const id = token.trim();
        if (id && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(id)) {
          identifiers.add(id);
        }
      }
    }
  };

  collectIdentifiers(constructorRegex);
  collectIdentifiers(chainRegex);

  // Primary form: createSystem(...).from(a).from(b) — the single inheritance
  // verb. Anchored to createSystem call chains: a bare `.from(` match would
  // also catch `createTheme().from(...)` in the same file and wrongly grant a
  // token-only package discovery membership (its component files would enter
  // extraction). Same matcher family as the regexes above: the anchor skips
  // the createSystem argument list with a paren-depth counter (no string
  // awareness — the `[^}]*?` tolerance level), then consumes consecutive
  // `.from(<identifier[.member]>)` links; a bundle passed as `kit` or
  // `kit.system` traces its base identifier's import either way.
  const createSystemAnchor = /createSystem\s*\(/g;
  const fromLink =
    /^\s*\.\s*from\s*\(\s*([a-zA-Z_$][a-zA-Z0-9_$]*)(?:\s*\.\s*[a-zA-Z_$][a-zA-Z0-9_$]*)*\s*\)/;
  let anchorMatch: RegExpExecArray | null;
  while ((anchorMatch = createSystemAnchor.exec(source)) !== null) {
    let pos = anchorMatch.index + anchorMatch[0].length;
    let depth = 1;
    while (pos < source.length && depth > 0) {
      const ch = source[pos];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      pos++;
    }
    let rest = source.slice(pos);
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = fromLink.exec(rest)) !== null) {
      identifiers.add(linkMatch[1]);
      rest = rest.slice(linkMatch[0].length);
    }
  }

  if (identifiers.size === 0) return [];

  // Build a map of local identifier → import specifier
  // Handles: import { a } from '...', import d from '...', import d, { a } from '...'
  const importMap = new Map<string, string>();
  const importRegex =
    /^\s*import\s+(?:([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,\s*)?(?:\{([^}]*)\}|([a-zA-Z_$][a-zA-Z0-9_$]*))\s+from\s+['"]([^'"]+)['"]/gm;

  let importMatch: RegExpExecArray | null;
  while ((importMatch = importRegex.exec(source)) !== null) {
    const [, comboDefault, namedImports, defaultImport, specifier] =
      importMatch;

    // Combined: import ds, { helper } from '...'
    if (comboDefault) {
      importMap.set(comboDefault, specifier);
    }

    // Standalone: import ds from '...'
    if (defaultImport) {
      importMap.set(defaultImport, specifier);
    }

    if (namedImports) {
      // Handle `{ ds as testDs, system }` patterns
      for (const binding of namedImports.split(',')) {
        const parts = binding.trim().split(/\s+as\s+/);
        const localName = (parts[1] || parts[0]).trim();
        if (localName) {
          importMap.set(localName, specifier);
        }
      }
    }
  }

  // Resolve identifiers used in .includes() to their package specifiers.
  // A relative specifier names a package by path rather than by name, so it
  // resolves against the system file's own directory into an absolute path —
  // the collector treats an absolute specifier as its own resolution.
  const systemFileDir = dirname(systemFilePath);
  const packages = new Set<string>();
  for (const id of identifiers) {
    const specifier = importMap.get(id);
    if (!specifier) continue;

    if (specifier.startsWith('.')) {
      packages.add(resolve(systemFileDir, specifier));
    } else {
      // Normalize to package name (strip subpath)
      const pkgName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      packages.add(pkgName);
    }
  }

  return Array.from(packages);
}
