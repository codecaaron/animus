import { isAbsolute, posix, relative, sep } from 'node:path';

import { ALIAS_MISMATCH, severityFor } from './manifest-diagnostics';
import { hostCandidate } from './probe-evidence';

import type { ExtensionOrder } from './extension-policy';
import type { HostResolve } from './host-package-resolver';
import type { ManifestDiagnostic } from './manifest-diagnostics';
import type { HostReadings } from './probe-evidence';

/** How a session compared its tsconfig aliases with the host (spec §2.2
 *  A7): `compared` against the host's resolver; `unavailable` where the
 *  host's resolver cannot be reached, which is never agreement;
 *  `not-applicable` where no bundler resolves the output (the CLI). */
export type AliasComparison = 'compared' | 'unavailable' | 'not-applicable';

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

/** A host's module id as a rootDir-relative file, its query dropped; a
 *  virtual id as written. */
function hostFile(rootDir: string, id: string): string {
  if (id.startsWith('\0') || !isAbsolute(id)) return id;
  const file = id.split('?')[0]!;
  return relative(rootDir, file).split(sep).join(posix.sep);
}

/**
 * Where the analysis and the host disagree on a path alias (spec §2.2 A7,
 * report only: resolution never changes). Each analysed import whose
 * specifier an alias the analysis reads names (tsconfig paths, or the
 * host's own aliases) is resolved as the analysis resolves it (the alias's
 * expansion through the host's extension order) and by the host's own
 * resolver; a different file, or a file only one of them finds, is
 * `animus.discovery.alias-mismatch`.
 */
export async function compareAliases(input: {
  rootDir: string;
  fileEntries: ReadonlyArray<{ path: string; source: string }>;
  pathAliasesJson: string | null;
  order: ExtensionOrder | undefined;
  readings: HostReadings;
  moduleSpecifiers: (fileEntriesJson: string) => string;
  resolve: HostResolve;
}): Promise<ManifestDiagnostic[]> {
  if (input.pathAliasesJson === null) return [];
  const { aliases }: { aliases: AliasEntry[] } = JSON.parse(
    input.pathAliasesJson
  );
  // Only a file that spells an alias can import through one.
  const spelling = input.fileEntries.filter((entry) =>
    aliases.some((alias) => entry.source.includes(alias.pattern))
  );
  if (spelling.length === 0) return [];
  const { files }: { files: Record<string, string[]> } = JSON.parse(
    input.moduleSpecifiers(JSON.stringify(spelling))
  );
  const analysed = new Set(input.fileEntries.map((entry) => entry.path));
  const checks = Object.entries(files).flatMap(([importer, specifiers]) =>
    specifiers.flatMap((specifier) => {
      const base = expandAlias(specifier, aliases);
      return base === undefined ? [] : [{ importer, specifier, base }];
    })
  );
  const findings = await Promise.all(
    checks.map(async ({ importer, specifier, base }) => {
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
      const id = await input.resolve(
        specifier,
        posix.join(input.rootDir, importer)
      );
      const host = id === null ? null : hostFile(input.rootDir, id);
      if (analysis === host) return null;
      const diagnostic: ManifestDiagnostic = {
        file: importer,
        component: `alias '${specifier}'`,
        kind: 'warn',
        message: `'${specifier}' in ${importer} resolves to ${analysis ?? 'no file'} through the path aliases analysis reads, but the host bundler resolves it to ${host ?? 'no file'}, so the analysis may read another module than the one the bundle renders — make the bundler's resolution and the aliases (tsconfig paths) agree`,
        code: ALIAS_MISMATCH,
        severity: severityFor(ALIAS_MISMATCH),
      };
      return diagnostic;
    })
  );
  return findings.filter((finding) => finding !== null);
}
