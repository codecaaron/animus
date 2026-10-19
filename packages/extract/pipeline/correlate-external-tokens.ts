import { existsSync, realpathSync } from 'fs';
import { dirname, join } from 'path';

import { parseInternalWire } from './internal-wire';
import {
  EXTERNAL_TOKEN_UNDEFINED,
  hostFinding,
  surfaceManifestDiagnostics,
} from './manifest-diagnostics';
import { isPathWithinRoot } from './source-identity';

import type {
  DiagnosticPolicy,
  ManifestDiagnostic,
} from './manifest-diagnostics';

/**
 * A candidate token becomes a finding only when the SOURCE package's own
 * manifest defines it — the witness that keeps plain CSS literals silent.
 */

/** Loader capture shape: `{ modulePath: { exportName: [token paths] } }`. */
type SourceThemeManifests = Record<string, Record<string, string[]>>;

/**
 * Index the loader-captured theme manifests by owning specifier. An
 * unparseable capture throws: an empty index reads as "no source defines it".
 */
export function buildSourceTokenIndex(opts: {
  sourceThemeManifestsJson: string | null | undefined;
  /** Absolute package dir → owning specifier. */
  dirOwners: Record<string, string>;
}): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  if (!opts.sourceThemeManifestsJson) return index;

  const manifests = parseInternalWire<SourceThemeManifests>(
    opts.sourceThemeManifestsJson,
    "sourceThemeManifestsJson (the system loader's built-theme capture)"
  );

  const realDirOwners: Array<{ dir: string; specifier: string }> = [];
  const addOwnerDir = (dir: string, specifier: string): void => {
    if (!realDirOwners.some((entry) => entry.dir === dir)) {
      realDirOwners.push({ dir, specifier });
    }
  };
  for (const [dir, specifier] of Object.entries(opts.dirOwners)) {
    let real = dir;
    try {
      real = realpathSync(dir);
    } catch {
      // Keep the declared path — prefix matching simply may not hit.
    }
    addOwnerDir(real, specifier);

    // Ownership is keyed by src/ dirs while the loader's module paths live
    // under dist/, so join at the nearest root a `package.json` witnesses.
    // That witness is the real exit condition: a dir with none above it walks
    // to the filesystem root, and admitting it claims every evaluated module.
    let packageRoot = real;
    while (
      packageRoot !== dirname(packageRoot) &&
      !existsSync(join(packageRoot, 'package.json'))
    ) {
      packageRoot = dirname(packageRoot);
    }
    if (existsSync(join(packageRoot, 'package.json'))) {
      addOwnerDir(packageRoot, specifier);
    }
  }

  for (const [modulePath, exports] of Object.entries(manifests)) {
    const owner = realDirOwners.find(({ dir }) =>
      isPathWithinRoot(dir, modulePath)
    );
    if (!owner) continue;
    let tokens = index.get(owner.specifier);
    if (!tokens) {
      tokens = new Set();
      index.set(owner.specifier, tokens);
    }
    for (const paths of Object.values(exports)) {
      for (const token of paths) tokens.add(token);
    }
  }

  return index;
}

/**
 * One finding per distinct (component, token, specifier) whose source
 * defines the token. Severity routing stays at the caller.
 */
export function correlateExternalTokenDiagnostics(opts: {
  diagnostics: ManifestDiagnostic[] | undefined;
  /** rootDir-relative file path → owning specifier. */
  fileOwners: Record<string, string>;
  /** specifier → token paths the source itself defines. */
  sourceTokens: Map<string, Set<string>>;
}): ManifestDiagnostic[] {
  const findings: ManifestDiagnostic[] = [];
  const seen = new Set<string>();

  for (const diagnostic of opts.diagnostics ?? []) {
    if (diagnostic.kind !== 'external-token-candidate' || !diagnostic.token) {
      continue;
    }
    const specifier = opts.fileOwners[diagnostic.file];
    if (!specifier) continue;
    if (!opts.sourceTokens.get(specifier)?.has(diagnostic.token)) continue;

    const key = `${diagnostic.component}\u0000${diagnostic.token}\u0000${specifier}`;
    if (seen.has(key)) continue;
    seen.add(key);

    findings.push({
      ...hostFinding(
        EXTERNAL_TOKEN_UNDEFINED,
        diagnostic.file,
        diagnostic.component,
        `(from '${specifier}') references token '${diagnostic.token}', ` +
          `which the consumer theme does not define — inherit the source's ` +
          `tokens with createTheme().extend(...) using the tokens (or bundle) ` +
          `export of '${specifier}'`
      ),
      // Where the engine located the reference.
      line: diagnostic.line,
      column: diagnostic.column,
    });
  }

  return findings;
}

// Memoized per `dirOwners` identity (hosts allocate a fresh one per
// collection) and revalidated against the manifests JSON.
const indexCache = new WeakMap<
  object,
  { manifestsJson: string; index: Map<string, Set<string>> }
>();

/**
 * The one cross-source token-contract gate both plugins share, so the hosts
 * cannot drift on wiring or severity.
 */
export function enforceExternalTokenContracts(
  opts: {
    diagnostics: ManifestDiagnostic[] | undefined;
    /** rootDir-relative file path → owning specifier. */
    fileOwners: Record<string, string>;
    /** Absolute package dir → owning specifier. */
    dirOwners: Record<string, string>;
    sourceThemeManifestsJson: string | null | undefined;
  },
  warn: (message: string) => void,
  /** The host's diagnostics policy: an undefined token fails a strict
   *  build, and a level can change that. */
  policy: DiagnosticPolicy
): void {
  const manifestsJson = opts.sourceThemeManifestsJson ?? '';
  const cached = indexCache.get(opts.dirOwners);
  let sourceTokens: Map<string, Set<string>>;
  if (cached && cached.manifestsJson === manifestsJson) {
    sourceTokens = cached.index;
  } else {
    sourceTokens = buildSourceTokenIndex({
      sourceThemeManifestsJson: opts.sourceThemeManifestsJson,
      dirOwners: opts.dirOwners,
    });
    indexCache.set(opts.dirOwners, { manifestsJson, index: sourceTokens });
  }

  const diagnostics = correlateExternalTokenDiagnostics({
    diagnostics: opts.diagnostics,
    fileOwners: opts.fileOwners,
    sourceTokens,
  });
  surfaceManifestDiagnostics({ diagnostics }, warn, policy);
}
