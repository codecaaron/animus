import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

import {
  bareSpecifierPackageName,
  findPackageRoot,
  isPackageSpecifier,
} from './discover-packages';
import {
  ALIAS_MISMATCH,
  REPLACED_PACKAGE_INSTANCE,
  severityFor,
  UNREAD_PACKAGE_INSTANCE,
} from './manifest-diagnostics';
import { hostCandidate } from './probe-evidence';

import type { ExtensionOrder } from './extension-policy';
import type { HostResolve } from './host-package-resolver';
import type { ManifestDiagnostic } from './manifest-diagnostics';
import type { HostReadings } from './probe-evidence';

interface AliasEntry {
  pattern: string;
  replacement: string;
  type: 'exact' | 'prefix';
}

/** The engine's `expand_alias`: the first entry, longest pattern first,
 *  that names `specifier`. */
function expandAlias(
  specifier: string,
  aliases: readonly AliasEntry[]
): string | undefined {
  for (const alias of aliases) {
    if (alias.type === 'exact' && specifier === alias.pattern) {
      return alias.replacement;
    }
    if (alias.type === 'prefix' && specifier.startsWith(alias.pattern)) {
      return `${alias.replacement}${specifier.slice(alias.pattern.length)}`;
    }
  }
  return undefined;
}

/** A file's identity on disk: its real path, which follows links and
 *  takes the case the filesystem lists; the path itself where it is not
 *  there. */
export function physical(file: string): string {
  try {
    return realpathSync.native(file);
  } catch {
    return resolve(file);
  }
}

/** What a host's module id names: a file on disk, its query dropped and a
 *  dev server's `/@fs/` prefix removed; a virtual id as written; or no
 *  file, where the id names a path nothing is at (an alias applied to a
 *  missing module). */
function hostTarget(id: string): { file: string } | { virtual: string } | null {
  const path = id.split('?')[0]!;
  const file = path.startsWith('/@fs/') ? path.slice('/@fs'.length) : path;
  if (id.startsWith('\0') || !isAbsolute(file)) return { virtual: id };
  return existsSync(file) ? { file } : null;
}

/** One file's comparison: its import findings, and the requests the host's
 *  resolver could not answer. */
interface FileAgreement {
  hash: string;
  findings: ManifestDiagnostic[];
  unavailable: number;
}

/** What a session's comparisons keep between analyses (spec §2.2 A7):
 *  each file's result by its content hash, while the aliases and the file
 *  set are the same. A new alias set, or a file added or removed, compares
 *  every file again. */
export class AliasAgreementCache {
  scope = '';
  byFile = new Map<string, FileAgreement>();
}

/** What one comparison found: the mismatches, and how many requests the
 *  host's resolver could not answer, which are never agreement. */
export interface AliasAgreement {
  findings: ManifestDiagnostic[];
  unavailable: number;
}

/** The package instances discovery read (spec §2.2 A4): each package's
 *  real root by name, and the requests a source redirect pins. */
export interface ReadPackageInstances {
  roots: Readonly<Record<string, string>>;
  redirected: ReadonlySet<string>;
}

/**
 * An import of a discovered package that the host resolves, from its
 * importer, to `resolved` (spec §2.2 A4): none where the analysis holds that
 * file or it lies in the instance read. Otherwise the importer renders
 * another instance: unextracted builder code
 * (`animus.discovery.unread-package-instance`), or, where a source redirect
 * serves the instance read in its place, that instance
 * (`animus.discovery.replaced-package-instance`).
 */
export function packageInstanceFinding(found: {
  rootDir: string;
  /** rootDir-relative. */
  importer: string;
  specifier: string;
  resolved: string;
  /** The real root of the instance read. */
  readRoot: string;
  redirected: boolean;
  /** Whether the analysis holds the file at a real path. */
  holds: (file: string) => boolean;
}): ManifestDiagnostic | null {
  const file = physical(found.resolved);
  if (found.holds(file)) return null;
  const instance = physical(findPackageRoot(file));
  if (instance === found.readRoot) return null;
  const shown = (path: string): string =>
    relative(found.rootDir, path).split(sep).join(posix.sep);
  const code = found.redirected
    ? REPLACED_PACKAGE_INSTANCE
    : UNREAD_PACKAGE_INSTANCE;
  const where = `'${found.specifier}' in ${found.importer} resolves through the host bundler to ${shown(file)}, in another instance of the package (${shown(instance)}) than extraction reads (${shown(found.readRoot)})`;
  return {
    file: found.importer,
    component: `import '${found.specifier}'`,
    kind: found.redirected ? 'warn' : 'error',
    message: found.redirected
      ? `${where}; the source redirect serves the instance read in its place, so this importer renders that one, not its own — resolve the package to one instance`
      : `${where}, which is not analysed, so this importer would render unextracted builder code — resolve the package to one instance`,
    code,
    severity: severityFor(code),
  };
}

/**
 * Where the analysis and the host disagree on a path alias (spec §2.2 A7,
 * report only: resolution never changes). Each analysed import whose
 * specifier, as the parser decodes it, an alias the analysis reads names
 * (tsconfig paths, or the host's own aliases) is resolved as the analysis
 * resolves it (the alias's expansion through the host's extension order)
 * and by the host's own resolver. A different physical file, or a file
 * only one of them finds, is `animus.discovery.alias-mismatch`. A request
 * the host's resolver fails on is unavailable for that request alone.
 *
 * Each import of a discovered package is resolved by the host from its
 * importer too (spec §2.2 A4): an answer in another instance than the one
 * read, in a file the analysis does not hold, is
 * `animus.discovery.unread-package-instance` (the importer would render
 * unextracted builder code), or `animus.discovery.replaced-package-instance`
 * where a source redirect serves the instance read in its place.
 */
export async function compareAliases(input: {
  rootDir: string;
  fileEntries: ReadonlyArray<{ path: string; source: string; hash: string }>;
  pathAliasesJson: string | null;
  order: ExtensionOrder | undefined;
  readings: HostReadings;
  moduleSpecifiers: (fileEntriesJson: string) => string;
  resolve: HostResolve;
  cache: AliasAgreementCache;
  packages?: ReadPackageInstances;
}): Promise<AliasAgreement> {
  const { cache } = input;
  const packages = input.packages ?? { roots: {}, redirected: new Set() };
  const scope = JSON.stringify([
    input.pathAliasesJson,
    input.fileEntries.map((entry) => entry.path).sort(),
    packages.roots,
    [...packages.redirected].sort(),
  ]);
  if (cache.scope !== scope) {
    cache.scope = scope;
    cache.byFile.clear();
  }
  const { aliases }: { aliases: AliasEntry[] } =
    input.pathAliasesJson === null
      ? { aliases: [] }
      : JSON.parse(input.pathAliasesJson);
  if (aliases.length === 0 && Object.keys(packages.roots).length === 0) {
    return { findings: [], unavailable: 0 };
  }
  const changed = input.fileEntries.filter(
    (entry) => cache.byFile.get(entry.path)?.hash !== entry.hash
  );
  const { files }: { files: Record<string, string[]> } =
    changed.length === 0
      ? { files: {} }
      : JSON.parse(
          input.moduleSpecifiers(
            JSON.stringify(
              changed.map(({ path, source }) => ({ path, source }))
            )
          )
        );
  const analysed = new Set(input.fileEntries.map((entry) => entry.path));
  let analysedFiles: Set<string> | null = null;
  /** Whether the analysis holds the file at real path `file`. */
  const holds = (file: string): boolean => {
    analysedFiles ??= new Set(
      input.fileEntries.map((entry) =>
        physical(join(input.rootDir, entry.path))
      )
    );
    return analysedFiles.has(file);
  };
  // A package specifier resolves by its importer's directory: one host
  // request per directory and specifier.
  const packageAnswers = new Map<string, Promise<string | null>>();
  const comparePackage = async (
    importer: string,
    specifier: string,
    readRoot: string
  ): Promise<ManifestDiagnostic | null | 'unavailable'> => {
    const key = `${posix.dirname(importer)}\0${specifier}`;
    let answer = packageAnswers.get(key);
    if (answer === undefined) {
      answer = input.resolve(specifier, join(input.rootDir, importer));
      packageAnswers.set(key, answer);
    }
    let id: string | null;
    try {
      id = await answer;
    } catch {
      return 'unavailable';
    }
    const host = id === null ? null : hostTarget(id);
    if (host === null || 'virtual' in host) return null;
    return packageInstanceFinding({
      rootDir: input.rootDir,
      importer,
      specifier,
      resolved: host.file,
      readRoot,
      redirected: packages.redirected.has(specifier),
      holds,
    });
  };
  const compare = async (
    importer: string,
    specifier: string,
    base: string
  ): Promise<ManifestDiagnostic | null | 'unavailable'> => {
    const candidate = hostCandidate(
      input.rootDir,
      base,
      analysed,
      input.order,
      input.readings
    );
    const analysis =
      candidate === null
        ? null
        : (candidate.analysedAs ?? candidate.candidate.split('?')[0]!);
    let id: string | null;
    try {
      id = await input.resolve(specifier, join(input.rootDir, importer));
    } catch {
      return 'unavailable';
    }
    const host = id === null ? null : hostTarget(id);
    const same =
      analysis === null || host === null
        ? analysis === host
        : 'file' in host &&
          physical(join(input.rootDir, analysis)) === physical(host.file);
    if (same) return null;
    const shown =
      host === null
        ? 'no file'
        : 'virtual' in host
          ? host.virtual
          : relative(input.rootDir, host.file).split(sep).join(posix.sep);
    return {
      file: importer,
      component: `alias '${specifier}'`,
      kind: 'warn',
      message: `'${specifier}' in ${importer} resolves to ${analysis ?? 'no file'} through the path aliases analysis reads, but the host bundler resolves it to ${shown}, so the analysis may read another module than the one the bundle renders — make the bundler's resolution and the aliases (tsconfig paths) agree`,
      code: ALIAS_MISMATCH,
      severity: severityFor(ALIAS_MISMATCH),
    };
  };
  await Promise.all(
    changed.map(async ({ path, hash }) => {
      const results = await Promise.all(
        (files[path] ?? []).flatMap((specifier) => {
          const base = expandAlias(specifier, aliases);
          if (base !== undefined) return [compare(path, specifier, base)];
          const readRoot = isPackageSpecifier(specifier)
            ? packages.roots[bareSpecifierPackageName(specifier)]
            : undefined;
          return readRoot === undefined
            ? []
            : [comparePackage(path, specifier, readRoot)];
        })
      );
      cache.byFile.set(path, {
        hash,
        findings: results.filter(
          (result): result is ManifestDiagnostic =>
            result !== null && result !== 'unavailable'
        ),
        unavailable: results.filter((result) => result === 'unavailable')
          .length,
      });
    })
  );
  const kept = input.fileEntries.flatMap(
    (entry) => cache.byFile.get(entry.path) ?? []
  );
  return {
    findings: kept.flatMap((file) => file.findings),
    unavailable: kept.reduce((total, file) => total + file.unavailable, 0),
  };
}
