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

/**
 * What one analysis read of the discovered packages (spec §2.2 A4), shared
 * by every participant of its build: the per-importer scan and a host's
 * bundling-time answers check against the same record.
 */
export interface PackageReadRecord {
  rootDir: string;
  /** Package name → the real root of the instance read. */
  roots: Readonly<Record<string, string>>;
  /** Requests a source redirect pins to the instance read. */
  redirected: ReadonlySet<string>;
  /** Whether the analysis holds the file at a real path. */
  holds(file: string): boolean;
  /** Whether the file at a real path declares builder chains, which
   *  served unread would render with empty classes. */
  rendersBuilder(file: string): boolean;
  /** Findings already reported against this record, by importer and
   *  request, so the scan and a host's answers report each once. */
  readonly reported: Set<string>;
}

export function packageReadRecord(input: {
  rootDir: string;
  roots: Readonly<Record<string, string>>;
  redirected: ReadonlySet<string>;
  /** rootDir-relative paths the analysis holds. */
  analysed: readonly string[];
  rendersBuilder: (file: string) => boolean;
}): PackageReadRecord {
  let analysed: Set<string> | null = null;
  const rendered = new Map<string, boolean>();
  return {
    rootDir: input.rootDir,
    roots: input.roots,
    redirected: input.redirected,
    holds(file) {
      analysed ??= new Set(
        input.analysed.map((path) => physical(join(input.rootDir, path)))
      );
      return analysed.has(file);
    },
    rendersBuilder(file) {
      let renders = rendered.get(file);
      if (renders === undefined) {
        renders = input.rendersBuilder(file);
        rendered.set(file, renders);
      }
      return renders;
    },
    reported: new Set(),
  };
}

/**
 * An import of a discovered package that the host resolves, from its
 * importer, to `resolved` (spec §2.2 A4). None where the analysis holds
 * that file, or the request is not a discovered package's. Otherwise the
 * importer would render a file extraction never read:
 * - another instance's: unextracted builder code
 *   (`animus.discovery.unread-package-instance`), or, where a source
 *   redirect serves the instance read in its place, that instance
 *   (`animus.discovery.replaced-package-instance`);
 * - a file of the instance read that the analysis does not hold, and no
 *   redirect covers, which declares builder chains (a compiled subpath):
 *   `animus.discovery.unread-package-instance`.
 */
export function packageInstanceFinding(
  record: PackageReadRecord,
  /** rootDir-relative. */
  importer: string,
  specifier: string,
  resolved: string
): ManifestDiagnostic | null {
  const readRoot = isPackageSpecifier(specifier)
    ? record.roots[bareSpecifierPackageName(specifier)]
    : undefined;
  if (readRoot === undefined) return null;
  const file = physical(resolved);
  if (record.holds(file)) return null;
  const instance = physical(findPackageRoot(file));
  const redirected = record.redirected.has(specifier);
  const shown = (path: string): string =>
    relative(record.rootDir, path).split(sep).join(posix.sep);
  const finding = (code: string, message: string): ManifestDiagnostic => ({
    file: importer,
    component: `import '${specifier}'`,
    kind: code === REPLACED_PACKAGE_INSTANCE ? 'warn' : 'error',
    message,
    code,
    severity: severityFor(code),
  });
  if (instance === readRoot) {
    if (redirected || !record.rendersBuilder(file)) return null;
    return finding(
      UNREAD_PACKAGE_INSTANCE,
      `'${specifier}' in ${importer} resolves through the host bundler to ${shown(file)}, a file of the package extraction reads (${shown(readRoot)}) that it does not analyse, and which declares builder chains, so this importer would render unextracted builder code — import the package by an entry extraction reads, or give this entry an "animus" source condition`
    );
  }
  const where = `'${specifier}' in ${importer} resolves through the host bundler to ${shown(file)}, in another instance of the package (${shown(instance)}) than extraction reads (${shown(readRoot)})`;
  return redirected
    ? finding(
        REPLACED_PACKAGE_INSTANCE,
        `${where}; the source redirect serves the instance read in its place, so this importer renders that one, not its own — resolve the package to one instance`
      )
    : finding(
        UNREAD_PACKAGE_INSTANCE,
        `${where}, which is not analysed, so this importer would render unextracted builder code — resolve the package to one instance`
      );
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
  packages?: PackageReadRecord;
}): Promise<AliasAgreement> {
  const { cache, packages } = input;
  const scope = JSON.stringify([
    input.pathAliasesJson,
    input.fileEntries.map((entry) => entry.path).sort(),
    packages?.roots ?? {},
    [...(packages?.redirected ?? [])].sort(),
  ]);
  if (cache.scope !== scope) {
    cache.scope = scope;
    cache.byFile.clear();
  }
  const { aliases }: { aliases: AliasEntry[] } =
    input.pathAliasesJson === null
      ? { aliases: [] }
      : JSON.parse(input.pathAliasesJson);
  if (aliases.length === 0 && Object.keys(packages?.roots ?? {}).length === 0) {
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
  // A package specifier resolves by its importer's directory: one host
  // request per directory and specifier.
  const packageAnswers = new Map<string, Promise<string | null>>();
  const comparePackage = async (
    record: PackageReadRecord,
    importer: string,
    specifier: string
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
    return packageInstanceFinding(record, importer, specifier, host.file);
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
          return packages !== undefined &&
            isPackageSpecifier(specifier) &&
            packages.roots[bareSpecifierPackageName(specifier)] !== undefined
            ? [comparePackage(packages, path, specifier)]
            : [];
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
