import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'path';

import { globToRegExp } from './core-options';
import { discoverFiles } from './discover-files';
import { parseInternalWire } from './internal-wire';
import { isPathWithinRoot } from './source-identity';
import { isJsonBlock, isJsonString } from './tsconfig-paths';

import type { EngineApi } from './engine-adapter';
import type { ExtractFactsResult, ExtractImportFact } from './source-ingestion';
import type { JsonValue } from './tsconfig-paths';

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

/**
 * A package's `sideEffects` field, decoded the way Vite reads it: a boolean
 * as written, or the list's globs, one with no `/` matching the basename
 * anywhere and any other rooted at the package. Undefined without a readable
 * field, or with glob syntax this matcher lacks (braces, classes, negation,
 * extglobs), which leaves the bundler's side-effectful default.
 */
function readPackageSideEffects(
  pkgRoot: string
): boolean | RegExp[] | undefined {
  let manifest: JsonValue;
  try {
    manifest = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8'));
  } catch {
    return undefined;
  }
  const field = isJsonBlock(manifest) ? manifest.sideEffects : undefined;
  if (field === true || field === false) return field;
  if (!Array.isArray(field)) return undefined;
  const globs = field.filter(isJsonString);
  if (globs.some((glob) => /[{}[\]()!+@]/.test(glob))) return undefined;
  return globs.map((glob) =>
    globToRegExp(glob.includes('/') ? glob.replace(/^\.?\//, '') : `**/${glob}`)
  );
}

function matchesSideEffects(
  globs: readonly RegExp[],
  pkgRoot: string,
  absFiles: readonly string[]
): boolean {
  return absFiles.some((file) => {
    const relPath = relative(pkgRoot, file).split(sep).join('/');
    return globs.some((glob) => glob.test(relPath));
  });
}

/** An exports target under the `import` condition, then `default`, as the
 *  system loader reads it; an array offers its targets in order. */
function exportTarget(value: JsonValue | undefined): string | null {
  if (isJsonString(value)) return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const target = exportTarget(entry);
      if (target !== null) return target;
    }
    return null;
  }
  if (!isJsonBlock(value)) return null;
  return exportTarget(value.import) ?? exportTarget(value.default);
}

/** Each exact `exports` entry of the package at `pkgRoot`, as its subpath
 *  and absolute target; `*` patterns name no single file and are skipped. */
function packageExportEntries(pkgRoot: string): Array<[string, string]> {
  let manifest: JsonValue;
  try {
    manifest = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8'));
  } catch {
    return [];
  }
  const exports = isJsonBlock(manifest) ? manifest.exports : undefined;
  if (exports === undefined || exports === null) return [];
  const subpaths =
    isJsonBlock(exports) && Object.keys(exports).some((k) => k.startsWith('.'))
      ? exports
      : { '.': exports };
  const entries: Array<[string, string]> = [];
  for (const [subpath, value] of Object.entries(subpaths)) {
    if (!subpath.startsWith('.') || subpath.includes('*')) continue;
    const target = exportTarget(value);
    if (target !== null) entries.push([subpath, resolve(pkgRoot, target)]);
  }
  return entries;
}

/** Installed content is release content, and unpacking can leave any file
 *  times, so only a package whose real path is outside `node_modules`, such
 *  as a workspace link, is judged stale by them. */
function isInstalledPackage(pkgRoot: string): boolean {
  let realRoot = pkgRoot;
  try {
    realRoot = realpathSync(pkgRoot);
  } catch {}
  return realRoot.split(/[\\/]/).includes('node_modules');
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
  /** specifier → its source entry's side effects, from the owning package's
   *  `sideEffects`. The source entry stands in for the entry it replaces, so
   *  either path matching a listed glob keeps side effects, and a list with
   *  no replaced entry to carry keeps them too. Absent when the package
   *  declares nothing. */
  sourceEntrySideEffects: Map<string, boolean>;
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
  const sourceEntrySideEffects = new Map<string, boolean>();
  /** `replaced` names the entry the redirect stands in for; it is only
   *  needed, and so only resolved, for a glob list. */
  const redirect = async (
    specifier: string,
    srcEntry: string,
    pkgRoot: string,
    replaced: () => Promise<string | null>
  ): Promise<void> => {
    sourceEntries.set(specifier, srcEntry);
    const field = readPackageSideEffects(pkgRoot);
    if (field === undefined) return;
    if (field === true || field === false) {
      sourceEntrySideEffects.set(specifier, field);
      return;
    }
    // A list names the files the package ships, so it classifies the source
    // entry only through the entry it stands in for. With no such entry the
    // mapping is unproven, and the entry stays side-effectful.
    const replacedEntry = await replaced();
    sourceEntrySideEffects.set(
      specifier,
      replacedEntry === null ||
        matchesSideEffects(field, pkgRoot, [srcEntry, replacedEntry])
    );
  };
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
        const replaced = absEntry;
        await redirect(specifier, srcEntry, pkgRoot, async () => replaced);
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
            await redirect(packageName, rootEntry, pkgRoot, async () => {
              try {
                return await resolveSpecifier(packageName);
              } catch {
                return null;
              }
            });
          }
        }
      }

      const pkgFiles = walkPackageSources(srcDir, extensionsSet);

      staleDist =
        !isInstalledPackage(pkgRoot) &&
        distEntryIsStale(absEntry, srcDir, pkgFiles);

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

    // App code imports a package by any of its export entries, often its
    // root, while only the include specifier was mapped above. An entry whose
    // target was analysed maps there too, so its bindings resolve, as they do
    // for a source install through its root redirect.
    if (!isAbsolute(specifier)) {
      const packageName = bareSpecifierPackageName(specifier);
      for (const [subpath, target] of packageExportEntries(pkgRoot)) {
        const entrySpecifier = packageName + subpath.slice(1);
        const targetRelPath = relative(rootDir, target);
        if (entrySpecifier in packageMap || !alreadyIngested(targetRelPath)) {
          continue;
        }
        packageMap[entrySpecifier] = targetRelPath;
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
    sourceEntrySideEffects,
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
  const sourceEntrySideEffects = new Map<string, boolean>();
  for (const [specifier, absEntry] of collected.sourceEntries) {
    if (targetRejected(specifier, absEntry)) continue;
    sourceEntries.set(specifier, absEntry);
    const sideEffects = collected.sourceEntrySideEffects.get(specifier);
    if (sideEffects !== undefined) {
      sourceEntrySideEffects.set(specifier, sideEffects);
    }
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
    sourceEntrySideEffects,
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

/** A module's parsed import bindings, or null when it cannot be parsed. */
export type ImportParser = (
  source: string,
  path: string
) => readonly ExtractImportFact[] | null;

/** The engine's own parse of a module's imports, through its
 *  `extractFacts`; undefined for an engine without one. A parse that
 *  panicked reports no imports, so it counts as no parse. */
export function engineImportParser(
  engine: Pick<EngineApi, 'extractFacts'>
): ImportParser | undefined {
  const { extractFacts } = engine;
  if (!extractFacts) return undefined;
  return (source, path) => {
    try {
      const facts = parseInternalWire<ExtractFactsResult>(
        extractFacts(JSON.stringify([{ path, source }])),
        'extractFacts'
      ).files[path];
      return facts && !facts.parsePanicked ? facts.imports : null;
    } catch {
      return null;
    }
  };
}

/** A pattern matching a call of any of `callees` as a whole name, or null
 *  when there is none to anchor on. */
function rootCallPattern(callees: readonly string[]): string | null {
  if (callees.length === 0) return null;
  const names = callees.map((callee) => callee.replace(/[.$]/g, '\\$&'));
  return `(?<![a-zA-Z0-9_$.])(?:${names.join('|')})`;
}

export function extractSystemFilePackages(
  systemFilePath: string,
  parseImports?: ImportParser
): string[] {
  let source: string;
  try {
    source = readFileSync(systemFilePath, 'utf-8');
  } catch {
    return [];
  }

  // A parse that reports no imports names no kit, so the spelling path
  // decides, as without a parse.
  const parsed = parseImports?.(source, systemFilePath) ?? null;
  const parsedImports = parsed && parsed.length > 0 ? parsed : null;
  let rootCall: string | null = 'createSystem';
  if (parsedImports) {
    // The roots are the local names an import binds `createSystem` to:
    // Animus's export, renamed or not, or a module re-exporting it, which
    // is not followed. The parse omits namespace imports, so those are read
    // from their syntax. The bare name also anchors, as a global or a
    // destructured binding, unless the file binds it to something else.
    const shadowed =
      parsedImports.some(
        (binding) =>
          binding.local === 'createSystem' &&
          binding.imported !== 'createSystem'
      ) ||
      /\b(?:function\*?|class)\s+createSystem\b|\b(?:const|let|var)\s+createSystem\b/.test(
        source
      );
    const roots = new Set([
      ...parsedImports
        .filter((binding) => binding.imported === 'createSystem')
        .map((binding) => binding.local),
      ...Array.from(
        source.matchAll(
          /\bimport\s+(?:[a-zA-Z_$][a-zA-Z0-9_$]*\s*,\s*)?\*\s*as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+from\s+['"]@animus-ui\/system(?:\/[^'"]*)?['"]/g
        ),
        (match) => `${match[1]}.createSystem`
      ),
      ...(shadowed ? [] : ['createSystem']),
    ]);
    rootCall = rootCallPattern([...roots]);
  }

  const identifiers = new Set<string>();

  const constructorRegex =
    rootCall === null
      ? null
      : new RegExp(
          `${rootCall}\\s*\\(\\s*\\{[^}]*?\\bincludes\\s*:\\s*\\[([^\\]]*)\\]`,
          'gs'
        );

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

  if (constructorRegex) collectIdentifiers(constructorRegex);
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

  /** The index after the string literal opening at `from`. */
  const skipString = (from: number): number => {
    const quote = source[from];
    let pos = from + 1;
    while (pos < source.length && source[pos] !== quote) {
      pos += source[pos] === '\\' ? 2 : 1;
    }
    return pos + 1;
  };

  /** The index after the bracketed span opening at `from`, balanced across
   *  `<>`, `()`, `[]` and `{}`, or -1 when it never closes. An arrow type's
   *  `=>` closes nothing. */
  const skipBalanced = (from: number): number => {
    let depth = 0;
    let pos = from;
    while (pos < source.length) {
      const ch = source[pos];
      if (ch === "'" || ch === '"' || ch === '`') {
        pos = skipString(pos);
        continue;
      }
      if (source.startsWith('//', pos) || source.startsWith('/*', pos)) {
        pos = skipTrivia(pos);
        continue;
      }
      if ('<([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch) || (ch === '>' && source[pos - 1] !== '=')) {
        depth--;
        if (depth === 0) return pos + 1;
      }
      pos++;
    }
    return -1;
  };

  // Primary form: createSystem(...).extend(a); `.from(a)` is its deprecated
  // spelling. Chains are followed only from a createSystem anchor, so
  // `createTheme().extend()` grants no membership.
  const consumeChainLinks = (from: number): number => {
    let pos = from;
    for (;;) {
      let cursor = skipTrivia(pos);
      if (source[cursor] !== '.') return pos;
      cursor = skipTrivia(cursor + 1);
      const method = IDENT_START_RE.exec(source.slice(cursor))?.[0];
      if (method !== 'extend' && method !== 'from') return pos;
      cursor = skipTrivia(cursor + method.length);
      // Type arguments do not change the runtime inheritance edge.
      if (source[cursor] === '<') {
        const afterTypeArguments = skipBalanced(cursor);
        if (afterTypeArguments === -1) return pos;
        cursor = skipTrivia(afterTypeArguments);
      }
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

  // Every `const`/`let`/`var` binding by where its initializer starts, so a
  // type annotation (`const ds: AppSystem = …`) still names the binding, and
  // a binding whose initializer is a bare identifier records a local alias.
  const bindingAt = new Map<number, string>();
  const aliasOf = new Map<string, string>();
  const declarationRe = /\b(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
  let declaration: RegExpExecArray | null;
  while ((declaration = declarationRe.exec(source)) !== null) {
    const name = declaration[1];
    let cursor = skipTrivia(declaration.index + declaration[0].length);
    if (source[cursor] === ':') {
      // Skip the annotation to its top-level `=`; a `;` or `,` there, or a
      // line that opens another declaration, means it has no initializer.
      cursor++;
      while (cursor < source.length) {
        const ch = source[cursor];
        if (ch === ';' || ch === ',') break;
        if (
          ch === '\n' &&
          /^\s*(?:export\s+)?(?:const|let|var|function|class|type|interface|import)\b/.test(
            source.slice(cursor + 1, cursor + 80)
          )
        ) {
          break;
        }
        if (ch === '=' && source[cursor + 1] !== '>') break;
        if ('<([{'.includes(ch) || ch === "'" || ch === '"' || ch === '`') {
          const after = '<([{'.includes(ch)
            ? skipBalanced(cursor)
            : skipString(cursor);
          if (after === -1) break;
          cursor = after;
          continue;
        }
        cursor = ch === '=' ? cursor + 2 : cursor + 1;
      }
    }
    if (source[cursor] !== '=' || source[cursor + 1] === '=') continue;
    const initializer = skipTrivia(cursor + 1);
    bindingAt.set(initializer, name);
    const target = IDENT_START_RE.exec(source.slice(initializer))?.[0];
    if (!target) continue;
    // `const base = kit;` and `const base = kit as KitSystem` are aliases;
    // `const base = kit\n  .extend(…)` and `kit.system` are not.
    const rest = source.slice(initializer + target.length);
    if (
      /^[ \t]*(?:(?:as|satisfies)\s[^;\n]*)?(?:\/\/[^\n]*)?(?:;|\r?\n(?!\s*[.([?`])|$)/.test(
        rest
      )
    ) {
      aliasOf.set(name, target);
    }
  }

  const boundIdentifierBefore = (index: number): string | null => {
    const declared = bindingAt.get(index);
    if (declared) return declared;
    const match = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*$/.exec(
      source.slice(0, index)
    );
    return match ? match[1] : null;
  };

  const chainRootIdentifiers = new Set<string>();

  const createSystemAnchor =
    rootCall === null ? null : new RegExp(`${rootCall}\\s*\\(`, 'g');
  let anchorMatch: RegExpExecArray | null;
  while ((anchorMatch = createSystemAnchor?.exec(source) ?? null) !== null) {
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
  for (const binding of parsedImports ?? []) {
    importMap.set(binding.local, binding.source);
  }
  const importRegex =
    /^\s*import\s+(?:([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,\s*)?(?:\{([^}]*)\}|([a-zA-Z_$][a-zA-Z0-9_$]*))\s+from\s+['"]([^'"]+)['"]/gm;

  // Without a parse, the import table is read from its syntax.
  if (!parsedImports) {
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
  }

  const systemFileDir = dirname(systemFilePath);
  const packages = new Set<string>();
  /** The import a local alias chain ends at, or the identifier itself. */
  const throughAliases = (id: string): string => {
    const seen = new Set<string>();
    let current = id;
    while (!importMap.has(current) && !seen.has(current)) {
      seen.add(current);
      const target = aliasOf.get(current);
      if (!target) break;
      current = target;
    }
    return current;
  };

  for (const id of identifiers) {
    const specifier = importMap.get(throughAliases(id));
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
