import { contentHash } from '@animus-ui/extract/pipeline';
import {
  engineApi,
  getAnalyzedHashes,
  getManifestJson,
  getSessionArtifactDir,
  replacementEpochPath,
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
  const watching = this.mode !== 'production';
  if (watching && this.addDependency !== undefined) {
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

  const code = transformWithManifest({
    source,
    filename,
    manifestJson,
    engineApi,
    opts: this.getOptions?.() ?? {},
  });
  if (!watching || this.addDependency === undefined) return code;

  // watchRun analyzed the edited files before this compilation, so these
  // hashes are the same generation as the manifest.
  const extended = extendedFiles(manifestJson, filename);
  for (const file of extended) {
    this.addDependency(join(this.rootContext, file));
  }
  return code + extensionLineage(extended, getAnalyzedHashes());
}
