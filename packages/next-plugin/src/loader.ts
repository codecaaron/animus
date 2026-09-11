import { contentHash } from '@animus-ui/extract/pipeline';
import {
  engineApi,
  getAnalyzedHashes,
  getManifestJson,
  getSessionArtifactDir,
  replacementEpochPath,
} from '@animus-ui/extract/session';
import { existsSync } from 'fs';
import { relative } from 'path';

import { transformWithManifest } from './loader-core';

import type { LoaderContextBase } from './loader-core';

const epochSeenForSessionDir = new Set<string>();

type LoaderContext = LoaderContextBase & {
  mode?: 'development' | 'production' | 'none';
};

export default function animusLoader(
  this: LoaderContext,
  source: string
): string {
  if (this.mode !== 'production' && this.addDependency !== undefined) {
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

  const analyzedHash = getAnalyzedHashes()?.get(filename);
  if (analyzedHash !== undefined) {
    const sourceHash = contentHash(source);
    if (sourceHash !== analyzedHash) {
      const refreshedHash = getAnalyzedHashes()?.get(filename);
      if (refreshedHash === undefined || sourceHash !== refreshedHash) {
        throw new Error(
          `ANIMUS_ANALYSIS_CATCHING_UP: ${filename} changed after the current analysis; retrying on the next watch turn`
        );
      }
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
