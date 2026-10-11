import { contentHash } from '@animus-ui/extract/pipeline';
import {
  engineApi,
  getAnalyzedHashes,
  getManifestJson,
  getSessionArtifactDir,
  replacementEpochPath,
  sessionKey,
} from '@animus-ui/extract/session';
import { existsSync } from 'fs';
import { join, relative } from 'path';

import {
  extendedFiles,
  extensionLineage,
  transformWithManifest,
} from './loader-core';

import type { LoaderContextBase } from './loader-core';

const epochSeenForSessionDir = new Set<string>();

type LoaderContext = LoaderContextBase & {
  mode?: 'development' | 'production' | 'none';
};

export default function animusLoader(
  this: LoaderContext,
  source: string
): string {
  const opts = this.getOptions?.() ?? {};
  // The build the config wrapper created, of the root its plugin analyses;
  // a loader outside one reads no analysis.
  if (opts.build === undefined) return source;
  const key = sessionKey(opts.build, opts.root ?? this.rootContext);

  // In every mode: a persistent cache restores a module only while the
  // epoch of the session that built it still agrees with this analysis.
  if (this.addDependency !== undefined) {
    const sessionDir = getSessionArtifactDir(key);
    if (sessionDir) {
      const epochPath = replacementEpochPath(sessionDir);
      if (epochSeenForSessionDir.has(sessionDir) || existsSync(epochPath)) {
        epochSeenForSessionDir.add(sessionDir);
        this.addDependency(epochPath);
      }
    }
  }

  let manifestJson = getManifestJson(key);
  // No analysis means the build's analysis failed: a failure, never a raw
  // serve (SA1). The failed analysis reports itself on the compilation.
  if (!manifestJson) {
    throw new Error(
      `[animus-extract] no analysis is available to transform ` +
        `${relative(this.rootContext, this.resourcePath)}: the project ` +
        `analysis failed; see the error above.`
    );
  }

  const filename = relative(this.rootContext, this.resourcePath);

  const analyzedHash = getAnalyzedHashes(key)?.get(filename);
  if (analyzedHash !== undefined) {
    const sourceHash = contentHash(source);
    if (sourceHash !== analyzedHash) {
      const refreshedHash = getAnalyzedHashes(key)?.get(filename);
      if (refreshedHash === undefined || sourceHash !== refreshedHash) {
        throw new Error(
          `ANIMUS_ANALYSIS_CATCHING_UP: ${filename} changed after the current analysis; retrying on the next watch turn`
        );
      }
      manifestJson = getManifestJson(key) ?? manifestJson;
    }
  }

  const code = transformWithManifest({
    source,
    filename,
    manifestJson,
    engineApi: () => engineApi(key),
    opts,
  });
  const watching = this.mode !== 'production';
  if (!watching || this.addDependency === undefined) return code;

  // watchRun analyzed the edited files before this compilation, so these
  // hashes are the same generation as the manifest.
  const extended = extendedFiles(manifestJson, filename);
  for (const file of extended) {
    this.addDependency(join(this.rootContext, file));
  }
  return code + extensionLineage(extended, getAnalyzedHashes(key));
}
