import { existsSync, readFileSync, realpathSync, statSync } from 'fs';
import {
  dirname,
  extname,
  isAbsolute,
  join,
  normalize,
  relative,
  resolve,
  sep,
} from 'path';

import { globToRegExp } from './core-options';
import { discoverFiles } from './discover-files';
import {
  caseMismatchReason,
  policyCandidates,
  probeOnDisk,
  seeOnDisk,
} from './extension-policy';
import {
  BUILT_IN_EXTENSION_POLICY,
  extensionPolicyJson,
} from './host-extensions';
import { parseInternalWire } from './internal-wire';
import { readKitDescriptor } from './kit-descriptor';
import {
  INVALID_KIT_SOURCE_CONDITION,
  KIT_SYSTEM_NOT_INCLUDED,
  KIT_WITHOUT_SOURCE_CONDITION,
  noKitFilesDiagnostics,
  PACKAGE_MISMATCH,
  severityFor,
  UNIMPORTED_CREATE_SYSTEM,
  UNFOLLOWED_SYSTEM_BUILDER,
  UNPROVEN_ROOT_BINDING,
} from './manifest-diagnostics';
import { isEngineTransformExtension } from './mdx-preprocessor';
import { isPathWithinRoot } from './source-identity';
import { relativeSourceCandidates } from './source-ingestion';
import { isJsonBlock, isJsonString } from './tsconfig-paths';
import { declaredWorkspacePackages } from './workspace-packages';

import type { EngineApi } from './engine-adapter';
import type { ExtensionOrder, ProbedFile } from './extension-policy';
import type { KitDescriptorRecord } from './kit-descriptor';
import type { ManifestDiagnostic } from './manifest-diagnostics';
import type {
  ExtractExportFact,
  ExtractFactsResult,
  ExtractImportFact,
} from './source-ingestion';
import type { JsonValue } from './tsconfig-paths';
import type { WorkspacePackages } from './workspace-packages';

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
  /** For an unresolvable specifier, why the resolver found no file. */
  reason?: string;
}

/** The file an absolute path specifier names, through the extension
 *  policy, spelled exactly below the directory it shares with `within`
 *  when given; a file differing only in case is a mismatch. */
export function probeAbsolutePathSpecifier(
  absSpecifier: string,
  extensionsSet?: ReadonlySet<string>,
  within?: string,
  policy?: ExtensionOrder
): ProbedFile {
  // `..` is taken back lexically first, as Node resolves a specifier, so
  // the path a probe returns is the path it checked.
  return probeOnDisk(
    policyCandidates(normalize(absSpecifier), {
      sources: extensionsSet,
      index: join,
      policy,
    }),
    within
  );
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
  extensionsSet: ReadonlySet<string>,
  rootDir: string,
  policy: ExtensionOrder | undefined
): string | null {
  // A guess, not a resolution: a file differing only in case is no guess.
  // Only the names below the root, or below `src/`, are checked.
  if (isAbsolute(specifier)) {
    const probed = probeAbsolutePathSpecifier(
      specifier,
      extensionsSet,
      rootDir,
      policy
    );
    if (probed.kind !== 'found') return null;
    return isPathWithinRoot(srcDir, probed.path) ? probed.path : null;
  }
  const packageName = bareSpecifierPackageName(specifier);
  const subpath = specifier.slice(packageName.length + 1);
  const sourceStem = join(srcDir, subpath || 'index');
  const probed = probeAbsolutePathSpecifier(
    sourceStem,
    extensionsSet,
    srcDir,
    policy
  );
  return probed.kind === 'found' ? probed.path : null;
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
  /** Entries whose target is missing, differs from its file only in case,
   *  or is no package target Node accepts, and which of those. */
  invalid: Array<[subpath: string, target: string, why: string]>;
  /** The deepest directory holding every source entry: what discovery walks.
   *  Null when no entry is valid. */
  root: string | null;
}

/** A kit's source root as the system loader's table selects it (spec §2.2
 *  A5): the rule that chose it, each exact entry's source file, and the
 *  `animus` targets the loader does not read as source, with why. Each of
 *  those falls back to its runtime target, except a percent-escaped one,
 *  which fails the load. `unresolved` names why the specifier names no file
 *  though its package was located. */
export interface KitSourceSelection {
  rule: 'animus' | 'source-exports' | 'src' | 'compiled';
  root: string | null;
  entries: Array<[subpath: string, file: string]>;
  invalid: Array<[subpath: string, target: string, why: string]>;
  unresolved: string | null;
}

/** A specifier's kit source root, given the package discovery located and
 *  the file the host resolves; null where no host imports the specifier. */
export type KitSourceRootResolver = (
  specifier: string,
  packageDir: string,
  hostEntry: string | null
) => KitSourceSelection | null;

/** Where a package is installed: the package `name` located from
 *  `fromDir`, at its real path, or null. */
export type PackageLocator = (name: string, fromDir: string) => string | null;

/** The system loader's package locator under the session's declared
 *  `workspaces`: the first `node_modules/<name>` up the tree, then the
 *  workspace of that name. */
export function nativePackageLocator(
  engine: Pick<EngineApi, 'locatePackage'>,
  workspaces: WorkspacePackages
): PackageLocator {
  const native = engine.locatePackage;
  return (name, fromDir) => {
    if (native === undefined) {
      throw new Error(
        'the native engine does not expose locatePackage, which kit discovery needs — rebuild @animus-ui/extract'
      );
    }
    return native(name, fromDir, workspaces);
  };
}

/** The native table's kit source roots under one resolution context. */
export function nativeKitSourceRoot(
  engine: Pick<EngineApi, 'resolveKitSourceRoot'>,
  fromDir: string,
  conditions: readonly string[],
  workspaces: WorkspacePackages,
  policyJson: string
): KitSourceRootResolver {
  const native = engine.resolveKitSourceRoot;
  return (specifier, packageDir, hostEntry) => {
    if (native === undefined) {
      throw new Error(
        'the native engine does not expose resolveKitSourceRoot, which kit discovery needs — rebuild @animus-ui/extract'
      );
    }
    const answer = parseInternalWire<Partial<KitSourceSelection>>(
      native(
        specifier,
        fromDir,
        [...conditions],
        workspaces,
        policyJson,
        hostEntry ?? undefined,
        packageDir
      ),
      'resolveKitSourceRoot'
    );
    if (answer.rule === undefined) return null;
    return {
      rule: answer.rule,
      root: answer.root ?? null,
      entries: answer.entries ?? [],
      invalid: answer.invalid ?? [],
      unresolved: answer.unresolved ?? null,
    };
  };
}

/**
 * Whether `dir`, the nearest manifest above a host's answer, is a package
 * the host resolved into: its manifest names a package, and it is not the
 * project or a directory holding it. A host answer from a dependency cache
 * (`node_modules/.vite/deps`), or from a file outside every package, finds
 * the application's own manifest, which is no package root. The name need
 * not be the specifier's: a host alias resolves one package to another,
 * and the host's package is the one the bundle renders (spec §2.2 A4).
 */
function isHostPackageRoot(dir: string, rootDir: string): boolean {
  const manifest = readPackageManifest(dir);
  return (
    isJsonBlock(manifest) &&
    isJsonString(manifest.name) &&
    manifest.name !== '' &&
    !isPathWithinRoot(realPath(dir), realPath(rootDir))
  );
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
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

/** Whether a bundler that reads the nearest `package.json`'s `sideEffects`
 *  against the file's own path keeps `absFile`; undefined without a field
 *  it reads, which keeps the bundler's side-effectful default. */
export function fileSideEffects(absFile: string): boolean | undefined {
  const pkgRoot = findPackageRoot(absFile);
  const field = readPackageSideEffects(pkgRoot);
  if (field === undefined || field === true || field === false) return field;
  return matchesSideEffects(field, pkgRoot, [absFile]);
}

/** Whether a `sideEffects` glob can name a code file: a last segment with
 *  no extension can name any file, and an extension with glob syntax or of
 *  a script can name code; `*.css` cannot. Brace alternatives are each read,
 *  and braces this reading cannot expand count as naming code. */
function globNamesCode(glob: string): boolean {
  const alternatives = expandBraces(glob);
  if (alternatives === null) return true;
  return alternatives.some((alternative) => {
    const last = alternative.split('/').at(-1) ?? '';
    const dot = last.lastIndexOf('.');
    if (dot === -1) return true;
    const extension = last.slice(dot + 1);
    return /[*?[]/.test(extension) || /^[cm]?[jt]sx?$/.test(extension);
  });
}

/** Every alternative a glob's `{a,b}` groups spell, nested groups included;
 *  null when its braces do not balance. */
function expandBraces(glob: string): string[] | null {
  const open = glob.indexOf('{');
  if (open === -1) return glob.includes('}') ? null : [glob];
  let depth = 0;
  const commas: number[] = [];
  for (let at = open; at < glob.length; at++) {
    if (glob[at] === '{') depth++;
    else if (glob[at] === ',' && depth === 1) commas.push(at);
    else if (glob[at] === '}' && --depth === 0) {
      const bounds = [open, ...commas, at];
      const rest = expandBraces(glob.slice(at + 1));
      if (rest === null) return null;
      const expanded: string[] = [];
      for (let i = 0; i < bounds.length - 1; i++) {
        const inner = expandBraces(glob.slice(bounds[i] + 1, bounds[i + 1]));
        if (inner === null) return null;
        for (const middle of inner) {
          for (const tail of rest)
            expanded.push(glob.slice(0, open) + middle + tail);
        }
      }
      return expanded;
    }
  }
  return null;
}

/**
 * True when a source module of the package that owns `absFile` must stay
 * side-effectful: its `sideEffects` list names shipped code, and no proven
 * map takes a shipped file to its source module, so a bundler that reads
 * the list against the source path can drop a listed effect. Undefined
 * leaves the bundler's own reading, which no list naming code can mislead.
 */
export function kitSourceModuleSideEffects(absFile: string): true | undefined {
  const manifest = readPackageManifest(findPackageRoot(absFile));
  const field = isJsonBlock(manifest) ? manifest.sideEffects : undefined;
  if (!Array.isArray(field)) return undefined;
  return field.some((glob) => isJsonString(glob) && globNamesCode(glob))
    ? true
    : undefined;
}

/** Whether a host keeps the module at `file` side-effectful: it lies under
 *  one of the discovered kit source directories, and its package's list
 *  could misread it (see `kitSourceModuleSideEffects`). A host asks this of
 *  the resolved module, never of its importer alone. */
export function keepsKitSourceEffects(
  file: string,
  kitDirs: readonly string[]
): boolean {
  return (
    kitDirs.some((dir) => isPathWithinRoot(dir, file)) &&
    kitSourceModuleSideEffects(file) === true
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
  /** Those of `packageDirs` read from their package's compiled output: the
   *  package declares no source condition and ships no `src/`. */
  outputDirs: string[];
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
  /** Package name → the real root of the instance read for it (spec §2.2
   *  A4): another instance an importer resolves is not this one. */
  packageInstances: Record<string, string>;
}

export async function collectExternalPackageSources(opts: {
  specifiers: string[];
  resolveSpecifier: (
    specifier: string
  ) => string | null | Promise<string | null>;
  /** Why `resolveSpecifier` found no file for a specifier, when it knows. */
  unresolvedReason?: (specifier: string) => string | undefined;
  /** Each kit's source root, as the system loader's table selects it. */
  kitSourceRoot: KitSourceRootResolver;
  /** Where the system loader locates each package from `rootDir`. */
  locatePackage: PackageLocator;
  rootDir: string;
  extensionsSet: ReadonlySet<string>;
  hasEntry: (relPath: string) => boolean;
  onSourceRead?: (source: string, relPath: string, absPath: string) => void;
  onUnreadable: <Thrown>(relPath: string, error: Thrown) => void;
  /** Called once per specifier after its package dir is derived and BEFORE
   *  its sources are walked, so a host can watch with no blind gap. */
  onPackageResolved?: (specifier: string, packageDir: string) => void;
  /** Specifiers the host itself cannot resolve: each is admitted only where
   *  a source entry redirects the host's import of it, since compiled output
   *  the host never opens is nothing it bundles. */
  requireSourceEntry?: (specifier: string) => boolean;
  /** The host's extension order (spec §2.2 A2) for an absolute include or a
   *  source-entry guess; the built-in policy without one. */
  extensions?: ExtensionOrder;
  /** The host's output directories, absolute: a package inside one is
   *  output, never collected as source. */
  hostOutputDirs?: readonly string[];
}): Promise<CollectedExternalPackages> {
  const {
    specifiers,
    unresolvedReason,
    kitSourceRoot,
    locatePackage,
    rootDir,
    extensionsSet,
    hasEntry,
    onSourceRead,
    onUnreadable,
    onPackageResolved,
    requireSourceEntry,
    extensions,
    hostOutputDirs = [],
  } = opts;

  // One host request per specifier: a redirect's side-effect check asks
  // again for the entry the include already resolved.
  const answers = new Map<string, Promise<string | null>>();
  const resolveSpecifier = (specifier: string): Promise<string | null> => {
    let answer = answers.get(specifier);
    if (answer === undefined) {
      answer = Promise.resolve().then(() => opts.resolveSpecifier(specifier));
      answers.set(specifier, answer);
    }
    return answer;
  };

  const entries: Array<{ path: string; source: string }> = [];
  const pushed = new Set<string>();
  const packageMap: Record<string, string> = {};
  const sourceEntries = new Map<string, string>();
  const sourceEntrySideEffects = new Map<string, boolean>();
  /** The entry `subpath` of the package resolves to without the redirect.
   *  A resolver with no `import` condition, as Node's `require` has none,
   *  finds no ESM-only entry, so the manifest's own target answers then. */
  const shippedEntry = async (
    specifier: string,
    pkgRoot: string,
    subpath: string
  ): Promise<string | null> => {
    try {
      const resolved = await resolveSpecifier(specifier);
      if (resolved) return resolved;
    } catch {
      // Fall through to the manifest.
    }
    return (
      packageExportEntries(pkgRoot).find(([entry]) => entry === subpath)?.[1] ??
      null
    );
  };
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
  const outputDirs: string[] = [];
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
  // Each finding once, by its package, code and message (which names the
  // entry and target), whichever specifier of the package reaches it.
  const reported = new Set<string>();
  const report = (
    packageName: string,
    pkgRoot: string,
    condition: KitSourceCondition | null
  ): void => {
    // Keyed by the package's real directory: two copies of one package
    // report their own findings.
    const copy = realPath(pkgRoot);
    for (const finding of sourceConditionDiagnostics(packageName, condition)) {
      const key = `${copy}\0${finding.code}\0${finding.message}`;
      if (reported.has(key)) continue;
      reported.add(key);
      diagnostics.push(finding);
    }
  };

  const kitDescriptors: KitDescriptorRecord[] = [];
  const packageInstances: Record<string, string> = {};
  const describedRoots = new Set<string>();
  for (const specifier of specifiers) {
    let absEntry: string | null;
    try {
      absEntry = await resolveSpecifier(specifier);
    } catch {
      absEntry = null;
    }
    // An absolute specifier is checked on the filesystem, the names below the
    // root spelled exactly, even where the host resolved it: a host on a
    // case-insensitive filesystem opens a file that differs only in case.
    // Node's resolver refuses extensionless TS paths, so one it declines is
    // found here too.
    // The include's own spelling is checked, and so is a host's answer for
    // it, `..` taken back lexically as Node reads it: a host can answer with
    // the file's canonical spelling. The path used is the path checked.
    let caseMismatch: string | undefined;
    if (isAbsolute(specifier)) {
      const own = probeAbsolutePathSpecifier(
        specifier,
        extensionsSet,
        rootDir,
        extensions
      );
      const hosted = absEntry === null ? null : normalize(absEntry);
      const seen = hosted === null ? null : seeOnDisk(hosted, rootDir);
      const probed: ProbedFile =
        own.kind === 'case-mismatch' || hosted === null || seen === null
          ? own
          : seen.kind === 'case-only'
            ? { kind: 'case-mismatch', candidate: hosted, actual: seen.actual }
            : { kind: 'found', path: hosted };
      absEntry = probed.kind === 'found' ? probed.path : null;
      if (probed.kind === 'case-mismatch') {
        caseMismatch = caseMismatchReason(
          `'${specifier}'`,
          probed,
          'spell the include as the file is spelled'
        );
      }
    }
    const packageName = isAbsolute(specifier)
      ? null
      : bareSpecifierPackageName(specifier);
    // The host's resolution names the package unless it lands outside it: a
    // dev server resolves a package it prebundles into its dependency cache,
    // from where the nearest manifest can be the application's own. Then,
    // and for a source-only kit with no runtime entry to resolve, the package
    // is found as Node finds it, and its condition names the entry.
    // A manifest nested below the package Node locates (a published
    // `dist/lib/package.json` carrying the package's name) is part of the
    // package, not its root: the root is the located directory, spelled as
    // the host spells the entry. Only where the entry's own real path lies
    // inside it: an entry linked out of the package is not its file.
    let resolvedRoot = absEntry ? findPackageRoot(absEntry) : null;
    const locatedRoot = packageName && locatePackage(packageName, rootDir);
    if (
      resolvedRoot &&
      locatedRoot &&
      absEntry &&
      realPath(resolvedRoot) !== locatedRoot &&
      isPathWithinRoot(locatedRoot, realPath(absEntry))
    ) {
      while (
        realPath(resolvedRoot) !== locatedRoot &&
        resolvedRoot !== dirname(resolvedRoot)
      ) {
        resolvedRoot = dirname(resolvedRoot);
      }
      if (realPath(resolvedRoot) !== locatedRoot) resolvedRoot = locatedRoot;
    }
    const pkgRoot =
      resolvedRoot &&
      (!locatedRoot ||
        isHostPackageRoot(resolvedRoot, rootDir) ||
        realPath(resolvedRoot) === locatedRoot)
        ? resolvedRoot
        : locatedRoot || resolvedRoot;
    // The host's file lies in no package, and not in the located one: the
    // bundle may render another module than the one read. A dependency
    // cache lies under node_modules and holds the located package's build.
    if (
      absEntry &&
      packageName &&
      locatedRoot &&
      pkgRoot === locatedRoot &&
      !isPathWithinRoot(locatedRoot, realPath(absEntry)) &&
      !realPath(absEntry).split(sep).includes('node_modules')
    ) {
      diagnostics.push(
        packageMismatchDiagnostic(
          specifier,
          relative(rootDir, absEntry),
          relative(rootDir, locatedRoot)
        )
      );
    }
    // The table selects the kit's source: its `animus` targets, else its
    // source-targeting exports, else a `src/` guess, else the runtime
    // entry's directory. The host's entry stays the runtime entry.
    const selection =
      packageName && pkgRoot
        ? kitSourceRoot(specifier, pkgRoot, absEntry)
        : null;
    if (selection?.unresolved) {
      absEntry = null;
      caseMismatch = selection.unresolved;
    }
    const condition: KitSourceCondition | null =
      selection &&
      (selection.rule === 'animus' ||
        selection.rule === 'source-exports' ||
        selection.invalid.length > 0)
        ? {
            entries: selection.entries,
            invalid: selection.invalid,
            root: selection.rule === 'compiled' ? null : selection.root,
          }
        : null;
    // A refused selection fails the load, so its finding is reported with
    // the unresolvable outcome.
    if (selection?.unresolved && condition && packageName && pkgRoot) {
      report(packageName, pkgRoot, condition);
    }
    const entryKey = packageName && `.${specifier.slice(packageName.length)}`;
    absEntry ??=
      condition?.entries.find(([entry]) => entry === entryKey)?.[1] ?? null;
    if (!absEntry || !pkgRoot) {
      const record: ExternalPackageOutcome = {
        specifier,
        outcome: 'unresolvable',
        fileCount: 0,
      };
      const reason = caseMismatch ?? unresolvedReason?.(specifier);
      if (reason !== undefined) record.reason = reason;
      outcomes.push(record);
      continue;
    }

    const hostOutput = hostOutputDirs.find(
      (dir) =>
        isPathWithinRoot(dir, pkgRoot) ||
        isPathWithinRoot(realPath(dir), realPath(pkgRoot))
    );
    if (hostOutput !== undefined) {
      outcomes.push({
        specifier,
        outcome: 'unresolvable',
        fileCount: 0,
        reason: `the package lies inside the host's output directory ${hostOutput}, which is never source`,
      });
      continue;
    }

    if (requireSourceEntry?.(specifier)) {
      const redirected =
        condition && packageName
          ? condition.entries.some(([entry]) => entry === entryKey)
          : selection?.rule === 'src' &&
            sourceEntryForSpecifier(
              specifier,
              join(pkgRoot, 'src'),
              extensionsSet,
              rootDir,
              extensions
            ) !== null;
      if (!redirected) {
        outcomes.push({
          specifier,
          outcome: 'unresolvable',
          fileCount: 0,
          reason:
            'the host does not resolve it, and the system loader finds only compiled output that no source entry redirects to — link the package into node_modules, or give it an "animus" source condition',
        });
        continue;
      }
    }

    const realRoot = realPath(pkgRoot);
    if (packageName) packageInstances[packageName] ??= realRoot;
    if (!describedRoots.has(realRoot)) {
      describedRoots.add(realRoot);
      const described = readKitDescriptor(pkgRoot, rootDir);
      if (described) kitDescriptors.push(described);
    }
    const linked = !isInstalledPackage(pkgRoot);
    const srcDir = join(pkgRoot, 'src');
    let fileCount = 0;
    let staleDist = false;

    if (packageName) report(packageName, pkgRoot, condition);

    // The compiled output a runtime entry lives in: its directory, with the
    // entry's own extension, less the paths no package ships as source.
    const ingestOutput = (entryFile: string): void => {
      const outputDir = dirname(entryFile);
      packageDirs.push(outputDir);
      if (linked) linkedDirs.push(outputDir);
      outputDirs.push(outputDir);
      claimDir(outputDir, specifier);
      onPackageResolved?.(specifier, outputDir);
      const outputExtensions = new Set(extensionsSet);
      outputExtensions.add(extname(entryFile));
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
      if (!outputFiles.includes(entryFile)) outputFiles.unshift(entryFile);
      for (const outputFile of outputFiles) {
        if (ingest(outputFile, specifier)) fileCount++;
      }
    };

    if (condition && packageName) {
      for (const [entry, target] of condition.entries) {
        const entrySpecifier = packageName + entry.slice(1);
        packageMap[entrySpecifier] = relative(rootDir, target);
        await redirect(entrySpecifier, target, pkgRoot, () =>
          shippedEntry(entrySpecifier, pkgRoot, entry)
        );
      }
      packageMap[specifier] ??= relative(rootDir, absEntry);
      // An entry whose source target is invalid is read from its runtime
      // target, which the condition's source root does not hold.
      if (!condition.entries.some(([entry]) => entry === entryKey)) {
        ingestOutput(absEntry);
      }
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
    } else if (
      selection === null ? existsSync(srcDir) : selection.rule === 'src'
    ) {
      packageDirs.push(srcDir);
      if (linked) linkedDirs.push(srcDir);
      claimDir(srcDir, specifier);
      dirExtensions[srcDir] = [...extensionsSet];
      onPackageResolved?.(specifier, srcDir);

      const srcEntry = sourceEntryForSpecifier(
        specifier,
        srcDir,
        extensionsSet,
        rootDir,
        extensions
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
            extensionsSet,
            rootDir,
            extensions
          );
          if (rootEntry) {
            packageMap[packageName] = relative(rootDir, rootEntry);
            await redirect(packageName, rootEntry, pkgRoot, () =>
              shippedEntry(packageName, pkgRoot, '.')
            );
          }
        }
      }

      const pkgFiles = walkPackageSources(srcDir, extensionsSet);

      staleDist = linked && distEntryIsStale(absEntry, srcDir, pkgFiles);

      for (const pkgFile of pkgFiles) {
        if (ingest(pkgFile, specifier)) fileCount++;
      }
    } else {
      packageMap[specifier] = relative(rootDir, absEntry);
      ingestOutput(absEntry);
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

    // A host alias hands the host's plugins this package under its own
    // name, so each redirect is keyed by that name too. Only where the host
    // answered another directory than the located package: an npm alias
    // installs a renamed package where Node finds it, and its own name may
    // be another installed package's.
    const ownManifest = readPackageManifest(pkgRoot);
    const hostName = isJsonBlock(ownManifest) ? ownManifest.name : undefined;
    if (
      packageName &&
      locatedRoot &&
      realPath(pkgRoot) !== locatedRoot &&
      isJsonString(hostName) &&
      hostName !== '' &&
      hostName !== packageName
    ) {
      for (const [key, entry] of [...sourceEntries]) {
        if (key !== packageName && !key.startsWith(`${packageName}/`)) continue;
        const hostKey = hostName + key.slice(packageName.length);
        if (sourceEntries.has(hostKey)) continue;
        sourceEntries.set(hostKey, entry);
        const sideEffects = sourceEntrySideEffects.get(key);
        if (sideEffects !== undefined) {
          sourceEntrySideEffects.set(hostKey, sideEffects);
        }
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
    outputDirs,
    dirOwnerSets,
    dirExtensions,
    fileOwners,
    outcomes,
    diagnostics: [...diagnostics, ...noKitFilesDiagnostics(outcomes)],
    kitDescriptors,
    packageInstances,
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

/** Whether the package at `pkgRoot` declares the kit source condition, as
 *  the system loader's table reads its manifest: an `animus` key anywhere in
 *  its `exports`, on any entry, subpath or pattern, valid or not. */
function declaresKitSource(
  engine: Pick<EngineApi, 'declaresKitSource'>,
  pkgRoot: string
): boolean {
  if (engine.declaresKitSource === undefined) {
    throw new Error(
      'the native engine does not expose declaresKitSource, which kit discovery needs — rebuild @animus-ui/extract'
    );
  }
  return engine.declaresKitSource(pkgRoot);
}

/** The source kits the application at `rootDir` declares as dependencies.
 *  A bundler serves an installed one as compiled code unless told
 *  otherwise: Next keeps it external on the server unless it is in
 *  `transpilePackages`, and Vite's optimizer prebundles it. */
export function sourceKitDependencies(
  rootDir: string,
  engine: Pick<EngineApi, 'declaresKitSource' | 'locatePackage'>
): SourceKitDependency[] {
  const locatePackage = nativePackageLocator(
    engine,
    declaredWorkspacePackages(rootDir)
  );
  const declared = dependencyNames(readPackageManifest(rootDir), [
    'dependencies',
    'devDependencies',
  ]);
  return declared.flatMap((name) => {
    const pkgRoot = locatePackage(name, rootDir);
    if (pkgRoot === null || !declaresKitSource(engine, pkgRoot)) return [];
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

/**
 * The installed packages a system's membership reaches: each is a kit,
 * whether or not it declares the source condition, and so is every kit its
 * own system extends or includes. Read before any host resolves (a
 * bundler's config), so the application's modules import as the system
 * loader resolves them from the root, and a kit's from its own directory.
 */
export async function systemKitDependencies(
  rootDir: string,
  systemPath: string,
  engine: Pick<
    EngineApi,
    'systemMembership' | 'resolveSpecifier' | 'locatePackage'
  >
): Promise<SourceKitDependency[]> {
  const workspaces = declaredWorkspacePackages(rootDir);
  const resolveSpecifier = engine.resolveSpecifier;
  const systemPackageRoot = findPackageRoot(systemPath);
  const memberFiles = new Map<string, string>();
  const members = await extractSystemFilePackages(
    systemPath,
    engine,
    undefined,
    (specifier, importer) =>
      resolveSpecifier?.(
        specifier,
        findPackageRoot(importer) === systemPackageRoot
          ? rootDir
          : dirname(importer),
        [],
        workspaces,
        extensionPolicyJson(BUILT_IN_EXTENSION_POLICY)
      )?.path ?? null,
    undefined,
    memberFiles
  );
  const locatePackage = nativePackageLocator(engine, workspaces);
  const roots = new Map<string, string>();
  for (const member of members) {
    if (!isPackageSpecifier(member)) continue;
    const name = bareSpecifierPackageName(member);
    const file = memberFiles.get(member);
    const pkgRoot =
      locatePackage(name, rootDir) ?? (file ? findPackageRoot(file) : null);
    if (pkgRoot !== null && !roots.has(name)) roots.set(name, pkgRoot);
  }
  return [...roots].map(([name, pkgRoot]) => ({
    name,
    installed: isInstalledPackage(pkgRoot),
    dependencies: dependencyNames(readPackageManifest(pkgRoot), [
      'dependencies',
    ]),
  }));
}

/** A specifier that names a package: not relative or absolute, and no URL,
 *  scheme (`node:`, `virtual:`), subpath import or virtual id. */
export function isPackageSpecifier(specifier: string): boolean {
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
  files: ReadonlyArray<{ path: string; source: string; hash: string }>,
  engine: Pick<EngineApi, 'declaresKitSource' | 'locatePackage'>,
  rootDir: string,
  systemKits: readonly string[],
  /** The engine's facts for parser-ready files: the ingestion's cached
   *  parse, so the corpus pass that follows parses nothing again. */
  factsOf: (
    files: ReadonlyArray<{ path: string; source: string; hash: string }>
  ) => ExtractFactsResult
): ManifestDiagnostic[] {
  const parsed = files.filter(({ path }) => isEngineTransformExtension(path));
  if (parsed.length === 0) return [];
  const locatePackage = nativePackageLocator(
    engine,
    declaredWorkspacePackages(rootDir)
  );
  let facts: ExtractFactsResult;
  try {
    facts = factsOf(parsed);
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
      const pkgRoot = locatePackage(name, dirname(resolve(rootDir, path)));
      if (pkgRoot && declaresKitSource(engine, pkgRoot)) {
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
 *  the loader does not read as source: missing, spelled otherwise on disk,
 *  no package target Node accepts (each read from its runtime target), or
 *  percent-escaped (refused, failing the load). */
function packageMismatchDiagnostic(
  specifier: string,
  hostEntry: string,
  located: string
): ManifestDiagnostic {
  return {
    file: specifier,
    component: 'kit',
    kind: 'warn',
    message: `the host bundler resolves '${specifier}' to ${hostEntry}, which lies in no package, so discovery reads the installed package at ${located} instead and the bundle may render another module than the one analysed — make the bundler resolve '${specifier}' to a package`,
    code: PACKAGE_MISMATCH,
    severity: severityFor(PACKAGE_MISMATCH),
  };
}

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
  return condition.invalid.map(([subpath, target, why]) => ({
    file: packageName,
    component: 'kit',
    kind: 'warn',
    // The loader refuses a percent-escaped target loudly; any other invalid
    // target falls back to the entry's runtime target.
    message: why.includes('percent-escape unsupported')
      ? `exports["${subpath}"].${KIT_SOURCE_CONDITION} names ${target}, which ${why}, so the system loader fails to load that entry`
      : `exports["${subpath}"].${KIT_SOURCE_CONDITION} names ${target}, which ${why}, so that entry is read from its runtime target instead of source`,
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
    outputDirs: collected.outputDirs.filter(
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
    packageInstances: Object.fromEntries(
      Object.entries(collected.packageInstances).filter(
        ([, root]) => !rejectedDirs.some((dir) => isPathWithinRoot(root, dir))
      )
    ),
  };
}

/** Every unresolvable include, with why where the resolver said, and the
 *  system file that includes them when the caller knows it. */
export function unresolvableIncludesMessage(
  outcomes: ExternalPackageOutcome[],
  importer?: string
): string | null {
  const unresolvable = outcomes
    .filter((record) => record.outcome === 'unresolvable')
    .map((record) =>
      record.reason === undefined
        ? record.specifier
        : `${record.specifier} (${record.reason})`
    );
  if (unresolvable.length === 0) return null;
  const from = importer === undefined ? '' : ` in ${importer}`;
  return `[animus-extract] unresolvable include specifier(s)${from}: ${unresolvable.join(', ')}`;
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

/** A host's resolution of a bare specifier to its entry file: the one it
 *  resolves the packages a system extends with, under its own conditions. */
/** A package specifier's file, as the module `importer` imports it. */
export type PackageResolver = (
  specifier: string,
  importer: string
) => string | null | Promise<string | null>;

/** The file a specifier names from `importer`, or why it names none: a
 *  relative one by the ingestion's probe order, spelled exactly, a bare one
 *  by the host's package resolution. */
async function resolveModuleFile(
  importer: string,
  specifier: string,
  resolvePackage: PackageResolver | undefined,
  extensions: ExtensionOrder | undefined
): Promise<{ file: string } | { why: string; caseMismatch?: true }> {
  const unresolved = { why: `'${specifier}' could not be resolved` };
  if (specifier.startsWith('.')) {
    const probed = probeOnDisk(
      relativeSourceCandidates(importer, specifier, extensions),
      dirname(importer)
    );
    if (probed.kind === 'found') return { file: probed.path };
    return probed.kind === 'case-mismatch'
      ? {
          why: caseMismatchReason(
            `'${specifier}'`,
            probed,
            'spell the import as the file is spelled'
          ),
          caseMismatch: true,
        }
      : unresolved;
  }
  try {
    const file = await resolvePackage?.(specifier, importer);
    // A host can answer with a query (Vite's `?v=`): the module is the file.
    return file ? { file: file.split('?')[0] } : unresolved;
  } catch {
    return unresolved;
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

/** The rounds a membership read resolves the modules it asks for: each
 *  reads the modules the last one's identities stopped at, one re-export
 *  hop further. Past it, what is still asked for is finalized as
 *  unresolved and read once more, so an identity it could not follow keeps
 *  the admission its name gives it, with a finding. */
const MEMBERSHIP_ROUNDS = 256;

type MembershipFinding = { file: string } & (
  | {
      kind: 'unproven';
      local: string;
      line: number;
      column: number;
      what: string | null;
      why: string | null;
      admitted: boolean;
    }
  | { kind: 'unimported'; line: number; column: number }
  | { kind: 'escapes'; line: number; column: number; how: string }
);

interface MembershipAnswer {
  members: Array<{ specifier: string; importer: string }>;
  findings: MembershipFinding[];
  needs: Array<[importer: string, specifier: string]>;
  parsed: boolean;
}

/**
 * The packages and local modules a system file's roots extend or include,
 * from the engine's own read of it (spec §2.3 step 5): a bare specifier as
 * its import spells it, a relative one resolved against the system file.
 * The engine follows each root binding's identity through the modules this
 * supplies on request: a relative one by the host's extension order,
 * spelled exactly, a bare one by the host's package resolution.
 */
export async function extractSystemFilePackages(
  systemFilePath: string,
  engine: Pick<EngineApi, 'systemMembership'>,
  report?: (diagnostic: ManifestDiagnostic) => void,
  resolvePackage?: PackageResolver,
  extensions?: ExtensionOrder,
  /** Filled with the file each package member names from the module that
   *  spells it: a kit another kit extends may resolve only from that kit. */
  memberFiles?: Map<string, string>
): Promise<string[]> {
  const { systemMembership } = engine;
  if (systemMembership === undefined) {
    throw new Error(
      'the native engine does not expose systemMembership, which discovery needs — rebuild @animus-ui/extract'
    );
  }
  const files: Record<string, string> = {};
  try {
    files[systemFilePath] = readFileSync(systemFilePath, 'utf-8');
  } catch {
    return [];
  }
  const resolved: Record<
    string,
    { file?: string; why?: string; caseMismatch?: boolean }
  > = {};
  let answer: MembershipAnswer;
  for (let round = 0; ; round++) {
    answer = parseInternalWire<MembershipAnswer>(
      systemMembership(
        JSON.stringify({ system: systemFilePath, files, resolved })
      ),
      'systemMembership'
    );
    // An answer that still asks is no answer: it is never taken as the
    // membership.
    if (answer.needs.length === 0) break;
    for (const [importer, specifier] of answer.needs) {
      const key = `${importer}\0${specifier}`;
      const found =
        round >= MEMBERSHIP_ROUNDS
          ? {
              why: `following '${specifier}' stopped after ${MEMBERSHIP_ROUNDS} re-exports`,
            }
          : await resolveModuleFile(
              importer,
              specifier,
              resolvePackage,
              extensions
            );
      if ('file' in found) {
        resolved[key] = { file: found.file };
        if (!(found.file in files)) {
          try {
            files[found.file] = readFileSync(found.file, 'utf-8');
          } catch {
            // Unread: the engine reports that it could not be read.
          }
        }
      } else {
        resolved[key] = { why: found.why, caseMismatch: found.caseMismatch };
      }
    }
  }
  if (!answer.parsed) return [];

  const reportedUnimported = new Set<string>();
  for (const finding of answer.findings) {
    if (finding.kind === 'unimported') {
      // Reported once per module, at the first such call.
      if (reportedUnimported.has(finding.file)) continue;
      reportedUnimported.add(finding.file);
      report?.({
        file: finding.file,
        component: 'createSystem',
        kind: 'warn',
        message: `'createSystem' is called with no import or local binding, so it is not read as a system root: the system loader evaluates this file without auto-imports, where the name is undefined — import createSystem from '@animus-ui/system'`,
        code: UNIMPORTED_CREATE_SYSTEM,
        severity: severityFor(UNIMPORTED_CREATE_SYSTEM),
        line: finding.line,
        column: finding.column,
      });
      continue;
    }
    if (finding.kind === 'escapes') {
      report?.({
        file: finding.file,
        component: 'createSystem',
        kind: 'warn',
        message: `a system builder leaves what discovery follows here (${finding.how}), so a kit extended on it from there is not read as a member and its components are not extracted — extend it in the chain that creates it, or through a variable`,
        code: UNFOLLOWED_SYSTEM_BUILDER,
        severity: severityFor(UNFOLLOWED_SYSTEM_BUILDER),
        line: finding.line,
        column: finding.column,
      });
      continue;
    }
    const shown =
      finding.what !== null
        ? `it is ${finding.what}, so it is not read as a system root`
        : `discovery cannot follow what it is bound to (${finding.why}), so it is ${finding.admitted ? 'still read' : 'not read'} as a system root by its name alone`;
    report?.({
      file: finding.file,
      component: finding.local,
      kind: 'warn',
      message: `'${finding.local}' is not proven to be Animus's createSystem: ${shown} — import createSystem from '@animus-ui/system', directly or through a re-export discovery can follow`,
      code: UNPROVEN_ROOT_BINDING,
      severity: severityFor(UNPROVEN_ROOT_BINDING),
      line: finding.line,
      column: finding.column,
    });
  }

  // Preserve a bare import's subpath: collapsing `@scope/kit/definition` to
  // the package root can make a subpath-only export unresolvable. A
  // relative one is resolved against the module that spells it.
  for (const { specifier, importer } of answer.members) {
    const file = resolved[`${importer}\0${specifier}`]?.file;
    if (file !== undefined && !specifier.startsWith('.')) {
      if (!memberFiles?.has(specifier)) memberFiles?.set(specifier, file);
    }
  }
  return [
    ...new Set(
      answer.members.map(({ specifier, importer }) =>
        specifier.startsWith('.')
          ? resolve(dirname(importer), specifier)
          : specifier
      )
    ),
  ];
}
