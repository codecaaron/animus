import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

import { ALIAS_MISMATCH, severityFor } from './manifest-diagnostics';
import { hostCandidate } from './probe-evidence';

import type { ExtensionOrder } from './extension-policy';
import type { HostResolve } from './host-package-resolver';
import type { ManifestDiagnostic } from './manifest-diagnostics';
import type { HostReadings } from './probe-evidence';

/** How a session compared the path aliases analysis reads with the host
 *  (spec §2.2 A7): `compared` against the host's resolver;
 *  `by-construction` where the host reads the same tsconfig file the
 *  session read, with nothing overriding it (Turbopack); `unavailable`
 *  where neither holds, which is never agreement; `not-applicable` where no
 *  bundler resolves the output (the CLI). */
export type AliasComparison =
  | 'compared'
  | 'by-construction'
  | 'unavailable'
  | 'not-applicable';

/** A pattern or alias key without its trailing wildcard. */
function aliasStem(key: string): string {
  return key.replace(/\/?\*$/, '');
}

/**
 * Whether a host that reads tsconfig paths itself (Turbopack) agrees with
 * the session by construction: it reads the session's tsconfig file (Next's
 * `typescript.tsconfigPath`, by default `tsconfig.json`), and no alias of
 * its own (`resolveAlias`) overlaps a pattern the session reads, which
 * would leave which one applies to the host.
 */
export function aliasesAgreeByConstruction(input: {
  rootDir: string;
  hostTsconfigPath: string | undefined;
  hostAliasKeys: readonly string[];
  sessionPatterns: readonly string[];
}): boolean {
  const sessionTsconfig = resolve(input.rootDir, 'tsconfig.json');
  const hostTsconfig = resolve(
    input.rootDir,
    input.hostTsconfigPath ?? 'tsconfig.json'
  );
  if (hostTsconfig !== sessionTsconfig) return false;
  return !input.hostAliasKeys.some((key) =>
    input.sessionPatterns.some((pattern) => {
      const [own, read] = [aliasStem(key), aliasStem(pattern)];
      return own.startsWith(read) || read.startsWith(own);
    })
  );
}

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
function physical(file: string): string {
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
 * Where the analysis and the host disagree on a path alias (spec §2.2 A7,
 * report only: resolution never changes). Each analysed import whose
 * specifier, as the parser decodes it, an alias the analysis reads names
 * (tsconfig paths, or the host's own aliases) is resolved as the analysis
 * resolves it (the alias's expansion through the host's extension order)
 * and by the host's own resolver. A different physical file, or a file
 * only one of them finds, is `animus.discovery.alias-mismatch`. A request
 * the host's resolver fails on is unavailable for that request alone.
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
}): Promise<AliasAgreement> {
  const { cache } = input;
  const scope = JSON.stringify([
    input.pathAliasesJson,
    input.fileEntries.map((entry) => entry.path).sort(),
  ]);
  if (cache.scope !== scope) {
    cache.scope = scope;
    cache.byFile.clear();
  }
  if (input.pathAliasesJson === null) return { findings: [], unavailable: 0 };
  const { aliases }: { aliases: AliasEntry[] } = JSON.parse(
    input.pathAliasesJson
  );
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
          return base === undefined ? [] : [compare(path, specifier, base)];
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
