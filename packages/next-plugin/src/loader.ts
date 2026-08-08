import { contentHash } from '@animus-ui/extract/pipeline';
import { existsSync } from 'fs';
import { relative } from 'path';

import { transformWithManifest } from './loader-core';
import { replacementEpochPath } from './session-paths';
import {
  engineApi,
  getAnalyzedHashes,
  getManifestJson,
  getSessionArtifactDir,
} from './singleton';

import type { LoaderPolicyOptions } from './loader-core';

/** Session dirs whose epoch artifact has been SEEN on disk — the artifact
 *  is never deleted once written, so a positive existsSync is stable for
 *  the life of the process (negatives always re-probe). */
const epochSeenForSessionDir = new Set<string>();

type LoaderContext = {
  resourcePath: string;
  rootContext: string;
  getOptions: () => LoaderPolicyOptions;
  /** webpack file-dependency registration — optional so bare policy tests
   *  can drive the loader without a full context. */
  addDependency?: (file: string) => void;
  /** webpack build mode; production invocations stay engine-verbatim. */
  mode?: 'development' | 'production' | 'none';
};

/**
 * Webpack loader for Animus source transformation.
 * Runs with enforce: 'pre' to see original source before Babel/SWC.
 * The manifest arrives via the process singleton (the webpack pipeline and
 * this loader share one process); the transform + CSS-import policy lives
 * in the shared loader-core.
 *
 * Coherence duties (openspec: next-webpack-served-transform-coherence):
 * every dev invocation registers the replacement-epoch artifact as a file
 * dependency (design D2 — restored persistent-cache modules snapshot it, so
 * offline epoch moves invalidate them), and an analyzed file whose current
 * source hash mismatches its analyzed hash fails with the stable diagnostic
 * `ANIMUS_ANALYSIS_CATCHING_UP` after one refreshed re-check (design D4 —
 * unconditional: a zero-entry stale manifest must never publish raw bytes).
 */
export default function animusLoader(
  this: LoaderContext,
  source: string
): string {
  // Epoch dependency on EVERY dev invocation — transform, raw passthrough,
  // and manifest-absent passthrough alike. Production adds nothing (G1:
  // prod loader behavior engine-verbatim). The path is session-scoped
  // (design D2, next-turbopack-served-transform-coherence): the owning
  // session publishes its artifact dir through the process singleton.
  if (this.mode !== 'production' && typeof this.addDependency === 'function') {
    const sessionDir = getSessionArtifactDir();
    if (sessionDir) {
      const epochPath = replacementEpochPath(sessionDir);
      if (epochSeenForSessionDir.has(sessionDir) || existsSync(epochPath)) {
        epochSeenForSessionDir.add(sessionDir);
        this.addDependency(epochPath);
      }
    }
  }

  let manifestJson = getManifestJson();
  if (!manifestJson) return source;

  const filename = relative(this.rootContext, this.resourcePath);

  // Unconditional analyzed-content-hash guard (design D4). Analyzed
  // identity = membership in the last analysis input set — independent of
  // how many entries the manifest holds for the file. The source is hashed
  // at most once per invocation.
  const analyzedHash = getAnalyzedHashes()?.get(filename);
  if (analyzedHash !== undefined) {
    const sourceHash = contentHash(source);
    if (sourceHash !== analyzedHash) {
      // One cheap refresh: a watchRun transaction may have published between
      // this invocation's start and the check (same process — re-reading the
      // singleton IS the refresh).
      const refreshedHash = getAnalyzedHashes()?.get(filename);
      if (refreshedHash === undefined || sourceHash !== refreshedHash) {
        throw new Error(
          `ANIMUS_ANALYSIS_CATCHING_UP: ${filename} changed after the current analysis; retrying on the next watch turn`
        );
      }
      // The refresh matched — transform against the refreshed generation.
      manifestJson = getManifestJson() ?? manifestJson;
    }
  }

  return transformWithManifest({
    source,
    filename,
    manifestJson,
    engineApi,
    opts: this.getOptions?.() ?? {},
  });
}
