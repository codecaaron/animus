import { realpathSync } from 'fs';
import { sep } from 'path';

import type { ManifestDiagnostic } from './manifest-diagnostics';

/**
 * Cross-source token correlation (extraction-diagnostics): join the engine's
 * `external-token-candidate` diagnostics against (a) file→specifier ownership
 * from collection and (b) the source packages' own token manifests captured
 * by the loader. A candidate only becomes a finding when the SOURCE package
 * defines the token — that witness is what keeps CSS literals (`color:
 * 'red'`) silent while naming the exact missing `createTheme().extend(...)`
 * inheritance for real kit tokens.
 */

/** Loader capture shape: `{ modulePath: { exportName: [token paths] } }`. */
type SourceThemeManifests = Record<string, Record<string, string[]>>;

/**
 * Index the loader-captured theme manifests by owning specifier. Module paths
 * are canonical absolute paths (symlinks resolved), so each package dir is
 * realpath'd before prefix-matching; a module outside every known package dir
 * (typically the consumer's own theme) contributes nothing.
 */
export function buildSourceTokenIndex(opts: {
  sourceThemeManifestsJson: string | null | undefined;
  /** Absolute package dir → owning specifier (collection `dirOwners`). */
  dirOwners: Record<string, string>;
}): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>();
  if (!opts.sourceThemeManifestsJson) return index;

  let manifests: SourceThemeManifests;
  try {
    manifests = JSON.parse(opts.sourceThemeManifestsJson);
  } catch {
    return index;
  }

  const realDirOwners: Array<{ dir: string; specifier: string }> = [];
  for (const [dir, specifier] of Object.entries(opts.dirOwners)) {
    let real = dir;
    try {
      real = realpathSync(dir);
    } catch {
      // Keep the declared path — prefix matching simply may not hit.
    }
    realDirOwners.push({ dir: real, specifier });
  }

  for (const [modulePath, exports] of Object.entries(manifests)) {
    const owner = realDirOwners.find(
      ({ dir }) => modulePath === dir || modulePath.startsWith(dir + sep)
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
 * The correlation join. Returns one teaching-error message per distinct
 * (component, token, specifier) whose file belongs to a discovered source AND
 * whose token that source's manifest defines. The messages follow the
 * standard severity routing at the CALLER (throw under `strict`, warn
 * otherwise) — this join never reports on its own.
 */
export function correlateExternalTokenDiagnostics(opts: {
  diagnostics: ManifestDiagnostic[] | undefined;
  /** rootDir-relative file path → owning specifier (collection `fileOwners`). */
  fileOwners: Record<string, string>;
  /** specifier → token paths the source itself defines. */
  sourceTokens: Map<string, Set<string>>;
}): string[] {
  const messages: string[] = [];
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

    messages.push(
      `${diagnostic.component} (from '${specifier}') references token ` +
        `'${diagnostic.token}', which the consumer theme does not define — ` +
        `inherit the source's tokens with createTheme().extend(...) using the ` +
        `tokens (or bundle) export of '${specifier}'`
    );
  }

  return messages;
}

// The source-token index is invariant between system loads / package
// collections but the gate runs on every analysis pass — memoize per
// dirOwners object (hosts allocate a fresh one per collection), revalidated
// against the manifests JSON (a system reload mints a new string).
const indexCache = new WeakMap<
  object,
  { manifestsJson: string; index: Map<string, Set<string>> }
>();

/**
 * The complete cross-source token-contract gate both plugins share
 * (extraction-diagnostics): index the loader-captured source manifests,
 * join them against the engine's candidates, and route the resulting
 * teaching errors — throw under `strict`, warn otherwise. One entry point
 * so the two hosts cannot drift on wiring or severity semantics.
 */
export function enforceExternalTokenContracts(opts: {
  diagnostics: ManifestDiagnostic[] | undefined;
  /** rootDir-relative file path → owning specifier (collection `fileOwners`). */
  fileOwners: Record<string, string>;
  /** Absolute package dir → owning specifier (collection `dirOwners`). */
  dirOwners: Record<string, string>;
  sourceThemeManifestsJson: string | null | undefined;
  strict: boolean | undefined;
  /** Host log prefix, e.g. `[animus-extract]`. */
  prefix: string;
  warn: (message: string) => void;
}): void {
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

  const messages = correlateExternalTokenDiagnostics({
    diagnostics: opts.diagnostics,
    fileOwners: opts.fileOwners,
    sourceTokens,
  });
  if (messages.length === 0) return;
  if (opts.strict) {
    throw new Error(`${opts.prefix} ${messages.join('\n')}`);
  }
  for (const message of messages) opts.warn(message);
}
