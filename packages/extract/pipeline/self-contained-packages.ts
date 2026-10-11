import { isBuiltin } from 'module';
import { dirname, resolve } from 'path';

import { parseInternalWire } from './internal-wire';

import type { EngineApi } from './engine-adapter';
import type { WorkspacePackages } from './workspace-packages';

/** A package entry an analysed module loads at runtime, re-exports as a
 *  namespace or imports whole: what loading it may change unless it is
 *  proven self-contained. */
interface EntryRequest {
  specifier: string;
  fromDir: string;
}

interface EntryProof extends EntryRequest {
  unproven: string | null;
}

/** The package entries whose proof the analysis reads, by specifier. */
export interface PackageEntryProofs {
  /** Entries proven self-contained from every module that loads them. */
  selfContained: string[];
  /** Why each other entry is not, from the first module that loads it. */
  unproven: Record<string, string>;
}

/** The host's resolution the proof resolves under. */
export interface ProofResolution {
  conditions: readonly string[];
  workspaces: WorkspacePackages;
  extensionPolicyJson: string;
  pathAliasesJson: string | null;
}

/** Literal package loads an analysed module writes: `import()`,
 *  `require()` (wrapped or not), and a whole namespace imported or
 *  re-exported. One missed costs precision only: the analysis keeps the
 *  opening for any entry not proven. */
const ENTRY_LOADS = [
  /\bimport\s*\(\s*(['"`])([^'"`$]+)\1/g,
  /\brequire\s*\)?\s*\(\s*(['"`])([^'"`$]+)\1/g,
  /\b(?:import|export)\s*\*\s*as\s+[\w$]+\s+from\s*(['"])([^'"]+)\1/g,
];

/** A bare package specifier: `name`, `@scope/name`, and a subpath. */
const PACKAGE_SPECIFIER =
  /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(?:\/[\w.@-]+)*$/i;

function entryRequests(
  files: ReadonlyArray<{ path: string; source: string }>,
  rootDir: string,
  analysed: Readonly<Record<string, string>>
): EntryRequest[] {
  const requests = new Map<string, EntryRequest>();
  for (const { path, source } of files) {
    const fromDir = dirname(resolve(rootDir, path));
    for (const pattern of ENTRY_LOADS) {
      for (const match of source.matchAll(pattern)) {
        const specifier = match[2];
        if (
          !PACKAGE_SPECIFIER.test(specifier) ||
          isBuiltin(specifier) ||
          specifier in analysed
        ) {
          continue;
        }
        requests.set(`${specifier}\0${fromDir}`, { specifier, fromDir });
      }
    }
  }
  return [...requests.values()];
}

/**
 * Proves each package entry the analysed files load self-contained (the
 * engine's `proveSelfContained`): an entry counts only when it is proven
 * from every module that loads it. An entry `packageMap` maps is an
 * analysed module. Without the native proof, none is proven.
 */
export function provePackageEntries(
  files: ReadonlyArray<{ path: string; source: string }>,
  rootDir: string,
  packageMap: Readonly<Record<string, string>>,
  engine: Pick<EngineApi, 'proveSelfContained'>,
  resolution: ProofResolution
): PackageEntryProofs {
  const requests = entryRequests(files, rootDir, packageMap);
  if (requests.length === 0 || !engine.proveSelfContained) {
    return { selfContained: [], unproven: {} };
  }
  const proofs = parseInternalWire<EntryProof[]>(
    engine.proveSelfContained(
      JSON.stringify(requests),
      resolution.conditions,
      resolution.workspaces,
      resolution.extensionPolicyJson,
      resolution.pathAliasesJson ?? undefined
    ),
    'proveSelfContained'
  );
  const unproven: Record<string, string> = {};
  const proven = new Set<string>();
  for (const { specifier, unproven: why } of proofs) {
    if (why === null) proven.add(specifier);
    else unproven[specifier] ??= why;
  }
  return {
    selfContained: [...proven].filter((s) => !(s in unproven)).sort(),
    unproven,
  };
}
