import {
  buildPathAliasesJson,
  readTsconfigAliasPairs,
  runStructuralSelfCheck,
} from '@animus-ui/extract/pipeline';
import {
  ANIMUS_ARTIFACT_DIR,
  collectSessionAssets,
  ExtractionSession,
  getAnalyzedHashes,
  getManifestJson,
  getSharedCss,
  getSharedSystemProps,
} from '@animus-ui/extract/session';
import { existsSync, rmSync } from 'fs';
import { relative, resolve } from 'path';

import { installShutdownSignals } from './signals';
import {
  acquireLock,
  MANIFEST_FILE,
  publishArtifacts,
  PublishInconsistencyError,
  STYLES_FILE,
  SYSTEM_PROPS_FILE,
} from './writer';

import type { ResolvedCliConfig } from './config';
import type { ProjectManifest } from '@animus-ui/extract/pipeline';

export class ExtractionFailure extends Error {}
export class UsageFailure extends Error {}
export class EnvironmentFailure extends Error {}

export const err = (...parts: unknown[]): void =>
  console.error('[animus]', ...parts);

export interface BuildResult {
  outDir: string;
  componentCount: number;
  fileCount: number;
}

/** Existence checks run before the engine loads, so a misconfigured
 *  project exits 2 rather than 3. */
export async function runPreflight(config: ResolvedCliConfig): Promise<void> {
  const { root, options } = config;

  if (!existsSync(root)) {
    throw new UsageFailure(`Root directory not found: ${root}`);
  }

  const systemPath = resolve(root, options.system);
  if (!existsSync(systemPath)) {
    throw new UsageFailure(
      `System module not found: ${systemPath} (from \`system: ${options.system}\` against root ${root})`
    );
  }

  try {
    await import('@animus-ui/extract');
  } catch (error) {
    throw new EnvironmentFailure(
      `Extraction engine failed to load: ${String(error)}`
    );
  }
}

export function createCliSession(config: ResolvedCliConfig): ExtractionSession {
  const { root, outDir, options } = config;

  const session = new ExtractionSession(options);
  const relOut = relative(root, outDir);
  if (relOut === '') {
    throw new UsageFailure(
      `The artifact directory is the root itself (${outDir}) — the published ` +
        `${STYLES_FILE}/${SYSTEM_PROPS_FILE}/${MANIFEST_FILE} would be ` +
        `re-ingested as source on the next run. Pass --out-dir with a ` +
        `subdirectory (the default is ${ANIMUS_ARTIFACT_DIR}) or point ` +
        `--root at the source tree.`
    );
  }
  if (
    !relOut.startsWith('..') &&
    !config.excludePatterns.some((p) => relOut.includes(p) || p === relOut)
  ) {
    // Anchored glob, never a substring: 'out' would drop every path
    // containing it. Structural, not the user list, which replaces defaults.
    const anchored = `${relOut.split('\\').join('/')}/**`;
    session.structuralExclude = [anchored];
    err(
      `outDir ${relOut} is inside the root — auto-excluded from discovery (pattern '${anchored}')`
    );
  }

  session.driverLabel = 'animus';
  session.rootDir = root;
  // Every cycle republishes the whole assets set, so a superseded copy
  // would ship in a tree a fresh build of the same source never produces.
  session.staleAssetPruning = 'every-cycle';
  const aliasPairs = readTsconfigAliasPairs(root);
  const builtAliases = buildPathAliasesJson(aliasPairs, root);
  if (builtAliases) {
    session.pathAliasesJson = builtAliases.json;
  }
  return session;
}

export interface PublishOutcome {
  componentCount: number;
  fileCount: number;
}

export function publishSharedPayloads(
  config: ResolvedCliConfig,
  session: ExtractionSession
): PublishOutcome {
  const { root, outDir, options } = config;

  const analyzed = getAnalyzedHashes();
  const fileCount = analyzed?.size ?? 0;
  if (fileCount === 0) {
    throw new ExtractionFailure(
      `Discovery found zero source files under ${root} ` +
        `(exclusions: ${config.excludePatterns.join(', ')})`
    );
  }

  // Raw shared state, never the enveloped session artifacts: published
  // bytes carry no per-invocation identity.
  const manifestJson = getManifestJson() ?? '';
  const stylesCss = getSharedCss();
  const systemPropsJs = getSharedSystemProps();
  // Re-parsing the MB-scale manifest every cycle only to count keys is the
  // costly path; the parse survives as the fallback readability check.
  let componentCount = session.lastComponentCount ?? -1;
  if (componentCount < 0) {
    try {
      // SAFETY: these bytes are the session's own `analyze()` output, whose
      // wire type the producing package declares; a non-manifest is caught.
      const manifest = JSON.parse(manifestJson) as ProjectManifest;
      componentCount = Object.keys(manifest.components).length;
    } catch {
      throw new ExtractionFailure('Analysis published no readable manifest');
    }
  }

  const failures = runStructuralSelfCheck({
    componentCount,
    variableCss: stylesCss,
    globalCss: '',
    componentCss: '',
    assembledCss: stylesCss,
    layers: options.layers,
    externalOutcomes: session.lastExternalOutcomes,
  });
  if (failures.length > 0) {
    throw new ExtractionFailure(
      `Structural self-check failed:\n  - ${failures.join('\n  - ')}`
    );
  }

  const assets = collectSessionAssets(session.sessionDir);
  try {
    publishArtifacts(outDir, {
      stylesCss,
      systemPropsJs,
      manifestJson,
      assets,
    });
  } catch (error) {
    if (error instanceof PublishInconsistencyError) {
      throw new EnvironmentFailure(error.message);
    }
    throw error;
  }

  return { componentCount, fileCount };
}

/** Synchronous: the signal paths call `process.exit` next, which runs no
 *  pending microtask. The tree goes first, with the lock still held. */
function releaseRunClaims(
  session: ExtractionSession | null,
  releaseLock: () => void
): void {
  if (session) {
    try {
      rmSync(session.sessionDir, { recursive: true, force: true });
    } catch {
      // Best-effort: a missing tree is already gone.
    }
    // Released with the tree it protected: a later in-process run must
    // find the publication claim free.
    session.close();
  }
  releaseLock();
}

export function createRunClaimRelease(
  getSession: () => ExtractionSession | null,
  releaseLock: () => void
): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    releaseRunClaims(getSession(), releaseLock);
  };
}

export function reportDiscoveryOutcomes(
  config: ResolvedCliConfig,
  session: ExtractionSession
): void {
  for (const {
    specifier,
    outcome,
    fileCount: files,
  } of session.lastExternalOutcomes) {
    err(
      `include '${specifier}': ${outcome}${outcome === 'resolved' ? ` (${files} files)` : ''}`
    );
  }
  const stats = session.getExcludeStats();
  for (const pattern of config.options.exclude ?? []) {
    if ((stats.get(pattern) ?? 0) === 0) {
      err(`exclude pattern '${pattern}' matched nothing`);
    }
  }
}

export async function runBuild(
  config: ResolvedCliConfig
): Promise<BuildResult> {
  const { outDir } = config;

  await runPreflight(config);

  const release = acquireLock(outDir);
  // Hoisted so the ending reads this session's own tree: the shared
  // singleton slot can name another session's in a multi-session process.
  let session: ExtractionSession | null = null;
  const releaseClaims = createRunClaimRelease(() => session, release);
  const removeShutdownSignals = installShutdownSignals({
    release: ({ exitCode, signal }) => {
      err(`build interrupted by ${signal} — releasing ${outDir}`);
      releaseClaims();
      process.exit(exitCode);
    },
  });
  try {
    session = createCliSession(config);

    try {
      await session.runFullPipeline();
    } catch (error) {
      throw new ExtractionFailure(String(error));
    }

    const { componentCount, fileCount } = publishSharedPayloads(
      config,
      session
    );

    reportDiscoveryOutcomes(config, session);

    err(
      `build complete: ${componentCount} components from ${fileCount} files → ${outDir}`
    );
    return { outDir, componentCount, fileCount };
  } finally {
    removeShutdownSignals();
    releaseClaims();
  }
}
