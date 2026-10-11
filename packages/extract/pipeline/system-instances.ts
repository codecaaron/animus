/**
 * The system and the analysis read one instance of each kit (spec §2.2
 * A4). Discovery asks the host which instance a kit specifier names; the
 * system loader resolves the system file's imports itself. Until the loader
 * takes the host's instance, a kit whose analysed instance differs from the
 * one the system evaluated is refused: its components would be extracted
 * against another instance's vocabulary.
 */

import { realpathSync } from 'fs';
import { join, relative, sep } from 'path';

import { findPackageRoot } from './discover-packages';
import { severityFor, SYSTEM_INSTANCE_MISMATCH } from './manifest-diagnostics';

import type { ManifestDiagnostic } from './manifest-diagnostics';

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * One error for each system-file kit specifier whose analysed package
 * instance is not the one the system load evaluated: the file the loader's
 * own resolution names must be among the files the load read, and lie in
 * another package root than the directories discovery collected for it.
 */
export function systemInstanceMismatches(input: {
  rootDir: string;
  /** The system file's kit specifiers, as discovery read them. */
  specifiers: readonly string[];
  /** Each collected directory and the specifiers that claimed it. */
  dirOwnerSets: Readonly<Record<string, readonly string[]>>;
  /** The files the system load read. */
  evaluated: readonly string[];
  /** The system loader's resolution of a specifier, from the system file. */
  loaderResolve: (specifier: string) => string | null;
}): ManifestDiagnostic[] {
  const evaluated = new Set(input.evaluated.map(realPath));
  const analysedRoot = new Map<string, string>();
  for (const [dir, owners] of Object.entries(input.dirOwnerSets)) {
    const root = realPath(findPackageRoot(join(dir, 'index')));
    for (const owner of owners) {
      if (!analysedRoot.has(owner)) analysedRoot.set(owner, root);
    }
  }
  const shown = (path: string): string =>
    relative(input.rootDir, path).split(sep).join('/');
  const diagnostics: ManifestDiagnostic[] = [];
  for (const specifier of input.specifiers) {
    const analysed = analysedRoot.get(specifier);
    if (analysed === undefined) continue;
    let file: string | null;
    try {
      file = input.loaderResolve(specifier);
    } catch {
      continue;
    }
    if (file === null || !evaluated.has(realPath(file))) continue;
    const system = realPath(findPackageRoot(realPath(file)));
    if (system === analysed) continue;
    diagnostics.push({
      file: specifier,
      component: 'kit',
      kind: 'error',
      message: `the system evaluates '${specifier}' from ${shown(system)}, but the host bundler resolves it to ${shown(analysed)}, which extraction analyses, so its components would be extracted against another instance's vocabulary — make the bundler and the system resolve '${specifier}' to one instance`,
      code: SYSTEM_INSTANCE_MISMATCH,
      severity: severityFor(SYSTEM_INSTANCE_MISMATCH),
    });
  }
  return diagnostics;
}
