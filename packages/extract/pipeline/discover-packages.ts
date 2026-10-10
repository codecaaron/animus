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
import { readKitDescriptor } from './kit-descriptor';
import {
  INVALID_KIT_SOURCE_CONDITION,
  KIT_SYSTEM_NOT_INCLUDED,
  KIT_WITHOUT_SOURCE_CONDITION,
  noKitFilesDiagnostics,
  severityFor,
  UNIMPORTED_CREATE_SYSTEM,
  UNPROVEN_ROOT_BINDING,
} from './manifest-diagnostics';
import { isEngineTransformExtension } from './mdx-preprocessor';
import { isPathWithinRoot } from './source-identity';
import { relativeSourceCandidates } from './source-ingestion';
import { isJsonBlock, isJsonString } from './tsconfig-paths';

import type { EngineApi } from './engine-adapter';
import type { KitDescriptorRecord } from './kit-descriptor';
import type { ManifestDiagnostic } from './manifest-diagnostics';
import type {
  ExtractExportFact,
  ExtractFactsResult,
  ExtractImportFact,
} from './source-ingestion';
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

/** The package a bare specifier names: `@scope/name` or `name`. */
export function bareSpecifierPackageName(specifier: string): string {
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

/** The package's parsed `package.json`, or null when it cannot be read. */
function readPackageManifest(pkgRoot: string): JsonValue | null {
  try {
    return JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8'));
  } catch {
    return null;
  }
}

/** Each `exports` subpath and its value; a bare target or condition object
 *  is the `.` entry. */
export function exportsSubpaths(
  manifest: JsonValue | null
): Array<[string, JsonValue]> {
  const exports = isJsonBlock(manifest) ? manifest.exports : undefined;
  if (exports === undefined || exports === null) return [];
  const subpaths =
    isJsonBlock(exports) && Object.keys(exports).some((k) => k.startsWith('.'))
      ? exports
      : { '.': exports };
  return Object.entries(subpaths).filter(([subpath]) =>
    subpath.startsWith('.')
  );
}

/**
 * The export condition a kit gives each public entry's original source:
 * `{ "types": …, "animus": "./src/system.ts", "import": …, "default": … }`.
 * Hosts never resolve through it; discovery reads it, redirects the entry to
 * its source in every host, and the system loader prefers it.
 */
export const KIT_SOURCE_CONDITION = 'animus';

export interface KitSourceCondition {
  /** Each exact entry that declares the condition: its subpath and its
   *  absolute source file. */
  entries: Array<[subpath: string, target: string]>;
  /** Entries whose target is missing or outside the package. */
  invalid: Array<[subpath: string, target: string]>;
  /** The deepest directory holding every source entry: what discovery walks.
   *  Null when no entry is valid. */
  root: string | null;
}

/** The package's kit source condition, or null when no exact `exports`
 *  entry declares it: the package is no source kit. */
export function readKitSourceCondition(
  pkgRoot: string
): KitSourceCondition | null {
  const condition: KitSourceCondition = {
    entries: [],
    invalid: [],
    root: null,
  };
  for (const [subpath, value] of exportsSubpaths(
    readPackageManifest(pkgRoot)
  )) {
    if (subpath.includes('*') || !isJsonBlock(value)) continue;
    const target = value[KIT_SOURCE_CONDITION];
    if (!isJsonString(target)) continue;
    const file = resolve(pkgRoot, target);
    if (isPathWithinRoot(pkgRoot, file) && isFile(file)) {
      condition.entries.push([subpath, file]);
    } else {
      condition.invalid.push([subpath, target]);
    }
  }
  if (condition.entries.length === 0 && condition.invalid.length === 0)
    return null;
  condition.root = condition.entries.reduce<string | null>(
    (root, [, file]) =>
      root === null ? dirname(file) : commonDirectory(root, dirname(file)),
    null
  );
  return condition;
}

function commonDirectory(a: string, b: string): string {
  let dir = a;
  while (!isPathWithinRoot(dir, b)) dir = dirname(dir);
  return dir;
}

/** Whether the manifest at `dir` names the package `name`. */
function isPackageNamed(dir: string, name: string | null): boolean {
  const manifest = readPackageManifest(dir);
  return isJsonBlock(manifest) && manifest.name === name;
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** The root of the installed package `name` as Node finds it from `fromDir`,
 *  the first `node_modules/<name>` up the directory tree, at its real path,
 *  as host resolvers report a linked package. */
function locatePackageRoot(name: string, fromDir: string): string | null {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realPath(candidate);
    if (dir === dirname(dir)) return null;
  }
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
  const manifest = readPackageManifest(pkgRoot);
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
  const entries: Array<[string, string]> = [];
  for (const [subpath, value] of exportsSubpaths(
    readPackageManifest(pkgRoot)
  )) {
    if (subpath.includes('*')) continue;
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
  /** Those of `packageDirs` whose package is linked rather than installed:
   *  its real path is outside `node_modules`, so its source can change in
   *  place. */
  linkedDirs: string[];
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
  /** A kit without the source condition, a condition entry whose target is
   *  missing or outside its package, and a kit that yielded no files. */
  diagnostics: ManifestDiagnostic[];
  /** Each resolved package's kit descriptor, once per package root. */
  kitDescriptors: KitDescriptorRecord[];
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
  const linkedDirs: string[] = [];
  const dirOwnerSets: Record<string, string[]> = {};
  const dirExtensions: Record<string, string[]> = {};
  const fileOwners: Record<string, string> = {};
  const outcomes: ExternalPackageOutcome[] = [];

  const claimDir = (dir: string, specifier: string): void => {
    (dirOwnerSets[dir] ??= []).push(specifier);
  };

  const alreadyIngested = (relPath: string): boolean =>
    hasEntry(relPath) || pushed.has(relPath);

  /** Adds `file` to the analysis set unless it is there; false when it
   *  cannot be read. */
  const ingest = (file: string, specifier: string): boolean => {
    const relPath = relative(rootDir, file);
    if (alreadyIngested(relPath)) return true;
    let source: string;
    try {
      source = readFileSync(file, 'utf-8');
    } catch (err) {
      onUnreadable(relPath, err);
      return false;
    }
    onSourceRead?.(source, relPath, file);
    entries.push({ path: relPath, source });
    pushed.add(relPath);
    fileOwners[relPath] ??= specifier;
    return true;
  };

  const diagnostics: ManifestDiagnostic[] = [];
  const reportedPackages = new Set<string>();

  const kitDescriptors: KitDescriptorRecord[] = [];
  const describedRoots = new Set<string>();
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
    const packageName = isAbsolute(specifier)
      ? null
      : bareSpecifierPackageName(specifier);
    // The host's resolution names the package unless it lands outside it: a
    // dev server resolves a package it prebundles into its dependency cache,
    // from where the nearest manifest can be the application's own. Then,
    // and for a source-only kit with no runtime entry to resolve, the package
    // is found as Node finds it, and its condition names the entry.
    const resolvedRoot = absEntry ? findPackageRoot(absEntry) : null;
    const locatedRoot = packageName && locatePackageRoot(packageName, rootDir);
    const pkgRoot =
      resolvedRoot &&
      (!locatedRoot ||
        isPackageNamed(resolvedRoot, packageName) ||
        realPath(resolvedRoot) === locatedRoot)
        ? resolvedRoot
        : locatedRoot || resolvedRoot;
    const condition =
      packageName && pkgRoot ? readKitSourceCondition(pkgRoot) : null;
    const entryKey = packageName && `.${specifier.slice(packageName.length)}`;
    absEntry ??=
      condition?.entries.find(([entry]) => entry === entryKey)?.[1] ?? null;
    if (!absEntry || !pkgRoot) {
      outcomes.push({ specifier, outcome: 'unresolvable', fileCount: 0 });
      continue;
    }

    const realRoot = realPath(pkgRoot);
    if (!describedRoots.has(realRoot)) {
      describedRoots.add(realRoot);
      const described = readKitDescriptor(pkgRoot, rootDir);
      if (described) kitDescriptors.push(described);
    }
    const linked = !isInstalledPackage(pkgRoot);
    const srcDir = join(pkgRoot, 'src');
    let fileCount = 0;
    let staleDist = false;

    if (packageName && !reportedPackages.has(packageName)) {
      reportedPackages.add(packageName);
      diagnostics.push(...sourceConditionDiagnostics(packageName, condition));
    }

    if (condition && packageName) {
      for (const [entry, target] of condition.entries) {
        const entrySpecifier = packageName + entry.slice(1);
        packageMap[entrySpecifier] = relative(rootDir, target);
        await redirect(entrySpecifier, target, pkgRoot, async () => {
          try {
            return await resolveSpecifier(entrySpecifier);
          } catch {
            return null;
          }
        });
      }
      packageMap[specifier] ??= relative(rootDir, absEntry);
      if (condition.root) {
        packageDirs.push(condition.root);
        if (linked) linkedDirs.push(condition.root);
        claimDir(condition.root, specifier);
        dirExtensions[condition.root] = [...extensionsSet];
        onPackageResolved?.(specifier, condition.root);
        for (const file of walkPackageSources(condition.root, extensionsSet)) {
          if (ingest(file, specifier)) fileCount++;
        }
      }
    } else if (existsSync(srcDir)) {
      packageDirs.push(srcDir);
      if (linked) linkedDirs.push(srcDir);
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
      if (packageName) {
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

      staleDist = linked && distEntryIsStale(absEntry, srcDir, pkgFiles);

      for (const pkgFile of pkgFiles) {
        if (ingest(pkgFile, specifier)) fileCount++;
      }
    } else {
      const outputDir = dirname(absEntry);
      packageDirs.push(outputDir);
      if (linked) linkedDirs.push(outputDir);
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
        if (ingest(outputFile, specifier)) fileCount++;
      }
    }

    // App code imports a package by any of its export entries, often its
    // root, while only the include specifier was mapped above. An entry whose
    // target was analysed maps there too, so its bindings resolve, as they do
    // for a source install through its root redirect.
    if (packageName) {
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
    linkedDirs,
    dirOwnerSets,
    dirExtensions,
    fileOwners,
    outcomes,
    diagnostics: [...diagnostics, ...noKitFilesDiagnostics(outcomes)],
    kitDescriptors,
  };
}

export interface SourceKitDependency {
  name: string;
  /** Installed under `node_modules`, not linked from a workspace. */
  installed: boolean;
  /** The kit's own `dependencies`, by name. */
  dependencies: string[];
}

/** The dependency names a manifest lists in `fields`. */
function dependencyNames(
  manifest: JsonValue | null,
  fields: readonly string[]
): string[] {
  if (!isJsonBlock(manifest)) return [];
  const names = new Set<string>();
  for (const field of fields) {
    const deps = manifest[field];
    if (isJsonBlock(deps))
      for (const name of Object.keys(deps)) names.add(name);
  }
  return [...names];
}

/** The source kits the application at `rootDir` declares as dependencies.
 *  A bundler serves an installed one as compiled code unless told
 *  otherwise: Next keeps it external on the server unless it is in
 *  `transpilePackages`, and Vite's optimizer prebundles it. */
export function sourceKitDependencies(rootDir: string): SourceKitDependency[] {
  const declared = dependencyNames(readPackageManifest(rootDir), [
    'dependencies',
    'devDependencies',
  ]);
  return declared.flatMap((name) => {
    const pkgRoot = locatePackageRoot(name, rootDir);
    if (pkgRoot === null || readKitSourceCondition(pkgRoot) === null) return [];
    return [
      {
        name,
        installed: isInstalledPackage(pkgRoot),
        dependencies: dependencyNames(readPackageManifest(pkgRoot), [
          'dependencies',
        ]),
      },
    ];
  });
}

/** A specifier that names a package: not relative or absolute, and no URL,
 *  scheme (`node:`, `virtual:`), subpath import or virtual id. */
function isPackageSpecifier(specifier: string): boolean {
  return /^(?:@[^/\\:]+\/)?[^./\\#\0:][^:]*$/.test(specifier);
}

/**
 * An error for each kit the application's own `files` import or re-export
 * whose system the application's system does not include: a package that
 * declares the kit source condition, with no kit the system extends
 * (`systemKits`) in that package. One app build has exactly one system, and
 * every kit's system is part of it, so such a kit is not extracted against
 * a system it was not built for. One batch parse reads the imports of every
 * file the engine parses as it is; an adapted source (`.svelte`, `.mdx`)
 * reaches the engine only as its generated children.
 */
export function importedKitDiagnostics(
  files: ReadonlyArray<{ path: string; source: string }>,
  engine: Pick<EngineApi, 'extractFacts'>,
  rootDir: string,
  systemKits: readonly string[]
): ManifestDiagnostic[] {
  const { extractFacts } = engine;
  const parsed = files.filter(({ path }) => isEngineTransformExtension(path));
  if (!extractFacts || parsed.length === 0) return [];
  let facts: ExtractFactsResult;
  try {
    facts = parseInternalWire<ExtractFactsResult>(
      extractFacts(
        JSON.stringify(parsed.map(({ path, source }) => ({ path, source })))
      ),
      'extractFacts'
    );
  } catch {
    return [];
  }
  const seen = new Set(
    systemKits
      .filter((specifier) => !isAbsolute(specifier))
      .map(bareSpecifierPackageName)
  );
  const diagnostics: ManifestDiagnostic[] = [];
  for (const [path, file] of Object.entries(facts.files)) {
    if (file.parsePanicked) continue;
    const specifiers = [
      ...file.imports.map((fact) => fact.source),
      ...file.exports.flatMap((fact) =>
        fact.source === null ? [] : [fact.source]
      ),
    ];
    for (const specifier of specifiers) {
      if (!isPackageSpecifier(specifier)) continue;
      const name = bareSpecifierPackageName(specifier);
      if (seen.has(name)) continue;
      seen.add(name);
      const pkgRoot = locatePackageRoot(name, dirname(resolve(rootDir, path)));
      if (pkgRoot && readKitSourceCondition(pkgRoot)) {
        diagnostics.push({
          file: path,
          component: name,
          kind: 'warn',
          message: `the application imports this kit, but its system is not included in the application's system, so its components are not extracted — include the kit's system in the application's system: createSystem().extend(<the kit's system>)`,
          code: KIT_SYSTEM_NOT_INCLUDED,
          severity: severityFor(KIT_SYSTEM_NOT_INCLUDED),
        });
      }
    }
  }
  return diagnostics;
}

/** A kit without the source condition, warned once, or each condition entry
 *  whose target is missing or outside the package. */
function sourceConditionDiagnostics(
  packageName: string,
  condition: KitSourceCondition | null
): ManifestDiagnostic[] {
  if (condition === null) {
    return [
      {
        file: packageName,
        component: 'kit',
        kind: 'warn',
        message: `declares no "${KIT_SOURCE_CONDITION}" export condition, so discovery guesses its source from src/ — give each public exports entry an "${KIT_SOURCE_CONDITION}" condition naming its original source`,
        code: KIT_WITHOUT_SOURCE_CONDITION,
        severity: severityFor(KIT_WITHOUT_SOURCE_CONDITION),
      },
    ];
  }
  return condition.invalid.map(([subpath, target]) => ({
    file: packageName,
    component: 'kit',
    kind: 'warn',
    message: `exports["${subpath}"].${KIT_SOURCE_CONDITION} names ${target}, which is missing or outside the package, so that entry is not read from source`,
    code: INVALID_KIT_SOURCE_CONDITION,
    severity: severityFor(INVALID_KIT_SOURCE_CONDITION),
  }));
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
    linkedDirs: collected.linkedDirs.filter(
      (dir) => !rejectedDirs.includes(dir)
    ),
    dirOwnerSets,
    dirExtensions,
    fileOwners,
    outcomes: collected.outcomes,
    diagnostics: collected.diagnostics,
    kitDescriptors: collected.kitDescriptors.filter(
      (record) =>
        !rejectedDirs.some((dir) =>
          isPathWithinRoot(resolve(rootDir, record.packageRoot), dir)
        )
    ),
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

/** A module's parsed import and export bindings. */
export interface ModuleRecord {
  imports: readonly ExtractImportFact[];
  exports: readonly ExtractExportFact[];
  /** 1-based `[line, column]` of each `createSystem(…)` call that no
   *  import, declaration or parameter binds, from the parser's scopes. */
  unboundCreateSystemCalls?: ReadonlyArray<readonly [number, number]>;
}

/** A module's parsed bindings, or null when it cannot be parsed. */
export type ModuleParser = (
  source: string,
  path: string
) => ModuleRecord | null;

/** The engine's own parse of a module's bindings, through its
 *  `extractFacts`; undefined for an engine without one. A parse that
 *  panicked counts as no parse. */
export function engineModuleParser(
  engine: Pick<EngineApi, 'extractFacts'>
): ModuleParser | undefined {
  const { extractFacts } = engine;
  if (!extractFacts) return undefined;
  return (source, path) => {
    try {
      const facts = parseInternalWire<ExtractFactsResult>(
        extractFacts(JSON.stringify([{ path, source }])),
        'extractFacts'
      ).files[path];
      return facts && !facts.parsePanicked
        ? {
            imports: facts.imports,
            exports: facts.exports,
            unboundCreateSystemCalls: facts.unboundCreateSystemCalls ?? [],
          }
        : null;
    } catch {
      return null;
    }
  };
}

const ANIMUS_SYSTEM_SPECIFIER = /^@animus-ui\/system(?:\/.*)?$/;

/** A host's resolution of a bare specifier to its entry file: the one it
 *  resolves the packages a system extends with, under its own conditions. */
export type PackageResolver = (
  specifier: string
) => string | null | Promise<string | null>;

/** What following a binding needs: the module parse, the host's package
 *  resolution, and where an unproven binding is reported. */
interface RootFollowing {
  parseModule: ModuleParser;
  resolvePackage: PackageResolver | undefined;
  report: ((diagnostic: ManifestDiagnostic) => void) | undefined;
}

/** The file a specifier names from `importer`: a relative one by the
 *  ingestion's probe order, a bare one by the host's package resolution. */
async function resolveModuleFile(
  importer: string,
  specifier: string,
  resolvePackage: PackageResolver | undefined
): Promise<string | null> {
  if (specifier.startsWith('.')) {
    return relativeSourceCandidates(importer, specifier).find(isFile) ?? null;
  }
  try {
    return (await resolvePackage?.(specifier)) ?? null;
  } catch {
    return null;
  }
}

/** What a binding was shown to be bound to. */
type BindingIdentity =
  | { kind: 'animus' }
  | { kind: 'other'; what: string }
  | { kind: 'unknown'; why: string };

const escapeRegExp = (text: string): string =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Follows `name`, exported by the module `specifier` names from `importer`,
 * through re-exports to its declaration. It is Animus's factory only when
 * that is `createSystem` of `@animus-ui/system`, and another identity only
 * when a module is shown to declare it; anything discovery cannot follow is
 * unknown.
 */
async function exportIdentity(
  importer: string,
  specifier: string,
  name: string,
  following: RootFollowing,
  seen: Set<string>
): Promise<BindingIdentity> {
  if (ANIMUS_SYSTEM_SPECIFIER.test(specifier)) {
    return name === 'createSystem'
      ? { kind: 'animus' }
      : { kind: 'other', what: `'${name}' of ${specifier}` };
  }
  const file = await resolveModuleFile(
    importer,
    specifier,
    following.resolvePackage
  );
  if (file === null) {
    return { kind: 'unknown', why: `'${specifier}' could not be resolved` };
  }
  const key = `${file}#${name}`;
  if (seen.has(key)) {
    return { kind: 'unknown', why: `'${specifier}' re-exports it in a cycle` };
  }
  seen.add(key);
  let source: string;
  try {
    source = readFileSync(file, 'utf-8');
  } catch {
    return { kind: 'unknown', why: `'${specifier}' could not be read` };
  }
  const record = following.parseModule(source, file);
  if (record === null) {
    return { kind: 'unknown', why: `'${specifier}' could not be parsed` };
  }
  const exported = record.exports.find((entry) => entry.exported === name);
  if (exported?.source) {
    return exportIdentity(
      file,
      exported.source,
      exported.original ?? name,
      following,
      seen
    );
  }
  const local = exported?.local ?? name;
  const imported = record.imports.find((entry) => entry.local === local);
  if (exported && imported) {
    return exportIdentity(
      file,
      imported.source,
      imported.imported,
      following,
      seen
    );
  }
  if (
    exported ||
    new RegExp(
      `\\bexport\\s+(?:async\\s+)?(?:function\\*?|class|const|let|var)\\s+${escapeRegExp(name)}\\b`
    ).test(source)
  ) {
    return {
      kind: 'other',
      what: `the '${name}' that '${specifier}' declares`,
    };
  }
  // `export * from` re-exports `name` when exactly one of its sources does.
  const stars: BindingIdentity[] = [];
  for (const match of source.matchAll(
    /\bexport\s*\*\s*from\s*['"]([^'"]+)['"]/g
  )) {
    stars.push(await exportIdentity(file, match[1], name, following, seen));
  }
  const definite = stars.filter((identity) => identity.kind !== 'unknown');
  if (definite.length === 1) return definite[0];
  if (definite.length > 1) {
    return {
      kind: 'unknown',
      why: `more than one \`export *\` of '${specifier}' provides '${name}'`,
    };
  }
  return (
    stars.find((identity) => identity.kind === 'unknown') ?? {
      kind: 'unknown',
      why: `'${specifier}' has no export '${name}' discovery can read`,
    }
  );
}

/** 1-based line and column of `offset` in `source`. */
function locationIn(
  source: string,
  offset: number
): Pick<ManifestDiagnostic, 'line' | 'column'> {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf('\n') + 1;
  return {
    line: before.split('\n').length,
    column: offset - lineStart + 1,
  };
}

const NAMESPACE_IMPORT =
  /\bimport\s+(?:[a-zA-Z_$][a-zA-Z0-9_$]*\s*,\s*)?\*\s*as\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s+from\s+['"]([^'"]+)['"]/g;

/**
 * The callees that are Animus's `createSystem` in a parsed system file. A
 * binding counts once its identity is followed to the factory: a named
 * import, through local and package re-exports; a namespace import's
 * member; or a property destructured from a namespace import, `require` or
 * `import()` of a module. A binding named `createSystem` shown to be
 * something else is no root. One whose identity discovery cannot follow
 * keeps the admission spelling gave it, so a resolution limit never drops a
 * kit. Both are reported. A call of the bare name, which the file neither
 * imports nor declares, is no root: the system loader evaluates the file
 * without auto-imports, where the name is undefined. It is reported once.
 */
async function systemRoots(
  systemFilePath: string,
  source: string,
  record: ModuleRecord,
  following: RootFollowing
): Promise<Set<string>> {
  const { imports } = record;
  const roots = new Set<string>();
  const identityOf = (
    specifier: string,
    name: string
  ): Promise<BindingIdentity> =>
    exportIdentity(systemFilePath, specifier, name, following, new Set());
  const called = (callee: string): boolean => callOf(callee).test(source);
  /** Admits a binding named `createSystem` by its identity: an unknown one
   *  keeps `spellingAdmits`, and every unproven one is reported. */
  const admit = (
    local: string,
    offset: number,
    identity: BindingIdentity,
    spellingAdmits: boolean
  ): void => {
    if (identity.kind === 'animus') {
      roots.add(local);
      return;
    }
    if (identity.kind === 'unknown' && spellingAdmits) roots.add(local);
    const shown =
      identity.kind === 'other'
        ? `it is ${identity.what}, so it is not read as a system root`
        : `discovery cannot follow what it is bound to (${identity.why}), so it is ${spellingAdmits ? 'still read' : 'not read'} as a system root by its name alone`;
    following.report?.({
      file: systemFilePath,
      component: local,
      kind: 'warn',
      message: `'${local}' is not proven to be Animus's createSystem: ${shown} — import createSystem from '@animus-ui/system', directly or through a re-export discovery can follow`,
      code: UNPROVEN_ROOT_BINDING,
      severity: severityFor(UNPROVEN_ROOT_BINDING),
      ...locationIn(source, offset),
    });
  };

  for (const binding of imports) {
    const named =
      binding.imported === 'createSystem' || binding.local === 'createSystem';
    if (named) {
      const statement = new RegExp(
        `\\bimport\\b[^;]*?\\bfrom\\s*['"]${escapeRegExp(binding.source)}['"]`,
        'g'
      );
      let offset = 0;
      for (const match of source.matchAll(statement)) {
        const at = match[0].search(
          new RegExp(`(?<![a-zA-Z0-9_$])${escapeRegExp(binding.local)}\\b`)
        );
        if (at !== -1) {
          offset = match.index + at;
          break;
        }
      }
      // Spelling read an import of `createSystem` as a root by its local
      // name, and any other import named `createSystem` as a shadow.
      admit(
        binding.local,
        offset,
        await identityOf(binding.source, binding.imported),
        binding.imported === 'createSystem'
      );
      continue;
    }
    // Another name is followed only when it is called and imported from a
    // local module, where a renamed re-export of the factory can surface.
    if (
      binding.source.startsWith('.') &&
      called(binding.local) &&
      (await identityOf(binding.source, binding.imported)).kind === 'animus'
    ) {
      roots.add(binding.local);
    }
  }

  // The parse omits namespace imports, so they are read from their syntax.
  const namespaces = new Map<string, string>();
  for (const [, namespace, specifier] of source.matchAll(NAMESPACE_IMPORT)) {
    namespaces.set(namespace, specifier);
    const member = `${namespace}.createSystem`;
    if (
      ANIMUS_SYSTEM_SPECIFIER.test(specifier) ||
      (specifier.startsWith('.') &&
        called(member) &&
        (await identityOf(specifier, 'createSystem')).kind === 'animus')
    ) {
      roots.add(member);
    }
  }

  const destructuredFrom = (initializer: string): Promise<BindingIdentity> => {
    const loaded =
      /^\(?\s*(?:(?:await\s+)?import|require)\(\s*['"]([^'"]+)['"]\s*\)\s*\)?$/.exec(
        initializer
      );
    if (loaded) return identityOf(loaded[1], 'createSystem');
    const namespace = namespaces.get(initializer);
    if (namespace !== undefined) return identityOf(namespace, 'createSystem');
    return Promise.resolve({
      kind: 'unknown',
      why: `it is destructured from '${initializer}', which is not a module namespace`,
    });
  };
  for (const { local, offset, initializer } of destructuredCreateSystems(
    source
  )) {
    // Spelling read an unrenamed destructured `createSystem` as a root.
    admit(
      local,
      offset,
      await destructuredFrom(initializer),
      local === 'createSystem'
    );
  }

  const unimported = unimportedCreateSystemCall(systemFilePath, record);
  if (unimported) following.report?.(unimported);
  return roots;
}

/** A call of `callee` as a whole name, not a member. */
function callOf(callee: string): RegExp {
  return new RegExp(`(?<![a-zA-Z0-9_$.])${escapeRegExp(callee)}\\s*\\(`);
}

/** Each `createSystem` property a declaration destructures: its local name,
 *  its offset in `source`, and the destructured initializer. */
function* destructuredCreateSystems(
  source: string
): Generator<{ local: string; offset: number; initializer: string }> {
  for (const match of source.matchAll(
    /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*([^;\n]+)/g
  )) {
    const [whole, pattern, initializer] = match;
    for (const property of pattern.split(',')) {
      const binding =
        /^\s*createSystem\s*(?::\s*([a-zA-Z_$][a-zA-Z0-9_$]*))?\s*(?:=[\s\S]*)?$/.exec(
          property
        );
      if (!binding) continue;
      yield {
        local: binding[1] ?? 'createSystem',
        offset: match.index + whole.indexOf('createSystem'),
        initializer: initializer.trim(),
      };
    }
  }
}

/** The warning for a `createSystem` call that the parser's scopes leave
 *  unbound: no import, declaration or parameter names it. Null when there is
 *  none, or when the parser reports no scopes. */
export function unimportedCreateSystemCall(
  systemFilePath: string,
  record: ModuleRecord
): ManifestDiagnostic | null {
  const call = record.unboundCreateSystemCalls?.[0];
  if (!call) return null;
  return {
    file: systemFilePath,
    component: 'createSystem',
    kind: 'warn',
    message: `'createSystem' is called with no import or local binding, so it is not read as a system root: the system loader evaluates this file without auto-imports, where the name is undefined — import createSystem from '@animus-ui/system'`,
    code: UNIMPORTED_CREATE_SYSTEM,
    severity: severityFor(UNIMPORTED_CREATE_SYSTEM),
    line: call[0],
    column: call[1],
  };
}

/** A pattern matching a call of any of `callees` as a whole name, or null
 *  when there is none to anchor on. */
function rootCallPattern(callees: readonly string[]): string | null {
  if (callees.length === 0) return null;
  const names = callees.map((callee) => callee.replace(/[.$]/g, '\\$&'));
  return `(?<![a-zA-Z0-9_$.])(?:${names.join('|')})`;
}

export async function extractSystemFilePackages(
  systemFilePath: string,
  parseModule?: ModuleParser,
  report?: (diagnostic: ManifestDiagnostic) => void,
  resolvePackage?: PackageResolver
): Promise<string[]> {
  let source: string;
  try {
    source = readFileSync(systemFilePath, 'utf-8');
  } catch {
    return [];
  }

  // A parsed file's bindings decide its roots, even with no imports; only an
  // unparsed one falls back to the spelling.
  const parsed = parseModule?.(source, systemFilePath) ?? null;
  let rootCall: string | null = 'createSystem';
  if (parseModule && parsed) {
    rootCall = rootCallPattern([
      ...(await systemRoots(systemFilePath, source, parsed, {
        parseModule,
        resolvePackage,
        report,
      })),
    ]);
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
  for (const binding of parsed?.imports ?? []) {
    importMap.set(binding.local, binding.source);
  }
  const importRegex =
    /^\s*import\s+(?:([a-zA-Z_$][a-zA-Z0-9_$]*)\s*,\s*)?(?:\{([^}]*)\}|([a-zA-Z_$][a-zA-Z0-9_$]*))\s+from\s+['"]([^'"]+)['"]/gm;

  // Without a parse, the import table is read from its syntax.
  if (!parsed) {
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
