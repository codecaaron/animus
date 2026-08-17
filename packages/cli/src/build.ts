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
  collectSessionAssets,
  ExtractionSession,
  getAnalyzedHashes,
  getManifestJson,
  getSharedCss,
  getSharedSystemProps,
} from '@animus-ui/extract/session';
import { existsSync, rmSync } from 'fs';
import { relative, resolve } from 'path';

import {
  acquireLock,
  publishArtifacts,
  PublishInconsistencyError,
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
    throw error;
  }

  return { componentCount, fileCount };
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
    release();
    // One-shot: the session-scoped tree has no reader once the raw set is
    // published — remove it so CI runs never accumulate session dirs. Only
    // this run's OWN tree: when construction failed there is no session to
    // ask, and the process-global slot would then necessarily name a
    // different session's tree (nothing this call may delete).
    if (session) {
      rmSync(session.sessionDir, { recursive: true, force: true });
      // Programmatic entry point: `main()` is published, so a second
      // in-process run must find the publication claim free.
      session.close();
    }
  }
}
