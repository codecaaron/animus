import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'path';

import { discoverFiles } from './discover-files';
import { isPathWithinRoot } from './source-identity';

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

export const PACKAGE_SRC_EXCLUDES = [
  'dist',
  'node_modules',
  '.test.',
  '.spec.',
];

export function isExcludedPackageRelativePath(rel: string): boolean {
  return PACKAGE_SRC_EXCLUDES.some((pattern) => rel.includes(pattern));
}

export function walkPackageSources(
  packageDir: string,
  extensionsSet: ReadonlySet<string>
): string[] {
  return discoverFiles(packageDir, packageDir, undefined, extensionsSet).filter(
    (absPath) => !isExcludedPackageRelativePath(relative(packageDir, absPath))
  );
}

const PACKAGE_OUTPUT_EXCLUDES = [
  'node_modules',
  '.test.',
  '.spec.',
  '.d.ts',
  '.map',
];

export interface ExternalPackageOutcome {
  specifier: string;
  outcome: 'resolved' | 'unresolvable' | 'empty' | 'stale-dist';
  fileCount: number;
}

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

export function resolveAbsolutePathSpecifier(
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

function bareSpecifierPackageName(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0];
}

function sourceEntryForSpecifier(
  specifier: string,
  srcDir: string,
  extensionsSet: ReadonlySet<string>
): string | null {
  if (isAbsolute(specifier)) {
    const resolved = resolveAbsolutePathSpecifier(specifier, extensionsSet);
    if (!resolved) return null;
    return isPathWithinRoot(srcDir, resolved) ? resolved : null;
  }
  const packageName = bareSpecifierPackageName(specifier);
  const subpath = specifier.slice(packageName.length + 1);
  const sourceStem = join(srcDir, subpath || 'index');
  return resolveAbsolutePathSpecifier(sourceStem, extensionsSet);
}

function distEntryIsStale(
  absEntry: string,
  srcDir: string,
  srcFiles: string[]
): boolean {
  if (isPathWithinRoot(srcDir, absEntry)) return false;
  let distMtime: number;
  try {
    distMtime = statSync(absEntry).mtimeMs;
  } catch {
    return false;
  }
  let newestSrcMtime = -Infinity;
  for (const srcFile of srcFiles) {
    try {
      newestSrcMtime = Math.max(newestSrcMtime, statSync(srcFile).mtimeMs);
    } catch {}
  }
  return distMtime < newestSrcMtime;
}

export interface CollectedExternalPackages {
  /** New file entries for the analysis set, at rootDir-relative paths. */
  entries: Array<{ path: string; source: string }>;
  /** specifier → rootDir-relative module-resolution entry. */
  packageMap: Record<string, string>;
  sourceEntries: Map<string, string>;
  /** Absolute directories for bundler loader allowlisting. */
  packageDirs: string[];
  /** Absolute package dir → every declared specifier that claimed it, in
   *  declaration order. `firstOwners` derives the single-value view. */
  dirOwnerSets: Record<string, string[]>;
  /** Absolute package dir → the exact extension list its walk used. Rewalking
   *  with the project default drops files the widened walk admitted. */
  dirExtensions: Record<string, string[]>;
  /** rootDir-relative path → the first specifier that contributed it. Files
   *  the caller's set already supplied stay unattributed. */
  fileOwners: Record<string, string>;
  outcomes: ExternalPackageOutcome[];
}

export async function collectExternalPackageSources(opts: {
  specifiers: string[];
  resolveSpecifier: (
    specifier: string
  ) => string | null | Promise<string | null>;
  rootDir: string;
  extensionsSet: ReadonlySet<string>;
  hasEntry: (relPath: string) => boolean;
  onSourceRead?: (source: string, relPath: string, absPath: string) => void;
  onUnreadable: <Thrown>(relPath: string, error: Thrown) => void;
  /** Called once per specifier after its package dir is derived and BEFORE
   *  its sources are walked, so a host can watch with no blind gap. */
  onPackageResolved?: (specifier: string, packageDir: string) => void;
}): Promise<CollectedExternalPackages> {
  const {
    specifiers,
    resolveSpecifier,
    rootDir,
    extensionsSet,
    hasEntry,
    onSourceRead,
    onUnreadable,
    onPackageResolved,
  } = opts;

  const entries: Array<{ path: string; source: string }> = [];
  const pushed = new Set<string>();
  const packageMap: Record<string, string> = {};
  const sourceEntries = new Map<string, string>();
  const packageDirs: string[] = [];
  const dirOwnerSets: Record<string, string[]> = {};
  const dirExtensions: Record<string, string[]> = {};
  const fileOwners: Record<string, string> = {};
  const outcomes: ExternalPackageOutcome[] = [];

  const claimDir = (dir: string, specifier: string): void => {
    (dirOwnerSets[dir] ??= []).push(specifier);
  };

  const alreadyIngested = (relPath: string): boolean =>
    hasEntry(relPath) || pushed.has(relPath);

  for (const specifier of specifiers) {
    let absEntry: string | null;
    try {
      absEntry = await resolveSpecifier(specifier);
    } catch {
      absEntry = null;
    }
    // Node's resolver refuses extensionless TS paths, so an absolute specifier
    // it declines is probed on the filesystem before giving up.
    if (!absEntry && isAbsolute(specifier)) {
      absEntry = resolveAbsolutePathSpecifier(specifier, extensionsSet);
    }
    if (!absEntry) {
      outcomes.push({ specifier, outcome: 'unresolvable', fileCount: 0 });
      continue;
    }

    const pkgRoot = findPackageRoot(absEntry);
    const srcDir = join(pkgRoot, 'src');
    let fileCount = 0;
    let staleDist = false;

    if (existsSync(srcDir)) {
      packageDirs.push(srcDir);
      claimDir(srcDir, specifier);
      dirExtensions[srcDir] = [...extensionsSet];
      onPackageResolved?.(specifier, srcDir);

      const srcEntry = sourceEntryForSpecifier(
        specifier,
        srcDir,
        extensionsSet
      );
      if (srcEntry) {
        packageMap[specifier] = relative(rootDir, srcEntry);
        sourceEntries.set(specifier, srcEntry);
      } else {
        packageMap[specifier] = relative(rootDir, absEntry);
      }

      // App code imports a kit declared at a subpath by its package root; with
      // no root key the src redirect is bypassed and untransformed dist ships.
      if (!isAbsolute(specifier)) {
        const packageName = bareSpecifierPackageName(specifier);
        if (packageName !== specifier && !(packageName in packageMap)) {
          const rootEntry = sourceEntryForSpecifier(
            packageName,
            srcDir,
            extensionsSet
          );
          if (rootEntry) {
            packageMap[packageName] = relative(rootDir, rootEntry);
            sourceEntries.set(packageName, rootEntry);
          }
        }
      }

      const pkgFiles = walkPackageSources(srcDir, extensionsSet);

      staleDist = distEntryIsStale(absEntry, srcDir, pkgFiles);

      for (const pkgFile of pkgFiles) {
        const relPath = relative(rootDir, pkgFile);
        if (alreadyIngested(relPath)) {
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

        onSourceRead?.(source, relPath, pkgFile);
        entries.push({ path: relPath, source });
        pushed.add(relPath);
        fileOwners[relPath] ??= specifier;
        fileCount++;
      }
    } else {
      const outputDir = dirname(absEntry);
      packageDirs.push(outputDir);
      claimDir(outputDir, specifier);
      onPackageResolved?.(specifier, outputDir);
      const relPath = relative(rootDir, absEntry);
      packageMap[specifier] = relPath;

      const outputExtensions = new Set(extensionsSet);
      outputExtensions.add(extname(absEntry));
      dirExtensions[outputDir] = [...outputExtensions];
      const outputFiles = discoverFiles(
        outputDir,
        outputDir,
        undefined,
        outputExtensions
      ).filter((file) => {
        const relToOutput = relative(outputDir, file);
        return !PACKAGE_OUTPUT_EXCLUDES.some((pattern) =>
          relToOutput.includes(pattern)
        );
      });
      if (!outputFiles.includes(absEntry)) outputFiles.unshift(absEntry);

      for (const outputFile of outputFiles) {
        const outputRelPath = relative(rootDir, outputFile);
        if (alreadyIngested(outputRelPath)) {
          fileCount++;
          continue;
        }
        let source: string;
        try {
          source = readFileSync(outputFile, 'utf-8');
        } catch (err) {
          onUnreadable(outputRelPath, err);
          continue;
        }
        onSourceRead?.(source, outputRelPath, outputFile);
        entries.push({ path: outputRelPath, source });
        pushed.add(outputRelPath);
        fileOwners[outputRelPath] ??= specifier;
        fileCount++;
      }
    }

    outcomes.push({
      specifier,
      outcome: staleDist ? 'stale-dist' : fileCount > 0 ? 'resolved' : 'empty',
      fileCount,
    });
  }

  return {
    entries,
    packageMap,
    sourceEntries,
    packageDirs,
    dirOwnerSets,
    dirExtensions,
    fileOwners,
    outcomes,
  };
}

export interface PackageDirOwners {
  [packageDir: string]: string;
}

export function firstOwners(
  dirOwnerSets: Record<string, string[]>
): PackageDirOwners {
  const owners: PackageDirOwners = {};
  for (const [dir, specifiers] of Object.entries(dirOwnerSets)) {
    if (specifiers.length > 0) owners[dir] = specifiers[0];
  }
  return owners;
}

export function excludeCollectedPackages(
  collected: CollectedExternalPackages,
  rejectedSpecifiers: ReadonlySet<string>,
  rootDir: string
): CollectedExternalPackages {
  if (rejectedSpecifiers.size === 0) return collected;

  const rejectedDirs = Object.entries(collected.dirOwnerSets)
    .filter(([, specs]) => specs.every((s) => rejectedSpecifiers.has(s)))
    .map(([dir]) => dir);
  const underRejectedDir = (absPath: string): boolean =>
    rejectedDirs.some((dir) => isPathWithinRoot(dir, absPath));
  const targetRejected = (specifier: string, absTarget: string): boolean =>
    rejectedSpecifiers.has(specifier) || underRejectedDir(absTarget);

  const packageMap: Record<string, string> = {};
  for (const [specifier, relTarget] of Object.entries(collected.packageMap)) {
    if (targetRejected(specifier, resolve(rootDir, relTarget))) continue;
    packageMap[specifier] = relTarget;
  }
  const sourceEntries = new Map<string, string>();
  for (const [specifier, absEntry] of collected.sourceEntries) {
    if (targetRejected(specifier, absEntry)) continue;
    sourceEntries.set(specifier, absEntry);
  }
  const dirOwnerSets: Record<string, string[]> = {};
  for (const [dir, specs] of Object.entries(collected.dirOwnerSets)) {
    const kept = specs.filter((s) => !rejectedSpecifiers.has(s));
    if (kept.length === 0) continue;
    dirOwnerSets[dir] = kept;
  }
  const dirExtensions: Record<string, string[]> = {};
  for (const [dir, exts] of Object.entries(collected.dirExtensions)) {
    if (rejectedDirs.includes(dir)) continue;
    dirExtensions[dir] = exts;
  }
  const fileOwners: Record<string, string> = {};
  for (const [relPath, owner] of Object.entries(collected.fileOwners)) {
    if (rejectedSpecifiers.has(owner)) continue;
    fileOwners[relPath] = owner;
  }

  return {
    entries: collected.entries.filter(
      (entry) => !rejectedSpecifiers.has(collected.fileOwners[entry.path])
    ),
    packageMap,
    sourceEntries,
    packageDirs: collected.packageDirs.filter(
      (dir) => !rejectedDirs.includes(dir)
    ),
    dirOwnerSets,
    dirExtensions,
    fileOwners,
    outcomes: collected.outcomes,
  };
}

export function unresolvableIncludesMessage(
  outcomes: ExternalPackageOutcome[]
): string | null {
  const unresolvable = outcomes
    .filter((record) => record.outcome === 'unresolvable')
    .map((record) => record.specifier);
  if (unresolvable.length === 0) return null;
  return `[animus-extract] unresolvable include specifier(s): ${unresolvable.join(', ')}`;
}

/** A stale dist silently skews merged registry content while discovery
 *  compiles the fresh sources; null when no specifier is stale. */
export function staleDistIncludesMessage(
  outcomes: ExternalPackageOutcome[]
): string | null {
  const stale = outcomes
    .filter((record) => record.outcome === 'stale-dist')
    .map((record) => record.specifier);
  if (stale.length === 0) return null;
  return `[animus-extract] stale dist for include specifier(s): ${stale.join(', ')} — dist entry is older than the newest src/ file; rebuild the package(s) before extracting`;
}

export function extractSystemFilePackages(systemFilePath: string): string[] {
  let source: string;
  try {
    source = readFileSync(systemFilePath, 'utf-8');
  } catch {
    return [];
  }

  const identifiers = new Set<string>();

  const constructorRegex =
    /createSystem\s*\(\s*\{[^}]*?\bincludes\s*:\s*\[([^\]]*)\]/gs;

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

  const IDENT_START_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*/;

  const skipTrivia = (from: number): number => {
    let pos = from;
    for (;;) {
      while (pos < source.length && /\s/.test(source[pos])) pos++;
      if (source.startsWith('//', pos)) {
        const newline = source.indexOf('\n', pos);
        pos = newline === -1 ? source.length : newline + 1;
        continue;
      }
      if (source.startsWith('/*', pos)) {
        const close = source.indexOf('*/', pos + 2);
        pos = close === -1 ? source.length : close + 2;
        continue;
      }
      return pos;
    }
  };

  const consumeChainLinks = (from: number): number => {
    let pos = from;
    for (;;) {
      let cursor = skipTrivia(pos);
      if (source[cursor] !== '.') return pos;
      cursor = skipTrivia(cursor + 1);
      const method = IDENT_START_RE.exec(source.slice(cursor))?.[0];
      if (method !== 'extend' && method !== 'from') return pos;
      cursor = skipTrivia(cursor + method.length);
      if (source[cursor] !== '(') return pos;
      cursor = skipTrivia(cursor + 1);
      const base = IDENT_START_RE.exec(source.slice(cursor))?.[0];
      if (!base) return pos;
      cursor = skipTrivia(cursor + base.length);
      while (source[cursor] === '.') {
        const afterDot = skipTrivia(cursor + 1);
        const segment = IDENT_START_RE.exec(source.slice(afterDot))?.[0];
        if (!segment) break;
        cursor = skipTrivia(afterDot + segment.length);
      }
      if (source[cursor] === ',') cursor = skipTrivia(cursor + 1);
      if (source[cursor] !== ')') return pos;
      identifiers.add(base);
      pos = cursor + 1;
    }
  };

  const boundIdentifierBefore = (index: number): string | null => {
    const match = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*$/.exec(
      source.slice(0, index)
    );
    return match ? match[1] : null;
  };

  const chainRootIdentifiers = new Set<string>();

  const createSystemAnchor = /createSystem\s*\(/g;
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
    consumeChainLinks(pos);
    const bound = boundIdentifierBefore(anchorMatch.index);
    if (bound) chainRootIdentifiers.add(bound);
  }

  const scannedRoots = new Set<string>();
  for (;;) {
    const pendingRoots = [...chainRootIdentifiers].filter(
      (root) => !scannedRoots.has(root)
    );
    if (pendingRoots.length === 0) break;
    for (const root of pendingRoots) {
      scannedRoots.add(root);
      const rootUse = new RegExp(
        `(?<![a-zA-Z0-9_$])${root.replace(/\$/g, '\\$')}(?![a-zA-Z0-9_$])`,
        'g'
      );
      let useMatch: RegExpExecArray | null;
      while ((useMatch = rootUse.exec(source)) !== null) {
        const afterIdentifier = useMatch.index + useMatch[0].length;
        if (consumeChainLinks(afterIdentifier) === afterIdentifier) continue;
        const bound = boundIdentifierBefore(useMatch.index);
        if (bound) chainRootIdentifiers.add(bound);
      }
    }
  }

  if (identifiers.size === 0) return [];

  const importMap = new Map<string, string>();
  const importRegex =
    /^\s*import\s+(?:([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,\s*)?(?:\{([^}]*)\}|([a-zA-Z_$][a-zA-Z0-9_$]*))\s+from\s+['"]([^'"]+)['"]/gm;

  let importMatch: RegExpExecArray | null;
  while ((importMatch = importRegex.exec(source)) !== null) {
    const [, comboDefault, namedImports, defaultImport, specifier] =
      importMatch;

    if (comboDefault) {
      importMap.set(comboDefault, specifier);
    }

    if (defaultImport) {
      importMap.set(defaultImport, specifier);
    }

    if (namedImports) {
      for (const binding of namedImports.split(',')) {
        const parts = binding.trim().split(/\s+as\s+/);
        const localName = (parts[1] || parts[0]).trim();
        if (localName) {
          importMap.set(localName, specifier);
        }
      }
    }
  }

  const systemFileDir = dirname(systemFilePath);
  const packages = new Set<string>();
  for (const id of identifiers) {
    const specifier = importMap.get(id);
    if (!specifier) continue;

    if (specifier.startsWith('.')) {
      packages.add(resolve(systemFileDir, specifier));
    } else {
      // Preserve the imported subpath: collapsing `@scope/kit/definition` to
      // the package root can make a subpath-only export unresolvable.
      packages.add(specifier);
    }
  }

  return Array.from(packages);
}
