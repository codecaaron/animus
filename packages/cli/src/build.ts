/**
 * `animus build` — one-shot extraction over the SAME drive loop every
 * driver uses (`ExtractionSession`; NS1/NS4: no second composition), then
 * export of the raw payloads to the fixed-path deterministic artifact
 * contract (design D3) via the CLI writer. The one-shot session tree is
 * removed after export — no session-dir accumulation per CI run.
 *
 * Failure policy (design D5): silent-empty success is impossible —
 * system-load failure, zero discovered files, and structural emptiness are
 * fatal in EVERY mode, independent of `strict`.
 *
 * The preflight, session construction, and shared-state publication steps
 * are exported helpers: `animus watch` (watch.ts) runs the same checks and
 * the same writer path per publication instead of forking them.
 */

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

/** Thrown for failures whose exit class is "extraction failure" (1). */
export class ExtractionFailure extends Error {}
/** Thrown for failures whose exit class is "config/usage error" (2). */
export class UsageFailure extends Error {}
/** Thrown for failures whose exit class is "engine/environment" (3). */
export class EnvironmentFailure extends Error {}

/** The CLI's one stderr prefix convention (stdout stays machine-only) —
 *  shared with watch.ts. */
export const err = (...parts: unknown[]): void =>
  console.error('[animus]', ...parts);

export interface BuildResult {
  outDir: string;
  componentCount: number;
  fileCount: number;
}

/** Preflight shared by build and watch: root and system-module existence
 *  are usage errors (exit 2) decided before any engine work; a missing
 *  platform binary is an environment failure (exit 3) surfaced with the
 *  loader's own remediation text. */
export async function runPreflight(config: ResolvedCliConfig): Promise<void> {
  const { root, options } = config;

  // A nonexistent root is a usage error (exit 2) — never a zero-file
  // extraction failure over a directory that isn't there.
  if (!existsSync(root)) {
    throw new UsageFailure(`Root directory not found: ${root}`);
  }

  // An unresolvable system module is a usage error (exit 2), decided
  // BEFORE any engine work — never a warn-and-continue.
  const systemPath = resolve(root, options.system);
  if (!existsSync(systemPath)) {
    throw new UsageFailure(
      `System module not found: ${systemPath} (from \`system: ${options.system}\` against root ${root})`
    );
  }

  // The native engine must load — fail-loud at require time.
  try {
    await import('@animus-ui/extract');
  } catch (error) {
    throw new EnvironmentFailure(
      `Extraction engine failed to load: ${String(error)}`
    );
  }
}

/** The one CLI session shape: self-ingestion guard applied (an outDir
 *  inside the root is force-excluded from discovery, loudly), driver label
 *  and root authority set, tsconfig `paths` harvested as the alias source
 *  (no live bundler config exists for this driver). */
export function createCliSession(config: ResolvedCliConfig): ExtractionSession {
  const { root, outDir, options } = config;

  const session = new ExtractionSession(options);
  const relOut = relative(root, outDir);
  // Refused rather than guarded: an outDir that IS the root has no exclusion
  // that both protects the artifacts and leaves any source discoverable, so
  // the published `system-props.js`/`manifest.json` would be re-ingested as
  // source on the next run. Publishing into the source tree also puts
  // `lock.json` and a `.staging-<pid>` tree there, and points the asset
  // prune at a user-owned `assets/`.
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
    // Anchored GLOB, never a raw substring: a plain 'out' pattern would
    // silently drop every source whose path contains "out" (Layout.tsx).
    // Joined to the session's STRUCTURAL exclusions, never the user list:
    // a present user list REPLACES the replaceable defaults, so appending
    // there silently dropped `dist`/`.test.`/`.spec.` for every build with
    // a custom outDir inside the root.
    const anchored = `${relOut.split('\\').join('/')}/**`;
    session.structuralExclude = [anchored];
    err(
      `outDir ${relOut} is inside the root — auto-excluded from discovery (pattern '${anchored}')`
    );
  }

  session.driverLabel = 'animus';
  session.rootDir = root;
  // The CLI republishes the WHOLE session assets directory every cycle
  // (`collectSessionAssets` → the published set), so a superseded copy left
  // by the incremental pass would ship in a tree a fresh build of the same
  // source never produces. Nothing serves this directory in place, so the
  // dev-server's reason for keeping the copy until the next full pipeline
  // does not apply here.
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

/**
 * Publish the session's shared-state payloads through the deterministic
 * CLI writer (design D3) — the SINGLE publication path for build and every
 * watch cycle. Zero analyzed files, an unreadable manifest, and structural
 * emptiness throw ExtractionFailure (silent-empty success is impossible);
 * a post-publish consistency failure throws EnvironmentFailure.
 */
export function publishSharedPayloads(
  config: ResolvedCliConfig,
  session: ExtractionSession
): PublishOutcome {
  const { root, outDir, options } = config;

  // Zero discovered files is fatal, naming the effective inputs.
  const analyzed = getAnalyzedHashes();
  const fileCount = analyzed?.size ?? 0;
  if (fileCount === 0) {
    throw new ExtractionFailure(
      `Discovery found zero source files under ${root} ` +
        `(exclusions: ${config.excludePatterns.join(', ')})`
    );
  }

  // Raw payloads via the in-process shared state — never the enveloped
  // session artifacts (identity-free bytes by construction).
  const manifestJson = getManifestJson() ?? '';
  const stylesCss = getSharedCss();
  const systemPropsJs = getSharedSystemProps();
  // The session counted components when it built the manifest — re-parsing
  // the (MB-scale) JSON here every watch cycle just to count keys was the
  // largest per-cycle CPU item after extraction itself. The parse survives
  // only as the fallback readability check for a session that never
  // published a count.
  let componentCount = session.lastComponentCount ?? -1;
  if (componentCount < 0) {
    try {
      // SAFETY: these bytes are the session's own `ExtractEngine.analyze()`
      // output, whose wire type the producing package declares
      // (`ProjectManifest`); `components` is always emitted, so an absent one
      // means this is not a manifest and the catch below is the answer.
      const manifest = JSON.parse(manifestJson) as ProjectManifest;
      componentCount = Object.keys(manifest.components).length;
    } catch {
      throw new ExtractionFailure('Analysis published no readable manifest');
    }
  }

  // Structural self-check: default-ON for this driver, fatal regardless
  // of strict (shared pipeline implementation).
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

  // The session copies asset() bytes into `<sessionDir>/assets/` and the
  // stylesheet references them as `./assets/<name>` — publish them beside
  // styles.css or every url() dangles once the session tree is removed.
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
      // Staged verification rejected the set BEFORE the swap — the
      // previous generation is genuinely still in place.
      throw new EnvironmentFailure(error.message);
    }
    // Everything else, `PublishSwapIncompleteError` included, travels as
    // itself: it carries its own account of what the output directory now
    // holds to whichever caller reports it.
    throw error;
  }

  return { componentCount, fileCount };
}

/**
 * Give up what one run claimed: the session-scoped tree it published into
 * and the advisory lock on the output directory. The single implementation
 * for every ending, so an interrupted run cleans up exactly as a completed
 * one does. Synchronous by requirement — the signal paths call
 * `process.exit` next, which runs no pending microtask. The tree goes FIRST,
 * with the lock still held, so a concurrent claimant cannot publish into a
 * directory this run is still writing under. A null `session` is a run whose
 * construction failed and owns no tree.
 */
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
    // Released with the tree it protected: a later in-process run
    // (programmatic `main()`) must find the publication claim free.
    session.close();
  }
  releaseLock();
}

/**
 * The once-only latch over `releaseRunClaims`, shared by every ending a run
 * has, so a second call cannot release a claim a later run already took. The
 * session is read through `getSession` because the endings are installed
 * before the session exists; a `null` reading is a run that owns no tree.
 */
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

/** Discovery-outcome report (stderr): per-specifier accounting plus
 *  dead-pattern visibility — a user exclusion that matched nothing is
 *  named instead of silently inert. */
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
  // Hoisted above the try so the finally can read `session.sessionDir` —
  // a pure derivation known from construction, unlike the last-writer-wins
  // singleton slot (which can name a DIFFERENT session's tree in a
  // multi-session process).
  let session: ExtractionSession | null = null;
  // One-shot: the session tree has no reader once the raw set is published,
  // so CI runs never accumulate session dirs.
  const releaseClaims = createRunClaimRelease(() => session, release);
  // Without a listener the process dies where it stands, leaving lock.json
  // for the next run to steal and a staging tree nothing reclaims. No drain:
  // a one-shot build has nothing in flight to finish.
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
      // The session's own policy points already classify and phrase these
      // (error diagnostics, strict escalations, unresolvable includes) —
      // the CLI maps them to the extraction-failure exit class.
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
