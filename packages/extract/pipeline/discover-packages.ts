import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'path';

import { discoverFiles } from './discover-files';
import { isPathWithinRoot } from './source-identity';

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

/** True when a PACKAGE-RELATIVE path matches a package-source exclusion
 *  fragment (the "within the package" filter — see PACKAGE_SRC_EXCLUDES). */
export function isExcludedPackageRelativePath(rel: string): boolean {
  return PACKAGE_SRC_EXCLUDES.some((pattern) => rel.includes(pattern));
}

/**
 * THE package-source walk (guardrail G1 — one policy): shared discovery with
 * no consumer patterns, then exclusion by package-relative path so fragments
 * in the package's own location can't blank out its sources. Used by the
 * collector, hosts' dirty-root rewalks, and watch-path classification alike.
 */
export function walkPackageSources(
  packageDir: string,
  extensionsSet: ReadonlySet<string>
): string[] {
  return discoverFiles(packageDir, packageDir, undefined, extensionsSet).filter(
    (absPath) => !isExcludedPackageRelativePath(relative(packageDir, absPath))
  );
}

/** Exclusions for the compiled-output fallback when a package does not ship src/. */
const PACKAGE_OUTPUT_EXCLUDES = [
  'node_modules',
  '.test.',
  '.spec.',
  '.d.ts',
  '.map',
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
   * - `stale-dist` — resolved with a walked src/ tree whose newest source file
   *   is newer than the resolved dist entry file (first-class-extension D13:
   *   a merge would consume registry content the sources no longer match)
   */
  outcome: 'resolved' | 'unresolvable' | 'empty' | 'stale-dist';
  /**
   * Source files this specifier accounted for in the analysis set: files it
   * contributed, plus files a previous specifier or the caller's own file set
   * already supplied (those are in the set, just not attributable to this
   * collection pass). Unreadable files are NOT counted — they never reach
   * the analysis set.
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

/** The package-name half of a bare specifier (`@scope/name/sub` → `@scope/name`). */
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
 * The D13 dist-freshness check: applicable only when a specifier has BOTH a
 * walked src/ tree and a resolved dist entry that exists on disk outside that
 * tree; stale when the dist entry's mtime is older than the newest walked
 * source file's. Not applicable (never stale) when the entry resolves inside
 * src/ (no dist to skew), when the entry file is missing, or when no source
 * file's mtime is readable. Detection only — reporting is the caller's policy.
 */
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
    } catch {
      // An unreadable source file cannot witness staleness.
    }
  }
  return distMtime < newestSrcMtime;
}

export interface CollectedExternalPackages {
  /** New file entries (rootDir-relative, preprocessed) for the analysis set. */
  entries: Array<{ path: string; source: string }>;
  /** specifier → rootDir-relative module-resolution entry (src/index.ts when present). */
  packageMap: Record<string, string>;
  /** specifier → absolute src/index.ts path, only for packages with one. */
  sourceEntries: Map<string, string>;
  /** specifier → absolute entry to scan for branded `Keyframes` collections —
   *  one per admitted specifier, whatever the package's shape: the redirected
   *  source entry when src/ serves it, the resolved (dist) entry otherwise.
   *  Keyed separately from `sourceEntries` because that map doubles as the
   *  hosts' module-resolution redirect and stays src-only by contract. */
  keyframesScanEntries: Map<string, string>;
  /** Absolute directories for bundler loader allowlisting (src/ or dist entry dir). */
  packageDirs: string[];
  /** Absolute package dir → EVERY declared specifier that claimed it, in
   *  declaration order (set-valued ownership — openspec:
   *  external-source-watch-ingestion, design D2). The first-wins
   *  single-value view correlation consumers key on derives via
   *  `firstOwners`. */
  dirOwnerSets: Record<string, string[]>;
  /** Absolute package dir → the EXACT extension list its collection walk
   *  used (dist-only dirs widen with the entry's own extension, e.g.
   *  `.mjs`). Hosts that rewalk or re-classify paths under a dir must use
   *  this same list — recomputing from the project default silently drops
   *  every file the widened walk admitted. */
  dirExtensions: Record<string, string[]>;
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
   * Observer called once per readable discovered source, before it joins the
   * analysis set. Hosts use it to record raw-file identity (the session's
   * external watch hashes); adaptation itself happens later in
   * `ingestSourceEntries`, never here.
   */
  onSourceRead?: (source: string, relPath: string, absPath: string) => void;
  /** Called when a discovered file cannot be read; the file is skipped. The
   *  thrown value is universally quantified: it comes straight out of a
   *  `catch`, so this contract claims nothing about it and every handler
   *  stringifies it (precedent: `ResetErrorHandler` in the Vite plugin). */
  onUnreadable: <Thrown>(relPath: string, error: Thrown) => void;
  /**
   * Called once per specifier immediately after its package dir is derived
   * and BEFORE that package's sources are walked (openspec:
   * external-source-watch-ingestion, design D4 — a host can open its
   * watcher with no blind gap between scan and watch).
   */
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
  const keyframesScanEntries = new Map<string, string>();
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
    let staleDist = false;

    if (existsSync(srcDir)) {
      packageDirs.push(srcDir);
      claimDir(srcDir, specifier);
      dirExtensions[srcDir] = [...extensionsSet];
      onPackageResolved?.(specifier, srcDir);

      // Redirect module resolution to the matching source entry. A declared
      // package subpath such as `/definition` must not silently become the
      // package root's `src/index.ts`.
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
      keyframesScanEntries.set(specifier, srcEntry ?? absEntry);

      // A kit declared at a subpath is routinely imported at its package
      // ROOT by app code (`import { Card } from '@scope/kit'`), and a root
      // key absent here bypasses every host's src redirect — the app then
      // bundles untransformed dist chains that render unstyled. Register
      // the derived root alias alongside the declared subpath when the
      // package can serve it from src/; a declared root specifier's own
      // pass still wins (guard for earlier, assignment above for later),
      // and the alias adds no outcome record — it was never declared.
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
            // The root module routinely carries the package's `Keyframes`
            // exports (a definition subpath usually doesn't re-export them)
            // — the alias scans alongside the declared entry.
            keyframesScanEntries.set(packageName, rootEntry);
          }
        }
      }

      const pkgFiles = walkPackageSources(srcDir, extensionsSet);

      // D13 freshness gate over the already-walked file list (no second walk).
      staleDist = distEntryIsStale(absEntry, srcDir, pkgFiles);

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

        onSourceRead?.(source, relPath, pkgFile);
        entries.push({ path: relPath, source });
        pushed.add(relPath);
        fileOwners[relPath] ??= specifier;
        fileCount++;
      }
    } else {
      // No src/ — walk the compiled output beside the resolved entry. A
      // definition-only entry cannot carry component call sites by itself,
      // and dist-only npm packages are the normal publication shape. Always
      // admit the entry's own extension even when the consumer customized its
      // source-extension list (the previous single-entry fallback was exempt
      // from that filter too).
      const outputDir = dirname(absEntry);
      packageDirs.push(outputDir);
      claimDir(outputDir, specifier);
      onPackageResolved?.(specifier, outputDir);
      const relPath = relative(rootDir, absEntry);
      packageMap[specifier] = relPath;
      keyframesScanEntries.set(specifier, absEntry);

      const outputExtensions = new Set(extensionsSet);
      outputExtensions.add(extname(absEntry));
      dirExtensions[outputDir] = [...outputExtensions];
      // Excludes match relative to the OUTPUT dir (mirror of the src/ walk):
      // dist-only packages normally live under node_modules, so matching the
      // full path would exclude every file of exactly the packages this
      // branch exists for.
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
    keyframesScanEntries,
    packageDirs,
    dirOwnerSets,
    dirExtensions,
    fileOwners,
    outcomes,
  };
}

/** Absolute package dir → the ONE specifier credited with it. A dir claimed
 *  by no specifier has no key; a dir is never present with an empty owner. */
export interface PackageDirOwners {
  [packageDir: string]: string;
}

/** First-declared specifier per package dir — the single-value ownership
 *  view correlation consumers key on, derived from `dirOwnerSets`. */
export function firstOwners(
  dirOwnerSets: Record<string, string[]>
): PackageDirOwners {
  const owners: PackageDirOwners = {};
  for (const [dir, specifiers] of Object.entries(dirOwnerSets)) {
    if (specifiers.length > 0) owners[dir] = specifiers[0];
  }
  return owners;
}

/**
 * Excise a set of rejected specifiers from a collection result ATOMICALLY
 * (openspec: external-source-watch-ingestion, design D5): the returned copy
 * carries no entries, package-map targets, source entries, package dirs, or
 * ownership for the rejected packages — a package dir is removed only when
 * EVERY specifier that claimed it is rejected (a dir-level rejection, such
 * as the cross-volume gate, always rejects them together). Outcome records
 * are reporting inputs, not membership, and pass through untouched.
 */
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
    // Derived root aliases were never declared, so they are pruned by where
    // their TARGET resolves rather than by specifier membership.
    if (targetRejected(specifier, resolve(rootDir, relTarget))) continue;
    packageMap[specifier] = relTarget;
  }
  const sourceEntries = new Map<string, string>();
  for (const [specifier, absEntry] of collected.sourceEntries) {
    if (targetRejected(specifier, absEntry)) continue;
    sourceEntries.set(specifier, absEntry);
  }
  const keyframesScanEntries = new Map<string, string>();
  for (const [specifier, absEntry] of collected.keyframesScanEntries) {
    if (targetRejected(specifier, absEntry)) continue;
    keyframesScanEntries.set(specifier, absEntry);
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
    keyframesScanEntries,
    packageDirs: collected.packageDirs.filter(
      (dir) => !rejectedDirs.includes(dir)
    ),
    dirOwnerSets,
    dirExtensions,
    fileOwners,
    outcomes: collected.outcomes,
  };
}

/**
 * Extract external DS package names from inheritance declarations in the
 * system file.
 *
 * Supports four forms:
 *   - Primary:            `createSystem(...).extend(identifier)` chain calls
 *                         (repeatable, mixable with `.from()` links; each call
 *                         contributes one source; a library-bundle identifier
 *                         traces its base import)
 *   - Deprecated chain:   `createSystem(...).from(identifier)` chain calls
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

/**
 * The message for the strict/warn gate over stale dist entries
 * (first-class-extension D13), or null when no declared specifier is stale.
 * A stale dist silently skews merged registry content while discovery
 * compiles the fresh sources, so it surfaces like an unresolvable specifier:
 * non-strict consumers warn with this line, strict consumers throw it.
 */
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

  // Deprecated alias: createSystem({ includes: [...] }) — constructor arg
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

  // Primary form: createSystem(...).extend(a).from(b) — the extension chain
  // (`.extend()` primary, `.from()` its deprecated spelling; links mix freely).
  // Anchored to createSystem call chains: a bare `.extend(`/`.from(` match
  // would also catch `createTheme().extend(...)` in the same file and wrongly
  // grant a token-only package discovery membership (its component files would
  // enter extraction). Same matcher family as the regexes above: the anchor
  // skips the createSystem argument list with a paren-depth counter (no string
  // awareness — the `[^}]*?` tolerance level), then consumes consecutive
  // `.extend(<identifier[.member]>)` | `.from(<identifier[.member]>)` links; a
  // bundle passed as `kit` or `kit.system` traces its base identifier's import
  // either way. Trivia (whitespace + comments) is tolerated between every
  // token, and a builder bound to an identifier is tracked so chains split
  // across statements (`const base = createSystem(); ds = base.extend(k)`)
  // still contribute — a link the scan cannot see is a kit whose CSS
  // silently vanishes (outcomes derive only from the returned specifiers).
  const IDENT_START_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*/;

  /** Position after any run of whitespace, line comments, block comments. */
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

  /**
   * Consume consecutive extend/from links starting at `from`, collecting
   * each link's base identifier; tolerates trivia between tokens and a
   * trailing comma in the argument list. Returns the position after the
   * last consumed link (`from` itself when none matched).
   */
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

  /** Identifier assigned directly before `index` (`const x = <here>`), if any. */
  const boundIdentifierBefore = (index: number): string | null => {
    const match = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*$/.exec(
      source.slice(0, index)
    );
    return match ? match[1] : null;
  };

  // Identifiers bound (directly or transitively) to a createSystem builder
  // chain. Seeded by direct `x = createSystem(...)` bindings; extended by
  // the fixpoint scan below when a root's own chain is re-bound.
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

  // Fixpoint over statement-split chains: scanning a root can bind new
  // roots (`const withA = base.extend(a)`), which can carry further links.
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
      // Preserve the imported export subpath for host resolution. Package
      // identity is derived later; collapsing `@scope/kit/definition` to the
      // root can make a valid subpath-only export unresolvable.
      packages.add(specifier);
    }
  }

  return Array.from(packages);
}
