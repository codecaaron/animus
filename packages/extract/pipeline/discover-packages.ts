import { existsSync, readFileSync } from 'fs';
import { dirname, join, relative } from 'path';

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

export interface CollectedExternalPackages {
  /** New file entries (rootDir-relative, preprocessed) for the analysis set. */
  entries: Array<{ path: string; source: string }>;
  /** specifier → rootDir-relative module-resolution entry (src/index.ts when present). */
  packageMap: Record<string, string>;
  /** specifier → absolute src/index.ts path, only for packages with one. */
  sourceEntries: Map<string, string>;
  /** Absolute directories for bundler loader allowlisting (src/ or dist entry dir). */
  packageDirs: string[];
}

/**
 * Shared external-package source collection (spec:
 * external-package-file-discovery), consumed by both extraction plugins.
 * For each specifier: resolve to an absolute entry (null/throw → silently
 * skip), walk up to the package root, then either discover sources under
 * src/ (redirecting module resolution to src/index.ts when present) or fall
 * back to ingesting the resolved entry file itself.
 *
 * The only bundler-specific seams are callbacks: specifier resolution,
 * dedup against already-ingested files, per-file preprocessing (MDX), and
 * the unreadable-file warning. Hashing and caching stay in the plugins —
 * their cache policies legitimately differ.
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

  const alreadyIngested = (relPath: string): boolean =>
    hasEntry(relPath) || pushed.has(relPath);

  for (const specifier of specifiers) {
    let absEntry: string | null;
    try {
      absEntry = await resolveSpecifier(specifier);
    } catch {
      absEntry = null;
    }
    if (!absEntry) continue; // unresolvable → silently skip (spec)

    const pkgRoot = findPackageRoot(absEntry);
    const srcDir = join(pkgRoot, 'src');

    if (existsSync(srcDir)) {
      packageDirs.push(srcDir);

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
        if (alreadyIngested(relPath)) continue;

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
      }
    } else {
      // No src/ — fall back to the resolved (dist) entry file itself,
      // exempt from extension filters (spec: npm-installed scenario).
      packageDirs.push(dirname(absEntry));
      const relPath = relative(rootDir, absEntry);
      packageMap[specifier] = relPath;

      if (!alreadyIngested(relPath)) {
        try {
          const source = readFileSync(absEntry, 'utf-8');
          entries.push({ path: relPath, source });
          pushed.add(relPath);
        } catch (err) {
          onUnreadable(relPath, err);
        }
      }
    }
  }

  return { entries, packageMap, sourceEntries, packageDirs };
}

/**
 * Extract external DS package names from `includes` declarations in the system file.
 *
 * Supports two forms:
 *   - Primary (1.0+):  `createSystem({ includes: [identifier, ...] })` constructor arg
 *   - Legacy:          `.includes([identifier, ...])` chain method (RC migration fallback)
 *
 * For each identifier found, traces back to its import declaration and returns
 * the import specifier. Only packages explicitly declared via `includes` are treated
 * as external DS dependencies.
 *
 * Falls back to empty array if no `includes` declaration is found.
 */
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

  // Resolve identifiers used in .includes() to their package specifiers
  const packages = new Set<string>();
  for (const id of identifiers) {
    const specifier = importMap.get(id);
    if (specifier && !specifier.startsWith('.')) {
      // Normalize to package name (strip subpath)
      const pkgName = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      packages.add(pkgName);
    }
  }

  return Array.from(packages);
}
