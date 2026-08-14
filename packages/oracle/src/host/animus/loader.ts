import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AnimusAdapterError } from './errors';
import { isRecord } from './manifest-types';

import type { AnimusHostInput } from './host';

export const MANIFEST_FILE = 'manifest.json';

export const STYLESHEET_FILE = 'styles.css';

export const COMMIT_FILE = 'commit.json';

/**
 * Read one `.animus` output directory into a host input.
 *
 * Both `manifest.json` and `styles.css` are required. `createAnimusHost`
 * tolerates a missing stylesheet — that seam exists for synthetic and
 * in-memory callers — but a *directory* missing one of them is not a degraded
 * artifact set, it is an incomplete build, and quietly producing a
 * token-less host from it would hide the real problem behind an oracle that
 * merely answers a little less.
 *
 * `commit.json` is optional and supplies the program label: the content hash
 * the build recorded for the manifest, which is what makes two runs of the
 * same source recognisably the same program in a probe result.
 */
export const loadAnimusArtifacts = (dir: string): AnimusHostInput => {
  const manifestPath = join(dir, MANIFEST_FILE);
  const stylesheetPath = join(dir, STYLESHEET_FILE);

  const missing = [
    ...(existsSync(manifestPath) ? [] : [MANIFEST_FILE]),
    ...(existsSync(stylesheetPath) ? [] : [STYLESHEET_FILE]),
  ];
  if (missing.length > 0) {
    throw new AnimusAdapterError(
      `${dir} is not an animus artifact directory — missing ` +
        `${missing.join(' and ')}. \`animus build\` writes ` +
        `${MANIFEST_FILE}, ${STYLESHEET_FILE} and ${COMMIT_FILE} into its ` +
        'output directory',
      { construct: 'artifact-directory' }
    );
  }

  const raw = readFileSync(manifestPath, 'utf8');
  let manifest: unknown;
  try {
    manifest = JSON.parse(raw) as unknown;
  } catch {
    throw new AnimusAdapterError(`${manifestPath} is not valid JSON`, {
      construct: MANIFEST_FILE,
      snippet: raw.slice(0, 120),
    });
  }

  const commitPath = join(dir, COMMIT_FILE);
  let label: string | undefined;
  if (existsSync(commitPath)) {
    try {
      const commit = JSON.parse(readFileSync(commitPath, 'utf8')) as unknown;
      const payloads = isRecord(commit) ? commit.payloads : undefined;
      const entry = isRecord(payloads) ? payloads[MANIFEST_FILE] : undefined;
      const hash = isRecord(entry) ? entry.hash : undefined;
      if (typeof hash === 'string') label = `animus-commit:${hash}`;
    } catch {
      throw new AnimusAdapterError(`${commitPath} is not valid JSON`, {
        construct: COMMIT_FILE,
      });
    }
  }

  return {
    manifest,
    stylesheetText: readFileSync(stylesheetPath, 'utf8'),
    ...(label === undefined ? {} : { label }),
  };
};
